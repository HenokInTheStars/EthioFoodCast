import { RampChip } from "./ramp-chip";
import { FactorBars, type Factor } from "./factor-bars";

/**
 * RegionCard -- one region, present whether or not it was surveyed.
 *
 * The brief's hardest visual rule: a suppressed region renders present-but-
 * hatched, in its real position, with its own note. Leaving it out would read as
 * "no problem there", which is false and dangerous in a conflict zone. So this
 * card has two shapes, and neither is a blank.
 */

export type RegionRow = {
  region_code: number;
  region: string;
  n: number;
  suppressed: boolean;
  note?: string;
  mean_risk?: number;
  observed_rate?: number;
  flagged_share?: number;
  high_share?: number;
  n_areas?: number;
  top_cluster?: string;
};

export function RegionCard({ row }: { row: RegionRow }) {
  // Two different reasons for a blank region, and the difference matters: one
  // was never surveyed, the other was but had too few households to report.
  // Saying "not surveyed" about a surveyed region would be a factual error.
  const unsurveyed = row.n === 0;

  if (row.suppressed) {
    return (
      <article className="card region-card suppressed" aria-label={`${row.region}: no reported data`}>
        <h3>{row.region}</h3>
        <p className="small">
          <strong>{unsurveyed ? "Not surveyed." : "Too few households to report."}</strong>{" "}
          {row.note ??
            (unsurveyed
              ? "No forecasts or outcomes for this region."
              : `Only ${row.n} households were surveyed, too few to report a figure.`)}
        </p>
        <p className="small faint">
          Shown in position because a region missing from the map reads as “no problem there”.
        </p>
      </article>
    );
  }

  return (
    <article className="card region-card">
      <h3>{row.region}</h3>
      <div className="stat-row">
        <span className="stat">{typeof row.mean_risk === "number" ? row.mean_risk.toFixed(2) : "—"}</span>
        <span className="small faint">average score</span>
      </div>
      <p className="small">
        {typeof row.observed_rate === "number" ? `${Math.round(row.observed_rate * 100)}%` : "—"}{" "}
        food insecure, of {row.n} households
        {typeof row.flagged_share === "number" ? ` · ${Math.round(row.flagged_share * 100)}% flagged` : ""}
      </p>
      {row.top_cluster ? <p className="small faint">Most common profile: {row.top_cluster}</p> : null}
    </article>
  );
}

/**
 * RankTable -- the ordered list, which the brief calls "the product".
 *
 * Rank is the largest glyph in a row; probability is small. Rows expand to the
 * top factors and the support categories, which is the handoff to a real
 * questionnaire. 484 rows need no virtualisation.
 *
 * `ranked` must already be sorted by probability, descending.
 */
export function RankRow({
  rank,
  household,
}: {
  rank: number;
  household: {
    surrogate_id: string;
    region: string;
    area_label?: string;
    probability: number | null;
    risk_band: string;
    flagged?: boolean;
    cluster?: string | null;
    top_factors?: Factor[];
    support_categories?: string[];
  };
}) {
  return (
    <tr className="rank-row">
      <td className="rank-cell">
        <strong className="rank">{rank}</strong>
        <span className="small faint">{household.surrogate_id}</span>
      </td>
      <td className="tabular small">{household.probability === null ? "—" : household.probability.toFixed(3)}</td>
      <td>
        <RampChip band={household.risk_band} />
      </td>
      <td className="small">
        {household.region}
        {household.area_label ? <span className="faint"> · {household.area_label}</span> : null}
      </td>
      <td className="small faint">{household.cluster ?? "—"}</td>
    </tr>
  );
}
