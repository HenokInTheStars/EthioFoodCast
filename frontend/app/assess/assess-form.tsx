"use client";

/**
 * The interview, as a short stepped form, and its result.
 *
 * Steps: survey area, one step per question group, then review and score. The
 * steps can be visited in any order; a step bar shows how much of each is done.
 *
 * Three rules this component holds to:
 *   - A blank answer is sent as nothing at all. The backend imputes missing
 *     values exactly as it did in training, so "unknown" is a real answer and
 *     must never be smuggled in as 0 or as the field median.
 *   - Nothing is computed here. Derived summaries are the backend's job; the
 *     form only says which ones it now has enough answers to calculate.
 *   - The draft lives in this browser's localStorage and nowhere else. The UI
 *     says "on this device", because that is exactly what it is.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";

import riskDistribution from "@/data/artifacts/risk_distribution.json";
import { AreaSearch } from "@/components/area-search";
import { WhatIfSandbox } from "@/components/what-if-sandbox";
import { ExplainResult } from "@/components/explain-result";
import type { Area, FieldRecord, FormSchema, HouseholdAnswers, Meta, PredictResult } from "@/lib/api";
import { ApiError, predict } from "@/lib/api";
import { useConnectivity } from "@/lib/connectivity";
import { int, num, rampClass } from "@/lib/format";
import { ASSESS_DRAFT_KEY, ASSESS_RECENTS_KEY, type RecentAssessment } from "@/lib/local-data";
import { useLens } from "@/lib/lens";

type Draft = { answers: Record<string, string>; areaId: string; savedAt: string };
type DraftStatus = "loading" | "saved" | "saving" | "unavailable";
type Props = { schema: FormSchema; meta: Meta; areas: Area[]; apiBase: string };
type Step = { id: string; title: string; description: string; fields: FieldRecord[] };

const AREA_STEP = "__area";
const REVIEW_STEP = "__review";

const GROUP_DESCRIPTIONS: Record<string, string> = {
  Household: "Who lives in the household now.",
  "Land and crops": "The fields the household farms and this season's harvest.",
  Livestock: "Animals the household owned 12 months ago.",
  "Livelihood and income": "Work outside farming, the safety-net programme and household items.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A binary question is yes/no; everything else is a number the worker can type. */
function isBinary(field: FieldRecord): boolean {
  return field.dtype === "binary" ||
    (field.allowed_values?.length === 2 &&
      field.allowed_values.includes(0) &&
      field.allowed_values.includes(1));
}

/** Whole-number counts with a known range get - and + buttons. */
function isCount(field: FieldRecord): boolean {
  return field.min !== null && field.max !== null && Number.isInteger(field.min) && Number.isInteger(field.max);
}

function label(meta: Meta, name: string): string {
  return meta.field_labels[name] ?? name;
}

function isAnswered(answers: Record<string, string>, name: string): boolean {
  return (answers[name] ?? "").trim() !== "";
}

function displayAnswer(field: FieldRecord, raw: string | undefined): string {
  const value = raw?.trim();
  if (value === undefined || value === "") return "Unknown";
  if (isBinary(field)) return value === "1" ? "Yes" : value === "0" ? "No" : value;
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString() : value;
}

