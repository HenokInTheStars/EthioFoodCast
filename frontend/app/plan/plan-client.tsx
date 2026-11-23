"use client";

import { Fragment, useMemo, useState } from "react";

import householdsData from "@/data/artifacts/scored_households.json";
import performance from "@/data/artifacts/performance.json";
import regionsData from "@/data/artifacts/regions.json";
import { CapacitySlider } from "@/components/capacity-slider";
import { FactorBars, type Factor } from "@/components/factor-bars";
import { RampChip } from "@/components/ramp-chip";
import { useLens } from "@/lib/lens";
import { downloadCsv, toCsv } from "@/lib/csv";
import { int, num } from "@/lib/format";

/**
 * /plan -- the ordered list, which the brief calls "the product".
 *
 * Filtered client-side over the build-time artifact rather than over the
 * network: 454 KB and 484 rows keeps the response far under the serverless
 * payload ceiling, and the filter has to feel instant when a desk officer is
 * narrowing 484 households to the ones they can reach.
 *
 * The header must say these are anonymised held-out historical households with
 * surrogate ids, so the screen can never be read as a live beneficiary register.
 */

type Household = {
  surrogate_id: string;
  region_code: number;
  region: string;
  area_label: string;
  probability: number | null;
  risk_band: string;
  flagged: boolean;
  cluster: string | null;
  top_factors: Factor[];
  support_categories: string[];
};

// `scored_households.json` is a bare array of rows, not a wrapper object.
const households = householdsData as Household[];
const regions = regionsData as { code: number; name: string }[];
const benchmark = performance.holdout_seed0.precision_at_25pct;

const BANDS = ["High", "Moderate", "Low"] as const;

export function PlanClient() {
  const { lens } = useLens();
  const [region, setRegion] = useState<number | "all">("all");
  const [band, setBand] = useState<string | "all">("all");
  const [cluster, setCluster] = useState<string | "all">("all");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [capacity, setCapacity] = useState(50);
  const [expanded, setExpanded] = useState<string | null>(null);

  const clusters = useMemo(
    () =>
      Array.from(
        new Set(households.map((row) => row.cluster).filter((name): name is string => Boolean(name))),
      ).sort(),
    [],
  );

  const filtered = useMemo(() => {
    const rows = households.filter((row) => {
      if (region !== "all" && row.region_code !== region) return false;
      if (band !== "all" && row.risk_band !== band) return false;
      if (cluster !== "all" && row.cluster !== cluster) return false;
      if (flaggedOnly && !row.flagged) return false;
      return true;
    });
    // Sorted here rather than trusting the artifact's order.
    return rows.sort((a, b) => (b.probability ?? -1) - (a.probability ?? -1));
  }, [region, band, cluster, flaggedOnly]);

  const rankable = filtered.filter((row) => row.probability !== null).length;
  const shown = filtered.slice(0, Math.min(capacity, filtered.length));

  function exportCsv() {
    const csv = toCsv(
      ["rank", "surrogate_id", "region", "area_label", "probability", "risk_band", "cluster", "support_categories"],
      shown.map((row, index) => [
        index + 1,
        row.surrogate_id,
        row.region,
        row.area_label,
        row.probability,
        row.risk_band,
        row.cluster ?? "",
        row.support_categories.join("; "),
      ]),
    );
    downloadCsv("ethiofoodcast-assessment-plan.csv", csv);
  }
  return (
    <>
      <p className="muted">
        {int(households.length)} <strong>anonymous test households</strong>, each with a random ID. No
        names were ever collected, so nobody here can be identified.
      </p>

      <div className="filters">
        <label>
          Region
          <select
            value={String(region)}
            onChange={(event) =>
              setRegion(event.target.value === "all" ? "all" : Number(event.target.value))
            }
          >
            <option value="all">All regions</option>
            {regions.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Risk level
          <select value={band} onChange={(event) => setBand(event.target.value)}>
            <option value="all">All levels</option>
            {BANDS.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>
        <label>
          Profile
          <select value={cluster} onChange={(event) => setCluster(event.target.value)}>
            <option value="all">All profiles</option>
            {clusters.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={flaggedOnly}
            onChange={(event) => setFlaggedOnly(event.target.checked)}
          />
          Flagged only
        </label>
      </div>

      <CapacitySlider
        total={filtered.length}
        rankable={rankable}
        value={Math.min(capacity, rankable)}
        onChange={setCapacity}
        historicalPrecision={benchmark}
      />

      <div className="table-actions">
        <p className="small">
          Showing <strong>{int(shown.length)}</strong> of {int(filtered.length)} matching, ranked by
          score.
        </p>
        <button type="button" className="secondary" onClick={exportCsv}>
          Download these rows as CSV
        </button>
        <button type="button" className="secondary print-action" onClick={() => window.print()}>
          Print this plan
        </button>
      </div>

      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Score</th>
            <th>Risk level</th>
            <th>Region / area</th>
            <th>Profile</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row, index) => (
            <Fragment key={row.surrogate_id}>
              <tr
                className="rank-row"
                onClick={() => setExpanded(expanded === row.surrogate_id ? null : row.surrogate_id)}
              >
                <td>
                  <strong className="rank">{index + 1}</strong>
                  <span className="small faint"> {row.surrogate_id}</span>
                </td>
                <td className="tabular small">{num(row.probability, 3)}</td>
                <td>
                  <RampChip band={row.risk_band} />
                </td>
                <td className="small">
                  {row.region}
                  <span className="faint"> · {row.area_label}</span>
                </td>
                <td className="small faint">{row.cluster ?? "—"}</td>
              </tr>
              {expanded === row.surrogate_id ? (
                <tr className="row-detail">
                  <td colSpan={5}>
                    <div className="detail-grid">
                      <div>
                        <h4>What moved this score</h4>
                        <FactorBars
                          factors={row.top_factors}
                          limit={lens === "review" ? undefined : 3}
                          showSource={lens === "review"}
                        />
                      </div>
                      <div>
                        <h4>What to cover in follow-up</h4>
                        <ul className="plain">
                          {row.support_categories.map((category) => (
                            <li key={category} className="small">
                              {category}
                            </li>
                          ))}
                        </ul>
                        <p className="small faint">
                          Topics for the visit, not a decision.
                        </p>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>

      {shown.length === 0 ? (
        <p className="muted">No household matches these filters.</p>
      ) : (
        <p className="small faint">
          Select a row to see what moved its score and what to cover in a follow-up visit.
        </p>
      )}
    </>
  );
}
