"use client";

import { useMemo, useState } from "react";

import type { FieldRecord, HouseholdAnswers, Meta, PredictResult } from "@/lib/api";
import { ApiError, predict } from "@/lib/api";
import { num, rampClass } from "@/lib/format";
import { useConnectivity } from "@/lib/connectivity";

type Candidate = {
  field: FieldRecord;
  baseline: number;
  min: number;
  max: number;
};

export function WhatIfSandbox({
  baselineResult,
  baselineAnswers,
  fields,
  meta,
  apiBase,
}: {
  baselineResult: PredictResult;
  baselineAnswers: HouseholdAnswers;
  fields: FieldRecord[];
  meta: Meta;
  apiBase: string;
}) {
  const { connected } = useConnectivity();
  const [selectedName, setSelectedName] = useState("");
  const [value, setValue] = useState("");
  const [hypothetical, setHypothetical] = useState<PredictResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(() => {
    const byName = new Map(fields.map((field) => [field.name, field]));
    const seen = new Set<string>();
    return baselineResult.top_factors.flatMap((factor): Candidate[] => {
      const field = byName.get(factor.source_field);
      const raw = baselineAnswers[factor.source_field];
      const baseline = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
      const min = field?.min;
      const max = field?.max;
      if (
        factor.source_field === "area_context" ||
        seen.has(factor.source_field) ||
        !field ||
        (field.allowed_values?.length ?? 0) > 0 ||
        typeof min !== "number" ||
        typeof max !== "number" ||
        !Number.isFinite(min) ||
        !Number.isFinite(max) ||
        min >= max ||
        !Number.isFinite(baseline) ||
        baseline < min ||
        baseline > max
      ) {
        return [];
      }
      seen.add(factor.source_field);
      return [{ field, baseline, min, max }];
    });
  }, [baselineAnswers, baselineResult.top_factors, fields]);

  const selected = candidates.find((candidate) => candidate.field.name === selectedName);

  function chooseField(name: string) {
    const candidate = candidates.find((entry) => entry.field.name === name);
    setSelectedName(name);
    setValue(candidate ? String(candidate.baseline) : "");
    setHypothetical(null);
    setError(null);
  }

  function changeValue(next: string) {
    setValue(next);
    setHypothetical(null);
    setError(null);
  }

  async function scoreHypothetical() {
    if (!selected) return;
    const changedValue = Number(value);
    if (!Number.isFinite(changedValue) || changedValue < selected.min || changedValue > selected.max) {
      setError(
        `${meta.field_labels[selected.field.name] ?? selected.field.name} must be between ${selected.min} and ${selected.max}.`,
      );
      return;
    }
    if (changedValue === selected.baseline) {
      setError("Change the slider value to a different answer to score a hypothetical.");
      return;
    }

    setBusy(true);
    setError(null);
    setHypothetical(null);
    try {
      const result = await predict(
        { ...baselineAnswers, [selected.field.name]: changedValue },
        apiBase,
      );
      setHypothetical(result);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!baselineResult.sufficient_data || baselineResult.probability === null || candidates.length === 0) {
    return null;
  }

  const adjustedProbability = hypothetical?.probability;
  const difference =
    adjustedProbability === null || adjustedProbability === undefined
      ? null
      : adjustedProbability - baselineResult.probability;

  return (
    <section className="card what-if" aria-labelledby="what-if-title">
      <h3 id="what-if-title">What-if sandbox</h3>
      <p className="small muted">
        Explore one changed household answer while keeping all other recorded answers and the survey area fixed.
        Each hypothetical is rescored by the live model. It is not a forecast of what an intervention would cause.
        Your original answers and score are not changed.
      </p>
      <label htmlFor="what-if-field">Choose an answered numeric driver</label>
      <select
        id="what-if-field"
        value={selectedName}
        onChange={(event) => chooseField(event.target.value)}
        disabled={busy}
      >
        <option value="">Choose a household answer</option>
        {candidates.map(({ field, baseline }) => (
          <option key={field.name} value={field.name}>
            {meta.field_labels[field.name] ?? field.name} (recorded: {num(baseline, 2)})
          </option>
        ))}
      </select>

      {selected ? (
        <>
          <label className="what-if-slider-label" htmlFor="what-if-value">
            {meta.field_labels[selected.field.name] ?? selected.field.name}: {num(Number(value), 2)}
          </label>
          <input
            id="what-if-value"
            className="what-if-slider"
            type="range"
            min={selected.min}
            max={selected.max}
            step={
              Number.isInteger(selected.min) && Number.isInteger(selected.max)
                ? 1
                : 0.1
            }
            value={value}
            onChange={(event) => changeValue(event.target.value)}
            disabled={busy}
          />
          <div className="what-if-range small faint">
            <span>Range: {num(selected.min, 2)}</span>
            <span>Recorded answer: {num(selected.baseline, 2)}</span>
            <span>{num(selected.max, 2)}</span>
          </div>
          <button
            type="button"
            className="secondary"
            onClick={scoreHypothetical}
            disabled={busy || !connected || Number(value) === selected.baseline}
          >
            {busy
              ? "Scoring hypothetical…"
              : connected
                ? "Score this hypothetical"
                : "Scoring service unavailable"}
          </button>
        </>
      ) : null}

      {!connected ? (
        <p className="small notice" role="status">
          The scoring API must be reachable to score a hypothetical. Nothing is calculated offline.
        </p>
      ) : null}

      {error ? (
        <p className="small error" role="alert">
          <strong>Hypothetical not scored.</strong> {error}
        </p>
      ) : null}

      {hypothetical ? (
        <div className="what-if-result" aria-live="polite" aria-atomic="true">
          {hypothetical.probability === null ? (
            <p className="small error">
              The backend did not return a probability for this hypothetical. The original score remains unchanged.
            </p>
          ) : (
            <>
              <p>
                <strong>Hypothetical model output</strong>
                <span className={`chip ${rampClass(hypothetical.risk_band)}`}>
                  {hypothetical.risk_band}
                </span>
              </p>
              <p className="small">
                Original score: {num(baselineResult.probability, 3)} · Hypothetical score:{" "}
                {num(hypothetical.probability, 3)}
                {difference === null
                  ? ""
                  : ` · difference ${difference > 0 ? "+" : ""}${num(difference * 100, 1)} percentage points`}
              </p>
              <p className="small muted">
                This is a descriptive model estimate for the edited input, not an eligibility decision, causal effect,
                or promise of an outcome. The original assessment above is unchanged.
              </p>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
