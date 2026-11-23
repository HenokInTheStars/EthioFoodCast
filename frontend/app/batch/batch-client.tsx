"use client";

import { useState } from "react";

import areasData from "@/data/areas.json";
import performance from "@/data/artifacts/performance.json";
import { RampChip } from "@/components/ramp-chip";
import { SufficiencyMeter } from "@/components/sufficiency-meter";
import { coerce, csvToRecords, downloadCsv, toCsv } from "@/lib/csv";
import { apiBaseUrl, postPredictBatch, PredictError } from "@/lib/api";
import { int, num } from "@/lib/format";

/**
 * /batch -- a CSV in, a ranked list out.
 *
 * Program staff work in Excel, so this is the operational door. The upload path
 * goes to `POST /api/predict_batch`, which separates predictors from everything
 * else at the frame level: identifiers and free-text notes pass through
 * untouched and are never scored. That means a real extract with extra columns
 * still works, and the columns the server did not recognise are reported back
 * rather than silently ignored.
 *
 * `area_id` is required, because the web workflow is the graph model and it does
 * not run without an area.
 */

const areas = areasData as { id: string; label: string }[];
const modelAnswers = new Set<string>(performance.answers);

type Row = Record<string, unknown>;
type ScoredRow = Row & {
  probability: number | null;
  risk_band: string;
  cluster: string | null;
  n_recommendations?: number;
};

export function BatchClient() {
  const [records, setRecords] = useState<Row[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [scored, setScored] = useState<ScoredRow[] | null>(null);
  const [unrecognised, setUnrecognised] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const areaIds = new Set(areas.map((area) => area.id));
  const rowsMissingArea = records.filter((row) => !areaIds.has(String(row.area_id ?? ""))).length;

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setScored(null);
    setFileName(file.name);

    const parsed = csvToRecords(await file.text());
    setHeaders(parsed.headers);
    // Coerce so numeric columns arrive as numbers, not strings of digits.
    const typed = parsed.records.map((row) => {
      const out: Row = {};
      for (const [key, value] of Object.entries(row)) out[key] = coerce(value);
      return out;
    });
    setRecords(typed);
  }

  async function score() {
    if (records.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      // The endpoint returns the scored table directly, already sorted by risk.
      const result = await postPredictBatch(
        records as unknown as Parameters<typeof postPredictBatch>[0],
      );
      setScored(result);
      setUnrecognised(headers.filter((header) => header !== "area_id" && !modelAnswers.has(header)));
    } catch (caught) {
      setError(
        caught instanceof PredictError
          ? caught.message
          : "Could not reach the model. Start the API, then try again.",
      );
      setScored(null);
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    if (!scored) return;
    const csv = toCsv(
      ["rank", ...headers, "probability", "risk_band", "cluster", "n_recommendations"],
      scored.map((row, index) => [
        index + 1,
        ...headers.map((header) => (row[header] as string | number | null) ?? null),
        row.probability,
        row.risk_band,
        row.cluster ?? "",
        row.n_recommendations ?? 0,
      ]),
    );
    downloadCsv("ethiofoodcast-scored.csv", csv);
  }

  return (
    <>
      <h1>Score a list of households</h1>
      <p className="muted">
        Upload a CSV with an <code>area_id</code> column and only the household answers needed for scoring.
        Do not include names, phone numbers, household identifiers, or free-text notes. Columns outside the
        deployed 14-question form are passed through to the output unchanged and are not scored.
      </p>
      <p className="small notice">
        The selected CSV is sent to the configured scoring API. This page does not store the file in browser
        storage, but the API host&apos;s logging and retention policies apply; do not upload identifying data.
      </p>

      <div className="upload">
        <label className="file-input">
          <input type="file" accept=".csv,text/csv" onChange={onFile} />
          <span>{fileName ?? "Choose a CSV file"}</span>
        </label>
        {records.length > 0 ? (
          <p className="small">
            <strong>{int(records.length)}</strong> rows, {int(headers.length)} columns
            {rowsMissingArea > 0 ? (
              <>
                {" "}
                ·{" "}
                <strong className="bad">
                  {rowsMissingArea} without a recognised area_id
                </strong>{" "}
                — those rows come back unscored rather than silently ranked
              </>
            ) : null}
          </p>
        ) : null}
        <button type="button" onClick={score} disabled={records.length === 0 || busy}>
          {busy ? "Scoring…" : "Score this file"}
        </button>
        <p className="small faint">
          One request is sent to the API at <code>{apiBaseUrl()}</code>. The browser does not save the upload.
        </p>
      </div>

      {unrecognised.length > 0 ? (
        <p className="small notice">
          <strong>Outside the deployed form:</strong> {unrecognised.join(", ")}. These columns were passed
          through unchanged and did not affect the scores. Check spelling if you expected one to be a model
          answer.
        </p>
      ) : null}

      {error ? <p className="bad">{error}</p> : null}

      {scored ? (
        <>
          <div className="table-actions">
            <p className="small">
              <strong>{int(scored.length)}</strong> rows scored, ranked by score.
            </p>
            <button type="button" className="secondary" onClick={exportCsv}>
              Download scored CSV
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Score</th>
                <th>Band</th>
                <th>Profile</th>
                <th>Areas to cover</th>
              </tr>
            </thead>
            <tbody>
              {scored.slice(0, 100).map((row, index) => (
                <tr key={index}>
                  <td>
                    <strong className="rank">{index + 1}</strong>
                  </td>
                  <td className="tabular small">{num(row.probability, 3)}</td>
                  <td>
                    <RampChip band={row.risk_band} />
                  </td>
                  <td className="small faint">{row.cluster ?? "—"}</td>
                  <td className="small">{int(row.n_recommendations ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {scored.length > 100 ? (
            <p className="small faint">
              Showing the first 100 rows; the CSV download carries all {int(scored.length)}.
            </p>
          ) : null}
        </>
      ) : (
        <>
          <h2 style={{ marginTop: "var(--rhythm)" }}>What the file needs</h2>
          <p className="small">
            One <code>area_id</code> column, and as many of the 14 graph-form answers as you have.
            Nine of 14 are enough to score. Unanswered questions are imputed rather than read as zero,
            so a partly filled row still produces a score with less behind it — never a refusal.
          </p>
          <SufficiencyMeter supplied={0} needed={9} expected={14} showProvenance />
        </>
      )}

      <p className="small faint">
        A row without a recognised <code>area_id</code> cannot be scored by the graph model, so it
        comes back unscored rather than ranked last. An unscored household must not appear on an
        assessment list.
      </p>
    </>
  );
}
