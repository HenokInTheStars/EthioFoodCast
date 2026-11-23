"use client";

/**
 * The interview form and its result card.
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
import { SufficiencyMeter } from "@/components/sufficiency-meter";
import { WhatIfSandbox } from "@/components/what-if-sandbox";
import type { Area, FieldRecord, FormSchema, HouseholdAnswers, Meta, PredictResult } from "@/lib/api";
import { ApiError, predict } from "@/lib/api";
import { useConnectivity } from "@/lib/connectivity";
import { BAND_NOTE, int, num, rampClass } from "@/lib/format";
import { ASSESS_DRAFT_KEY, ASSESS_RECENTS_KEY, type RecentAssessment } from "@/lib/local-data";
import { useLens } from "@/lib/lens";

type Draft = { answers: Record<string, string>; areaId: string; savedAt: string };
type DraftStatus = "loading" | "saved" | "saving" | "unavailable";

type Props = { schema: FormSchema; meta: Meta; areas: Area[]; apiBase: string };

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

function label(meta: Meta, name: string): string {
  return meta.field_labels[name] ?? name;
}

/** Areas grouped by region, so a 427-entry list stays navigable. */
export function AssessForm({ schema, meta, areas, apiBase }: Props) {
  const groups = useMemo(() => Object.entries(schema), [schema]);
  const fields = useMemo(() => groups.flatMap(([, group]) => group), [groups]);

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [areaId, setAreaId] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [draftStatus, setDraftStatus] = useState<DraftStatus>("loading");
  const [storageMessage, setStorageMessage] = useState<string | null>(null);
  const { browserOnline, apiReachable, connected } = useConnectivity();
  const currentDraft = useRef({ answers, areaId });
  const draftReadyRef = useRef(false);
  const [result, setResult] = useState<PredictResult | null>(null);
  const [resultArea, setResultArea] = useState<Area | null>(null);
  const [scoredAnswers, setScoredAnswers] = useState<HouseholdAnswers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [pendingAnswers, setPendingAnswers] = useState<HouseholdAnswers | null>(null);
  const selectedArea = areas.find((area) => area.id === areaId);
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
        if (typeof draft.areaId === "string") setAreaId(draft.areaId);
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

  useEffect(() => {
    function focusAreaSearch(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.getElementById("area-search")?.focus();
      }
    }
    window.addEventListener("keydown", focusAreaSearch);
    return () => window.removeEventListener("keydown", focusAreaSearch);
  }, []);

  const answeredFields = useMemo(
    () => fields.filter((field) => (answers[field.name] ?? "").trim() !== ""),
    [fields, answers],
  );
  /** Summaries the backend can now calculate: all their questions are answered.
   * The values themselves are the backend's to compute, not this form's. */
  const computable = useMemo(
    () =>
      Object.entries(meta.derived_fields)
        .filter(
          ([, sources]) =>
            sources.length > 0 && sources.every((source) => (answers[source] ?? "").trim() !== ""),
        )
        .map(([summary]) => summary),
    [meta.derived_fields, answers],
  );

  function clearDraft() {
    currentDraft.current = { answers: {}, areaId: "" };
    setAnswers({});
    setAreaId("");
    setResult(null);
    setResultArea(null);
    setScoredAnswers(null);
    setError(null);
    setSavedAt(null);
    setReviewing(false);
    setPendingAnswers(null);
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

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    setResultArea(null);
    setScoredAnswers(null);
    if (areaId === "") {
      setError("Select the household's survey area. The GCN model needs it, and there is no safe default.");
      return;
    }

    // Numbers only, and only for the questions actually answered.
    const household: Record<string, number> = {};
    for (const field of fields) {
      const raw = (answers[field.name] ?? "").trim();
      if (raw === "") continue;
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        setError(`${label(meta, field.name)}: enter a number, or leave the question blank if it is unknown.`);
        return;
      }
      household[field.name] = value;
    }

    setError(null);
    setPendingAnswers({ ...household, area_id: areaId });
    setReviewing(true);
  }

  async function scoreReviewedAnswers() {
    if (!pendingAnswers) return;
    setBusy(true);
    setError(null);
    setResultArea(null);
    setReviewing(false);
    try {
      const scored = await predict(pendingAnswers, apiBase);
      setResult(scored);
      setResultArea(selectedArea ?? null);
      setScoredAnswers({ ...pendingAnswers });
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
      setResult(null);
      setResultArea(null);
      setScoredAnswers(null);
      setError(caught instanceof ApiError ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  const factorScale = result
    ? Math.max(...result.top_factors.map((factor) => Math.abs(factor.contribution)), 0.0001)
    : 1;

  return (
    <form onSubmit={onSubmit}>
      <div className="assessment-inputs">
      <p className="small notice">
        Do not enter names, phone numbers, household identifiers, or other identifying details. Only the
        survey answers and selected area are used for scoring.
      </p>
      <fieldset>
        <legend>Survey area (required)</legend>
        <AreaSearch
          areas={areas}
          value={areaId}
          onChange={(id) => {
            setAreaId(id);
            setReviewing(false);
            setResult(null);
            setResultArea(null);
            setScoredAnswers(null);
          }}
          help="Names are approximate; check the verification labels. Across the evaluation set, area context accounts for about 40.2% of total model sensitivity; that is not an individual household's share."
        />
      </fieldset>

      {groups.map(([group, groupFields]) => (
        <fieldset key={group}>
          <legend>{group}</legend>
          {groupFields.map((field) => (
            <div className="field" key={field.name}>
              <label htmlFor={field.name}>{label(meta, field.name)}</label>
              {isBinary(field) || (field.allowed_values !== null && field.allowed_values.length > 0) ? (
                <select
                  id={field.name}
                  value={answers[field.name] ?? ""}
                  onChange={(event) => {
                    setAnswers((previous) => ({ ...previous, [field.name]: event.target.value }));
                    setReviewing(false);
                    setResult(null);
                    setResultArea(null);
                    setScoredAnswers(null);
                  }}
                >
                  <option value="">Unknown</option>
                  {(field.allowed_values ?? [0, 1]).map((value) => (
                    <option value={value} key={value}>
                      {isBinary(field) ? (value === 1 ? "Yes" : "No") : value}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={field.name}
                  type="number"
                  inputMode="decimal"
                  value={answers[field.name] ?? ""}
                  min={field.min ?? undefined}
                  max={field.max ?? undefined}
                  step={Number.isInteger(field.min) && Number.isInteger(field.max) ? 1 : "any"}
                  placeholder="Unknown"
                  onChange={(event) => {
                    setAnswers((previous) => ({ ...previous, [field.name]: event.target.value }));
                    setReviewing(false);
                    setResult(null);
                    setResultArea(null);
                    setScoredAnswers(null);
                  }}
                />
              )}
              {meta.field_help[field.name] ? <p className="help">{meta.field_help[field.name]}</p> : null}
            </div>
          ))}
        </fieldset>
      ))}

      <SufficiencyMeter supplied={answeredFields.length} needed={meta.min_answers} expected={fields.length} />

      {computable.length > 0 ? (
        <p className="small faint">
          Enough answers for the service to calculate: {computable.map((summary) => label(meta, summary)).join(", ")}.
          Ratios and scores are computed by the model service, never in this form.
        </p>
      ) : null}

      <div className="assessment-state" role="status" aria-live="polite">
        <span className={`connection-pill ${connected ? "online" : "offline"}`}>
          {!browserOnline
            ? "Offline"
            : apiReachable === false
              ? "Scoring service unavailable"
              : connected
                ? "Online"
                : "Checking connection"}
        </span>
        <span className="small muted">
          {draftStatus === "loading"
            ? "Restoring this device's draft…"
            : draftStatus === "saving"
              ? "Saving draft on this device…"
              : draftStatus === "unavailable"
                ? storageMessage
                : savedAt
                  ? `Draft saved on this device at ${new Date(savedAt).toLocaleString()}.`
                  : "No saved draft yet. Answers are kept in this browser, on this device."}
        </span>
      </div>
      {!connected ? (
        <p className="small notice" role="status">
          {browserOnline
            ? apiReachable === false
              ? "The scoring service is unreachable. You can continue entering and reviewing answers; scoring will be available when the service reconnects."
              : "Checking the scoring service. You can continue entering and reviewing answers; wait for the service connection before scoring."
            : "You can enter and review answers offline. Scoring requires a connection. Answers remain on this device and are never queued for upload; reconnect before confirming the score."}
        </p>
      ) : null}
        <p className="small faint">
          Derived summaries are calculated by the service, not treated as additional answers. Livestock units are
          approximate: cattle 0.6 TLU, sheep/goats 0.1 TLU, and chickens 0.01 TLU.
        </p>

        <p style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <button type="submit" disabled={busy}>
            Review answers
          </button>
          <button type="button" className="secondary" onClick={clearDraft}>
            Clear answers
          </button>
        </p>

        {reviewing && pendingAnswers ? (
          <section className="card answer-review" aria-labelledby="answer-review-title">
            <h2 id="answer-review-title">Check before scoring</h2>
            <p className="small muted">
              Confirm the surveyed area and recorded answers. Unknown answers remain blank; the service does not
              interpret them as zero.
            </p>
            <p className="small">
              <strong>Survey area:</strong> {selectedArea?.label ?? "Not selected"}
              {selectedArea
                ? ` · ${selectedArea.region_name} · zone ${selectedArea.zone ?? "not named"} (${selectedArea.zone_verified ? "verified" : "inferred"}) · woreda ${selectedArea.woreda ?? "not named"} (${selectedArea.woreda_verified ? "verified" : "inferred"})`
                : ""}
            </p>
            <dl className="answer-review-list">
              {fields.map((field) => {
                const value = answers[field.name]?.trim();
                return (
                  <div key={field.name}>
                    <dt>{label(meta, field.name)}</dt>
                    <dd>{value === undefined || value === "" ? "Unknown / not answered" : value}</dd>
                  </div>
                );
              })}
            </dl>
            <div className="review-actions">
              <button type="button" className="secondary" onClick={() => setReviewing(false)}>
                Edit answers
              </button>
              <button type="button" onClick={scoreReviewedAnswers} disabled={busy || !connected}>
                {busy
                  ? "Scoring…"
                  : !browserOnline
                    ? "Scoring unavailable offline"
                    : apiReachable === false
                      ? "Scoring service unavailable"
                      : connected
                        ? "Confirm and score"
                        : "Checking scoring service…"}
              </button>
            </div>
          </section>
        ) : null}

        {error ? (
        <div className="error" role="alert" style={{ marginBottom: "var(--rhythm)" }}>
          <strong>Not scored.</strong> {error}
        </div>
      ) : null}
        </div>

        {result && scoredAnswers ? (
          <ResultCard
            result={result}
            meta={meta}
            factorScale={factorScale}
            area={resultArea}
            fields={fields}
            scoredAnswers={scoredAnswers}
            apiBase={apiBase}
          />
        ) : null}
    </form>
  );
}

/** The result card. Everything shown here is a field the backend returned,
 * except the bar widths, which are scaled against the largest factor in this
 * result only (a within-result comparison, not comparable across households). */
function ResultCard({
  result,
  meta,
  factorScale,
  area,
  fields,
  scoredAnswers,
  apiBase,
}: {
  result: PredictResult;
  meta: Meta;
  factorScale: number;
  area: Area | null;
  fields: FieldRecord[];
  scoredAnswers: HouseholdAnswers;
  apiBase: string;
}) {
  const { lens } = useLens();
  const factorLimit = lens === "review" ? undefined : 3;
  const shownFactors = result.top_factors.slice(0, factorLimit);
  const areaFactor = shownFactors.find((factor) => factor.source_field === "area_context");
  const householdFactors = shownFactors.filter((factor) => factor.source_field !== "area_context");
  const factorLabel = (factor: PredictResult["top_factors"][number]) =>
    meta.field_labels[factor.source_field] ?? factor.feature;
  const factorBar = (factor: PredictResult["top_factors"][number]) => (
    <li key={factor.encoded_name}>
      <span>{factorLabel(factor)}</span>
      <span className="track" aria-hidden="true">
        <span
          className={`fill ${factor.direction === "increases risk" ? "up" : "down"}`}
          style={{
            display: "block",
            width: `${factorScale > 0 ? (Math.abs(factor.contribution) / factorScale) * 100 : 0}%`,
          }}
        />
      </span>
      <span className="faint small">
        {factor.direction} · {num(Math.abs(factor.contribution) * 100, 1)} pp
      </span>
    </li>
  );
  return (
    <section className="result-output" style={{ marginTop: "var(--rhythm)" }}>
      <div className="card" style={{ marginBottom: "var(--rhythm)" }}>
        <h3>{result.probability === null ? "Follow up: insufficient answers" : `${result.risk_band} risk — assess`}</h3>
        <p style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap" }}>
          <span className={`chip ${rampClass(result.risk_band)}`} style={{ fontSize: "1rem" }}>
            {result.risk_band}
          </span>
          {lens !== "field" && result.probability !== null ? (
            <span className="faint small">score {num(result.probability, lens === "review" ? 4 : 2)}</span>
          ) : null}
        </p>
        <p className="small muted">{BAND_NOTE}</p>
        <p className="small muted">{result.band_meaning}</p>
        <p className="small">
          {result.flagged ? "Flagged: " : "Not flagged: "}
          {result.flag_meaning}
          {result.threshold === null ? "" : ` Threshold ${num(result.threshold, 3)}.`}
        </p>
        <p className="small faint">
          Answered {int(result.n_features_supplied)} of {int(result.n_features_expected)} questions, of which{" "}
          {int(result.n_predictive_supplied)} affect the score.
        </p>
        <p className="small muted">
          The held-out baseline was {num(riskDistribution.observed_rate * 100, 1)}% food insecure. Scores and bands
          are descriptive and are not eligibility decisions.
        </p>
        {result.cluster ? (
          <p className="small muted">
            Household segment: <strong>{result.cluster.name}</strong> (cluster {int(result.cluster.id)}). A
            descriptive group, not a category of need.
          </p>
        ) : null}
      </div>

      {!result.sufficient_data ? (
        <div className="error" style={{ marginBottom: "var(--rhythm)" }}>
          <p>
            <strong>Too few answers for a reliable score.</strong> The score above is shown for
            completeness; treat it as a question to follow up, not an assessment.
          </p>
        </div>
      ) : null}

      {result.top_factors.length > 0 ? (
        <div className="card" style={{ marginBottom: "var(--rhythm)" }}>
          <h3>Model sensitivities</h3>
          <p className="small muted">
            These are one-at-a-time comparisons from the model, not causes, predictions of what would happen if
            circumstances changed, or recommendations. Values are percentage-point differences in the estimated
            probability; the bars do not add up to the score.
          </p>
          {householdFactors.length > 0 ? (
            <section className="factor-group" aria-labelledby="household-sensitivity-title">
              <h4 id="household-sensitivity-title">Household answers</h4>
              <p className="small muted">
                Each comparison leaves one recorded answer unknown, recalculates any derived summary, and scores
                again while holding the other inputs fixed. “Increases” or “reduces” describes the score
                difference from that unknown-answer comparison; it does not show a real-world cause.
              </p>
              <ul className="bars">{householdFactors.map(factorBar)}</ul>
            </section>
          ) : null}
          <section className="factor-group area-context-panel" aria-labelledby="area-sensitivity-title">
            <h4 id="area-sensitivity-title">Survey-area context</h4>
            <p className="small">
              Scored area: <strong>{area?.label ?? "Selected survey area"}</strong>
              {area?.region_name ? ` · ${area.region_name}` : ""}
              {area?.zone ? ` · ${area.zone}` : ""}
              {area?.woreda ? ` · ${area.woreda}` : ""}
            </p>
            <p className="small muted">
              This is the graph model’s learned context for the surveyed area and its connected areas. It describes
              where the household was surveyed, not an action the household took. The 40.2% area-context figure is
              aggregate model sensitivity across the evaluation set; it is not this household’s share of its score.
            </p>
            {areaFactor ? (
              <>
                <p className="small muted">
                  For this result, the model compared the selected area with the average prediction across supported
                  areas for the same answers. This is a model comparison, not evidence that the area caused the
                  household’s circumstances.
                </p>
                <ul className="bars">{factorBar(areaFactor)}</ul>
              </>
            ) : (
              <p className="small faint">
                Area context is not among the {int(shownFactors.length)} sensitivities shown here. That does not mean
                area context had no effect.
              </p>
            )}
          </section>
        </div>
      ) : null}

      <WhatIfSandbox
        baselineResult={result}
        baselineAnswers={scoredAnswers}
        fields={fields}
        meta={meta}
        apiBase={apiBase}
      />

      {result.recommendations.length > 0 ? (
        <div className="card" style={{ marginBottom: "var(--rhythm)" }}>
          <h3>Follow-up prompts</h3>
          <p className="small muted">
            Prompts generated from the answers that crossed a threshold. They are questions to ask, not
            actions to take.
          </p>
          <ul className="plain">
            {result.recommendations.map((recommendation) => (
              <li key={recommendation.id}>
                <span className="tag">{recommendation.category}</span> {recommendation.prompt}{" "}
                <span className="faint small">
                  ({meta.field_labels[recommendation.triggered_by] ?? recommendation.triggered_by}
                  {recommendation.value === null ? "" : ` = ${num(recommendation.value, 2)}`})
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.warnings.length > 0 ? (
        <div className="card" style={{ marginBottom: "var(--rhythm)" }}>
          <h3>Warnings</h3>
          <ul className="plain small">
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {lens === "review" ? (
        <p className="footnote small">
          <span className="tag">Provenance</span> Live prediction from the deployed service; threshold{" "}
          {result.threshold === null ? "not available" : num(result.threshold, 3)}. The score is a model estimate,
          not a calibrated measure of certainty.
        </p>
      ) : null}
      <button type="button" className="secondary print-action" onClick={() => window.print()}>
        Print assessment card
      </button>

      <details className="small">
        <summary>Limits of this result</summary>
        <ul className="plain" style={{ marginTop: "0.5rem" }}>
          {result.caveats.map((caveat) => (
            <li key={caveat} className="muted">
              {caveat}
            </li>
          ))}
        </ul>
        <p className="faint small">
          Model: {String(result.model_version.model ?? "unknown")}
          {Array.isArray(result.model_version.answers)
            ? ` \u00b7 ${result.model_version.answers.length} questions`
            : ""}
          {result.threshold === null ? "" : ` \u00b7 threshold ${num(result.threshold, 3)}`}. Compare every
          score against the baseline rate in the page footer before acting on it.
        </p>
      </details>
    </section>
  );
}