export function AssessForm({ schema, meta, areas, apiBase }: Props) {
  const groups = useMemo(() => Object.entries(schema), [schema]);
  const fields = useMemo(() => groups.flatMap(([, group]) => group), [groups]);
  const steps = useMemo<Step[]>(
    () => [
      {
        id: AREA_STEP,
        title: "Survey area",
        description: "Where the household was surveyed. Required: it is the largest single input to the score.",
        fields: [],
      },
      ...groups.map(([group, groupFields]) => ({
        id: group,
        title: group,
        description: GROUP_DESCRIPTIONS[group] ?? "",
        fields: groupFields,
      })),
      {
        id: REVIEW_STEP,
        title: "Review and score",
        description: "Check the area and answers, then score.",
        fields: [],
      },
    ],
    [groups],
  );

  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [areaId, setAreaId] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [draftStatus, setDraftStatus] = useState<DraftStatus>("loading");
  const [storageMessage, setStorageMessage] = useState<string | null>(null);
  const { browserOnline, apiReachable, connected } = useConnectivity();
  const currentDraft = useRef({ answers, areaId });
  const draftReadyRef = useRef(false);
  const stepTopRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<PredictResult | null>(null);
  const [resultArea, setResultArea] = useState<Area | null>(null);
  const [scoredAnswers, setScoredAnswers] = useState<HouseholdAnswers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedArea = areas.find((area) => area.id === areaId);
  // The area step always exists, so there is always a step to show.
  const step: Step = steps[stepIndex] ?? (steps[0] as Step);
  currentDraft.current = { answers, areaId };
  draftReadyRef.current = draftReady;

  // Restore a draft written by a previous visit.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(ASSESS_DRAFT_KEY);
      if (raw !== null) {
        const draft: unknown = JSON.parse(raw);
        if (!isRecord(draft)) throw new Error("The saved draft has an invalid format.");
        if (isRecord(draft.answers)) {
          const restoredAnswers = Object.fromEntries(
            Object.entries(draft.answers)
              .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
          );
          setAnswers(restoredAnswers);
        }
        if (typeof draft.areaId === "string") {
          setAreaId(draft.areaId);
          // A draft that already has its area continues at the first question step.
          if (draft.areaId !== "") setStepIndex(1);
        }
        if (typeof draft.savedAt === "string") setSavedAt(draft.savedAt);
      }
      setDraftStatus("saved");
    } catch (caught) {
      setDraftStatus("unavailable");
      setStorageMessage(
        `Could not restore the saved draft (${caught instanceof Error ? caught.message : String(caught)}). You can continue, but this browser may not keep your answers.`,
      );
    } finally {
      setDraftReady(true);
    }
  }, []);

  // Persist each committed change so quick page navigation cannot cancel a pending save.
  useEffect(() => {
    if (!draftReady) return;
    if (Object.keys(answers).length === 0 && areaId === "") return;
    setDraftStatus("saving");
    const stamp = new Date().toISOString();
    const draft: Draft = { answers, areaId, savedAt: stamp };
    try {
      window.localStorage.setItem(ASSESS_DRAFT_KEY, JSON.stringify(draft));
      setSavedAt(stamp);
      setStorageMessage(null);
      setDraftStatus("saved");
    } catch (caught) {
      setDraftStatus("unavailable");
      setStorageMessage(
        `Could not save this draft (${caught instanceof Error ? caught.message : String(caught)}). Keep this page open or copy the answers before leaving.`,
      );
    }
  }, [answers, areaId, draftReady]);

  useEffect(() => {
    function persistBeforeLeaving() {
      if (!draftReadyRef.current) return;
      const { answers: latestAnswers, areaId: latestAreaId } = currentDraft.current;
      if (Object.keys(latestAnswers).length === 0 && latestAreaId === "") return;
      const draft: Draft = {
        answers: latestAnswers,
        areaId: latestAreaId,
        savedAt: new Date().toISOString(),
      };
      try {
        window.localStorage.setItem(ASSESS_DRAFT_KEY, JSON.stringify(draft));
      } catch (caught) {
        console.error("Could not save the assessment draft before leaving.", caught);
      }
    }

    window.addEventListener("pagehide", persistBeforeLeaving);
    return () => window.removeEventListener("pagehide", persistBeforeLeaving);
  }, []);

  // Ctrl/Cmd+K jumps to the area search from anywhere in the interview.
  useEffect(() => {
    function focusAreaSearch(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setStepIndex(0);
        window.setTimeout(() => document.getElementById("area-search")?.focus(), 0);
      }
    }
    window.addEventListener("keydown", focusAreaSearch);
    return () => window.removeEventListener("keydown", focusAreaSearch);
  }, []);

  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [result]);

  const answeredFields = useMemo(() => fields.filter((field) => isAnswered(answers, field.name)), [fields, answers]);
  const answeredCount = answeredFields.length;
  const enough = answeredCount >= meta.min_answers;

  /** Summaries the backend can now calculate: all their questions are answered.
   * The values themselves are the backend's to compute, not this form's. */
  const computable = useMemo(
    () =>
      Object.entries(meta.derived_fields)
        .filter(([, sources]) => sources.length > 0 && sources.every((source) => isAnswered(answers, source)))
        .map(([summary]) => summary),
    [meta.derived_fields, answers],
  );

  function invalidateResult() {
    setResult(null);
    setResultArea(null);
    setScoredAnswers(null);
  }

  function setAnswer(name: string, value: string) {
    setAnswers((previous) => ({ ...previous, [name]: value }));
    invalidateResult();
  }

  /** - and + work from the latest stored value, so fast repeated taps all count. */
  function stepAnswer(field: FieldRecord, delta: number) {
    const min = field.min ?? 0;
    const max = field.max ?? Number.MAX_SAFE_INTEGER;
    setAnswers((previous) => {
      const raw = (previous[field.name] ?? "").trim();
      const current = raw === "" ? null : Number(raw);
      // From Unknown, + starts at the minimum and - does nothing.
      if (current === null || !Number.isFinite(current)) {
        return delta > 0 ? { ...previous, [field.name]: String(min) } : previous;
      }
      const next = Math.max(min, Math.min(max, Math.round(current + delta)));
      return { ...previous, [field.name]: String(next) };
    });
    invalidateResult();
  }

  function goTo(index: number) {
    setStepIndex(Math.max(0, Math.min(steps.length - 1, index)));
    setError(null);
    stepTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function clearDraft() {
    currentDraft.current = { answers: {}, areaId: "" };
    setAnswers({});
    setAreaId("");
    invalidateResult();
    setError(null);
    setSavedAt(null);
    setStepIndex(0);
    try {
      window.localStorage.removeItem(ASSESS_DRAFT_KEY);
      setStorageMessage(null);
      setDraftStatus("saved");
    } catch (caught) {
      setDraftStatus("unavailable");
      setStorageMessage(
        `Could not clear the saved draft (${caught instanceof Error ? caught.message : String(caught)}).`,
      );
    }
  }

  /** Numbers only, and only for the questions actually answered. */
  function buildHousehold(): { household: HouseholdAnswers } | { error: string; field: string } {
    const household: HouseholdAnswers = {};
    for (const field of fields) {
      const raw = (answers[field.name] ?? "").trim();
      if (raw === "") continue;
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        return {
          error: `${label(meta, field.name)}: enter a number, or leave the question blank if it is unknown.`,
          field: field.name,
        };
      }
      household[field.name] = value;
    }
    return { household: { ...household, area_id: areaId } };
  }

  async function score() {
    invalidateResult();
    if (areaId === "") {
      setError("Select the household's survey area. The model needs it, and there is no safe default.");
      goTo(0);
      return;
    }
    const built = buildHousehold();
    if ("error" in built) {
      setError(built.error);
      const at = steps.findIndex((candidate) => candidate.fields.some((field) => field.name === built.field));
      if (at >= 0) setStepIndex(at);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const scored = await predict(built.household, apiBase);
      setResult(scored);
      setResultArea(selectedArea ?? null);
      setScoredAnswers({ ...built.household });
      if (selectedArea) {
        const recent: RecentAssessment = {
          scoredAt: new Date().toISOString(),
          areaId: selectedArea.id,
          areaLabel: selectedArea.label,
          riskBand: scored.risk_band,
          probability: scored.probability,
        };
        try {
          const stored = window.localStorage.getItem(ASSESS_RECENTS_KEY);
          const previous = stored ? (JSON.parse(stored) as RecentAssessment[]) : [];
          const recents = Array.isArray(previous) ? previous : [];
          window.localStorage.setItem(ASSESS_RECENTS_KEY, JSON.stringify([recent, ...recents].slice(0, 5)));
        } catch {
          // Scoring succeeds even when this browser cannot keep a local history.
        }
      }
    } catch (caught) {
      invalidateResult();
      setError(caught instanceof ApiError ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Enter moves to the next step; on the review step it scores.
    if (step.id === REVIEW_STEP) {
      if (connected && !busy) void score();
    } else {
      goTo(stepIndex + 1);
    }
  }

  const stepAnswered = (candidate: Step) =>
    candidate.fields.filter((field) => isAnswered(answers, field.name)).length;
  const stepDone = (candidate: Step) =>
    candidate.id === AREA_STEP
      ? areaId !== ""
      : candidate.id === REVIEW_STEP
        ? result !== null
        : candidate.fields.length > 0 && stepAnswered(candidate) === candidate.fields.length;

  const connectionLabel = !browserOnline
    ? "Offline"
    : apiReachable === false
      ? "Scoring service unavailable"
      : connected
        ? "Scoring service connected"
        : "Checking connection";
  const draftLabel =
    draftStatus === "loading"
      ? "Restoring this device's draft…"
      : draftStatus === "saving"
        ? "Saving on this device…"
        : draftStatus === "unavailable"
          ? storageMessage
          : savedAt
            ? `Draft saved on this device at ${new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : "Answers are kept in this browser, on this device.";
  const scoreLabel = busy
    ? "Scoring…"
    : !browserOnline
      ? "Scoring unavailable offline"
      : apiReachable === false
        ? "Scoring service unavailable"
        : connected
          ? "Score this household"
          : "Checking scoring service…";
  const progressPct = fields.length > 0 ? Math.min(100, (answeredCount / fields.length) * 100) : 0;
  const neededPct = fields.length > 0 ? Math.min(100, (meta.min_answers / fields.length) * 100) : 0;

  const progress = (
    <div className={enough ? "progress-meter ok" : "progress-meter"}>
      <div className="progress-meter-head">
        <strong>
          {answeredCount} of {fields.length} answered
        </strong>
        <span>{enough ? "Enough to score" : `${meta.min_answers} needed`}</span>
      </div>
      <div className="progress-track" aria-hidden="true">
        <span className="progress-fill" style={{ width: `${progressPct}%` }} />
        <span className="progress-needed" style={{ left: `${neededPct}%` }} />
      </div>
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="assess" noValidate>
      <div className="assess-layout">
        <div className="assess-main assessment-inputs">
          <div ref={stepTopRef} className="assess-anchor" />
          <nav className="stepper" aria-label="Interview steps">
            <ol>
              {steps.map((candidate, index) => {
                const done = stepDone(candidate);
                const current = index === stepIndex;
                return (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      className={`step-link${current ? " current" : ""}${done ? " done" : ""}`}
                      aria-current={current ? "step" : undefined}
                      onClick={() => goTo(index)}
                    >
                      <span className="step-number" aria-hidden="true">
                        {done && !current ? "✓" : index + 1}
                      </span>
                      <span className="step-text">
                        <span className="step-title">{candidate.title}</span>
                        <span className="step-meta">
                          {candidate.id === AREA_STEP
                            ? areaId
                              ? "Selected"
                              : "Required"
                            : candidate.id === REVIEW_STEP
                              ? enough
                                ? "Ready"
                                : `${meta.min_answers} answers needed`
                              : `${stepAnswered(candidate)} of ${candidate.fields.length}`}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          <section className="step-panel" aria-labelledby="step-title">
            <header className="step-header">
              <p className="step-eyebrow">
                Step {stepIndex + 1} of {steps.length}
              </p>
              <h2 id="step-title">{step.title}</h2>
              {step.description ? <p className="step-description">{step.description}</p> : null}
            </header>

            {step.id === AREA_STEP ? (
              <div className="step-body">
                <p className="notice small">
                  Do not enter names, phone numbers, household identifiers or other identifying details. Only the
                  survey answers and the selected area are used for scoring.
                </p>
                <AreaSearch
                  areas={areas}
                  value={areaId}
                  onChange={(id) => {
                    setAreaId(id);
                    invalidateResult();
                  }}
                  help="Search by woreda, zone or region. Names marked (approx.) are not confirmed, so check the zone and woreda. The survey area has a strong effect on the score."
                />
              </div>
            ) : step.id === REVIEW_STEP ? (
              <div className="step-body">
                <ReviewSummary
                  steps={steps}
                  answers={answers}
                  meta={meta}
                  selectedArea={selectedArea}
                  onEdit={goTo}
                />
                {computable.length > 0 ? (
                  <p className="small faint">
                    The service will calculate: {computable.map((summary) => label(meta, summary)).join(", ")}.
                    Livestock units are approximate (cattle 0.6, sheep and goats 0.1, chickens 0.01 TLU).
                  </p>
                ) : null}
                {!enough ? (
                  <p className="notice small" role="status">
                    {answeredCount} of {fields.length} questions answered. At least {meta.min_answers} are needed for
                    a score; blank answers are estimated, never read as zero.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="step-body">
                {step.fields.map((field) => (
                  <QuestionField
                    key={field.name}
                    field={field}
                    meta={meta}
                    value={answers[field.name] ?? ""}
                    onChange={(value) => setAnswer(field.name, value)}
                    onStep={(delta) => stepAnswer(field, delta)}
                  />
                ))}
              </div>
            )}

            {error ? (
              <div className="error step-error" role="alert">
                <strong>Not scored.</strong> {error}
              </div>
            ) : null}

            <footer className="step-footer">
              {stepIndex > 0 ? (
                <button type="button" className="secondary" onClick={() => goTo(stepIndex - 1)}>
                  ← Back
                </button>
              ) : (
                <span />
              )}
              {step.id === REVIEW_STEP ? (
                <button type="button" onClick={() => void score()} disabled={busy || !connected}>
                  {scoreLabel}
                </button>
              ) : (
                <button type="button" onClick={() => goTo(stepIndex + 1)}>
                  Next: {steps[stepIndex + 1]?.title} →
                </button>
              )}
            </footer>
          </section>

          {!connected ? (
            <p className="small notice" role="status">
              {browserOnline
                ? apiReachable === false
                  ? "The scoring service is unreachable. You can keep entering and reviewing answers; scoring will be available when the service reconnects."
                  : "Checking the scoring service. You can keep entering answers; wait for the connection before scoring."
                : "You can enter and review answers offline. Scoring needs a connection. Answers stay on this device and are never queued for upload; reconnect before scoring."}
            </p>
          ) : null}
        </div>

        <aside className="assess-aside" aria-label="Assessment progress">
          <div className="aside-card">
            <h2 className="aside-title">This assessment</h2>
            {progress}
            <dl className="aside-facts">
              <div>
                <dt>Survey area</dt>
                <dd>{selectedArea ? selectedArea.label : <span className="faint">Not selected</span>}</dd>
              </div>
              <div>
                <dt>Connection</dt>
                <dd>
                  <span className={`status-dot ${connected ? "ok" : apiReachable === false || !browserOnline ? "down" : "pending"}`} />{" "}
                  {connectionLabel}
                </dd>
              </div>
            </dl>
            <p className="aside-draft">{draftLabel}</p>
            <div className="aside-actions">
              {step.id === REVIEW_STEP ? (
                <button type="button" onClick={() => void score()} disabled={busy || !connected}>
                  {scoreLabel}
                </button>
              ) : (
                <button type="button" onClick={() => goTo(steps.length - 1)}>
                  Review and score
                </button>
              )}
              <button type="button" className="secondary" onClick={clearDraft}>
                Clear answers
              </button>
            </div>
          </div>
          <p className="aside-note">
            Scores rank households for a human follow-up assessment. They are not eligibility decisions.
          </p>
        </aside>
      </div>

      {/* Phone: progress and the next action stay within reach of the thumb. */}
      <div className="assess-bottom-bar">
        {progress}
        {step.id === REVIEW_STEP ? (
          <button type="button" onClick={() => void score()} disabled={busy || !connected}>
            {busy ? "Scoring…" : "Score"}
          </button>
        ) : (
          <button type="button" onClick={() => goTo(stepIndex + 1)}>
            Next →
          </button>
        )}
      </div>

      <div ref={resultRef} className="result-anchor" />
      {result && scoredAnswers ? (
        <ResultCard
          result={result}
          meta={meta}
          area={resultArea}
          fields={fields}
          scoredAnswers={scoredAnswers}
          apiBase={apiBase}
          onNew={clearDraft}
          onEdit={() => goTo(1)}
        />
      ) : null}
    </form>
  );
}

/** One question. Yes/no as three buttons (Unknown is a real answer), counts
 * with - and +, anything else as a plain number. */
function QuestionField({
  field,
  meta,
  value,
  onChange,
  onStep,
}: {
  field: FieldRecord;
  meta: Meta;
  value: string;
  onChange: (value: string) => void;
  onStep: (delta: number) => void;
}) {
  const id = field.name;
  const help = meta.field_help[field.name];
  const title = label(meta, field.name);

  let control;
  if (isBinary(field)) {
    const options: [string, string][] = [
      ["1", "Yes"],
      ["0", "No"],
      ["", "Unknown"],
    ];
    control = (
      <div className="control segmented" role="radiogroup" aria-labelledby={`${id}-label`}>
        {options.map(([optionValue, optionLabel]) => {
          const checked = value === optionValue;
          return (
            <button
              key={optionLabel}
              type="button"
              role="radio"
              aria-checked={checked}
              className={`seg-option${checked ? " checked" : ""}${optionValue === "" ? " unknown" : ""}`}
              onClick={() => onChange(optionValue)}
            >
              {optionLabel}
            </button>
          );
        })}
      </div>
    );
  } else if (isCount(field)) {
    const current = value.trim() === "" ? null : Number(value);
    const min = field.min ?? 0;
    const max = field.max ?? Number.MAX_SAFE_INTEGER;
    control = (
      <div className="control">
        <div className="number-stepper">
          <button
            type="button"
            className="stepper-btn"
            aria-label={`Decrease ${title}`}
            onClick={() => onStep(-1)}
            disabled={current === null || current <= min}
          >
            −
          </button>
          <input
            id={id}
            type="number"
            inputMode="numeric"
            value={value}
            min={field.min ?? undefined}
            max={field.max ?? undefined}
            step={1}
            placeholder="Unknown"
            onChange={(event) => onChange(event.target.value)}
          />
          <button
            type="button"
            className="stepper-btn"
            aria-label={`Increase ${title}`}
            onClick={() => onStep(1)}
            disabled={current !== null && current >= max}
          >
            +
          </button>
        </div>
        {value.trim() !== "" ? (
          <button type="button" className="clear-answer" onClick={() => onChange("")}>
            Set to unknown
          </button>
        ) : null}
      </div>
    );
  } else {
    const squareMetres = /\(m²\)/.test(title) && value.trim() !== "" && Number.isFinite(Number(value));
    control = (
      <div className="control">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={value}
          min={field.min ?? undefined}
          max={field.max ?? undefined}
          step="any"
          placeholder="Unknown"
          onChange={(event) => onChange(event.target.value)}
        />
        {squareMetres ? (
          <span className="unit-hint">≈ {num(Number(value) / 10000, 2)} ha</span>
        ) : null}
        {value.trim() !== "" ? (
          <button type="button" className="clear-answer" onClick={() => onChange("")}>
            Set to unknown
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="field question">
      <label id={`${id}-label`} htmlFor={isBinary(field) ? undefined : id}>
        {title}
      </label>
      {control}
      {help ? <p className="help">{help}</p> : null}
    </div>
  );
}

function ReviewSummary({
  steps,
  answers,
  meta,
  selectedArea,
  onEdit,
}: {
  steps: Step[];
  answers: Record<string, string>;
  meta: Meta;
  selectedArea: Area | undefined;
  onEdit: (index: number) => void;
}) {
  return (
    <div className="review">
      <section className="review-group">
        <header>
          <h3>Survey area</h3>
          <button type="button" className="link-button" onClick={() => onEdit(0)}>
            Edit
          </button>
        </header>
        {selectedArea ? (
          <p className="review-area">
            <strong>{selectedArea.label}</strong>
            <span className="faint">
              {" "}
              · {selectedArea.region_name}
              {selectedArea.zone ? ` · ${selectedArea.zone}` : ""} · zone{" "}
              {selectedArea.zone_verified ? "verified" : "inferred"} · woreda{" "}
              {selectedArea.woreda_verified ? "verified" : "inferred"}
            </span>
          </p>
        ) : (
          <p className="review-missing">Not selected. The model needs the survey area.</p>
        )}
      </section>
      {steps.map((candidate, index) =>
        candidate.fields.length === 0 ? null : (
          <section className="review-group" key={candidate.id}>
            <header>
              <h3>{candidate.title}</h3>
              <button type="button" className="link-button" onClick={() => onEdit(index)}>
                Edit
              </button>
            </header>
            <dl className="review-list">
              {candidate.fields.map((field) => {
                const answered = isAnswered(answers, field.name);
                return (
                  <div key={field.name}>
                    <dt>{label(meta, field.name)}</dt>
                    <dd className={answered ? undefined : "unknown"}>{displayAnswer(field, answers[field.name])}</dd>
                  </div>
                );
              })}
            </dl>
          </section>
        ),
      )}
    </div>
  );
}

/** The result. Everything shown is a field the backend returned, except the bar
 * widths, which compare factors within this result only. */
function ResultCard({
  result,
  meta,
  area,
  fields,
  scoredAnswers,
  apiBase,
  onNew,
  onEdit,
}: {
  result: PredictResult;
  meta: Meta;
  area: Area | null;
  fields: FieldRecord[];
  scoredAnswers: HouseholdAnswers;
  apiBase: string;
  onNew: () => void;
  onEdit: () => void;
}) {
  const { lens } = useLens();
  const scored = result.probability !== null;
  const tone = rampClass(result.risk_band).replace("ramp-", "tone-");
  const factorLabel = (factor: PredictResult["top_factors"][number]) =>
    meta.field_labels[factor.source_field] ?? factor.feature;
  const areaFactor = result.top_factors.find((factor) => factor.source_field === "area_context");
  const householdFactors = result.top_factors
    .filter((factor) => factor.source_field !== "area_context")
    .slice(0, lens === "review" ? undefined : 3);
  const factorScale = Math.max(...result.top_factors.map((factor) => Math.abs(factor.contribution)), 0.0001);
  const headline = !scored
    ? "Not enough answers to score"
    : result.flagged
      ? "Prioritise for a follow-up assessment"
      : "Not flagged for priority follow-up";

  const factorRow = (factor: PredictResult["top_factors"][number]) => {
    const up = factor.direction === "increases risk";
    const points = num(Math.abs(factor.contribution) * 100, 1);
    return (
      <li key={factor.encoded_name} className={up ? "reason up" : "reason down"}>
        <span className="reason-icon" aria-hidden="true">
          {up ? "▲" : "▼"}
        </span>
        <span className="reason-text">
          <span className="reason-name">{factorLabel(factor)}</span>
          <span className="reason-effect">
            {up ? "Raises" : "Lowers"} the score by {points} {points === "1" ? "point" : "points"} compared with
            leaving it unknown
          </span>
        </span>
        <span className="reason-bar" aria-hidden="true">
          <span style={{ width: `${(Math.abs(factor.contribution) / factorScale) * 100}%` }} />
        </span>
      </li>
    );
  };

  return (
    <section className="result" aria-labelledby="result-title">
      <div className={`result-hero ${tone}`}>
        <div className="result-band">
          <span className="result-band-label">Risk band</span>
          <span className="result-band-value">{result.risk_band}</span>
          <span className="result-band-note">a label for the score</span>
        </div>
        <div className="result-summary">
          <p className="result-eyebrow">Assessment result</p>
          <h2 id="result-title">{headline}</h2>
          <p className="result-lede">
            {scored
              ? result.flagged
                ? "The score is above the follow-up cut-off, so this household would be on the list for a visit by a trained assessor."
                : "The score is below the follow-up cut-off. A low score does not prove the household is food secure."
              : `Only ${int(result.n_predictive_supplied)} questions were answered about the household; at least ${int(meta.min_answers)} are needed. Answer more questions and score again.`}
          </p>
          {scored && result.probability !== null ? (
            <ScoreScale probability={result.probability} threshold={result.threshold} showNumbers={lens !== "field"} />
          ) : null}
          <ul className="result-facts">
            <li>{num(riskDistribution.observed_rate * 100, 0)}% of test households were food insecure</li>
            <li>The risk level is a label for the score, not a certainty</li>
            <li>Reasons show what moved the score, not what causes hardship</li>
          </ul>
        </div>
      </div>

      {scored ? (
        <div className="result-grid">
          <div className="card">
            <h3>What moved the score</h3>
            {householdFactors.length > 0 ? (
              <ul className="reasons">{householdFactors.map(factorRow)}</ul>
            ) : (
              <p className="small muted">No single household answer moved the score much.</p>
            )}
            <p className="small faint">
              Each line leaves one answer unknown and scores again with everything else fixed. The lines do not add
              up to the score.
            </p>
          </div>
          <div className="card area-context-panel">
            <h3>Where the household was surveyed</h3>
            <p className="area-context-name">
              <strong>{area?.label ?? "Selected survey area"}</strong>
              <span className="faint small">
                {[area?.region_name, area?.zone].filter(Boolean).join(" · ")}
              </span>
            </p>
            {areaFactor ? <ul className="reasons">{factorRow(areaFactor)}</ul> : null}
            <p className="small muted">
              The model's learned context for this area and its neighbours, compared with the average area for the
              same answers. It describes where the household was surveyed, not something the household did.
            </p>
          </div>
        </div>
      ) : null}

      {scored ? <ExplainResult result={result} area={area} /> : null}

      {result.recommendations.length > 0 ? (
        <div className="card result-section">
          <h3>Topics to cover in the follow-up</h3>
          <p className="small muted">
            Prompts raised by answers that crossed a threshold. They are questions to ask, not actions to take.
          </p>
          <ul className="prompts">
            {result.recommendations.map((recommendation) => (
              <li key={recommendation.id}>
                <span className="prompt-category">{recommendation.category}</span>
                <span className="prompt-text">{recommendation.prompt}</span>
                <span className="prompt-source">
                  From: {meta.field_labels[recommendation.triggered_by] ?? recommendation.triggered_by}
                  {recommendation.value === null ? "" : ` = ${num(recommendation.value, 2)}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {scored ? (
        <WhatIfSandbox
          baselineResult={result}
          baselineAnswers={scoredAnswers}
          fields={fields}
          meta={meta}
          apiBase={apiBase}
        />
      ) : null}

      <details className="card result-details">
        <summary>Details, warnings and limits</summary>
        <dl className="detail-list">
          {result.cluster ? (
            <div>
              <dt>Household profile</dt>
              <dd>
                {result.cluster.name} (a descriptive group, not a category of need)
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Flag</dt>
            <dd>
              {result.flagged ? "Flagged. " : "Not flagged. "}
              {result.flag_meaning}
            </dd>
          </div>
          <div>
            <dt>Risk level</dt>
            <dd>{result.band_meaning}</dd>
          </div>
          {scored ? (
            <div>
              <dt>Score</dt>
              <dd>
                {num(result.probability, 4)}
                {result.threshold === null ? "" : ` (follow-up cut-off ${num(result.threshold, 2)})`}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Questions answered</dt>
            <dd>
              {int(result.n_predictive_supplied)} about the household (minimum {int(meta.min_answers)})
            </dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>
              {String(result.model_version.model ?? "unknown")}
              {Array.isArray(result.model_version.answers) ? ` · ${result.model_version.answers.length} questions` : ""}
            </dd>
          </div>
        </dl>
        {result.warnings.length > 0 ? (
          <>
            <h4>Warnings</h4>
            <ul className="plain small">
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </>
        ) : null}
        <h4>Limits of this result</h4>
        <ul className="plain small">
          {result.caveats.map((caveat) => (
            <li key={caveat} className="muted">
              {caveat}
            </li>
          ))}
        </ul>
      </details>

      <div className="result-actions">
        <button type="button" className="secondary print-action" onClick={() => window.print()}>
          Print assessment card
        </button>
        <button type="button" className="secondary" onClick={onEdit}>
          Edit answers
        </button>
        <button type="button" onClick={onNew}>
          Start a new assessment
        </button>
      </div>
    </section>
  );
}

/** Where the score sits on 0-1, with the operating threshold marked. The numbers
 * are hidden in the field lens, which leads with words, not a probability. */
function ScoreScale({
  probability,
  threshold,
  showNumbers,
}: {
  probability: number;
  threshold: number | null;
  showNumbers: boolean;
}) {
  return (
    <figure className="score-scale" aria-label={`Model score ${num(probability, 2)} on a scale from 0 to 1`}>
      <div className="score-track">
        {threshold !== null ? (
          <span className="score-threshold" style={{ left: `${threshold * 100}%` }}>
            <span>Threshold</span>
          </span>
        ) : null}
        <span className="score-marker" style={{ left: `${probability * 100}%` }}>
          {showNumbers ? <span>{num(probability, 2)}</span> : null}
        </span>
      </div>
      <figcaption>
        <span>Lower score</span>
        <span>Higher score</span>
      </figcaption>
    </figure>
  );
}
