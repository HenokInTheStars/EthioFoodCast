import distributionData from "@/data/artifacts/risk_distribution.json";
import regionalData from "@/data/artifacts/regional_summary.json";
import scoredData from "@/data/artifacts/scored_households.json";
import performance from "@/data/artifacts/performance.json";
import { Histogram } from "@/components/histogram";
import { RegionCard, type RegionRow } from "@/components/region-card";
import { ProvenanceChip } from "@/components/provenance-chip";
import { RampChip } from "@/components/ramp-chip";
import { int, num, pct } from "@/lib/format";

/**
 * /situation -- the picture across the surveyed households.
 *
 * Band counts, the raw score histogram with the operating point drawn as a
 * line, and all eleven regions including the ones that were not surveyed.
 * Regions render in the artifact's own order so a suppressed region stays in
 * its real position.
 */

export const metadata = { title: "Risk overview" };

const distribution = distributionData as {
  n_households: number;
  band_counts: Record<string, number>;
  flagged: number;
  observed_rate: number;
  histogram: { edges: number[]; counts: number[] };
  by_cluster: { cluster: string; n: number; mean_risk: number; flagged_share: number }[];
  scope: string;
  n_rejected_by_validation: number;
};

const regions = regionalData as unknown as RegionRow[];

/**
 * `regional_summary.json` carries only counts and suppression flags, not rates,
 * so the per-region figures shown on the cards are derived here from the scored
 * households rather than invented. Both files describe the same held-out set and
 * their region counts agree exactly, so the join is a straight group-by.
 */
const scored = scoredData as {
  region_code: number;
  probability: number | null;
  flagged?: boolean;
}[];

const derivedByRegion = new Map<number, { mean_risk: number; flagged_share: number; n_scored: number }>();
for (const code of new Set(scored.map((row) => row.region_code))) {
  const rows = scored.filter((row) => row.region_code === code);
  const probabilities = rows
    .map((row) => row.probability)
    .filter((value): value is number => typeof value === "number");
  derivedByRegion.set(code, {
    mean_risk: probabilities.length
      ? probabilities.reduce((sum, value) => sum + value, 0) / probabilities.length
      : 0,
    flagged_share: rows.filter((row) => row.flagged).length / rows.length,
    n_scored: rows.length,
  });
}

const regionsWithFigures = regions.map((row) => {
  const derived = derivedByRegion.get(row.region_code);
  return derived ? { ...row, ...derived } : row;
});

export default function SituationPage() {
  const suppressed = regions.filter((row) => row.suppressed);
  const unsurveyed = regions.filter((row) => row.suppressed && row.n === 0);
  const bandTotal = Object.values(distribution.band_counts).reduce((sum, count) => sum + count, 0);

  return (
    <>
      <h1>Risk overview</h1>
      <p className="muted">
        How scores are spread across the {int(distribution.n_households)} test households: by risk level, by
        household profile and by region.
      </p>

      <div className="grid" style={{ marginBottom: "var(--rhythm)" }}>
        <div className="card">
          <h3>Test households</h3>
          <div className="stat">{int(distribution.n_households)}</div>
          <div className="small faint">
            farming households not used in training
            {distribution.n_rejected_by_validation > 0
              ? ` · ${int(distribution.n_rejected_by_validation)} could not be scored`
              : ""}
          </div>
        </div>
        <div className="card">
          <h3>Were food insecure</h3>
          <div className="stat">{pct(distribution.observed_rate)}</div>
          <div className="small faint">the rate any useful model must beat</div>
        </div>
        <div className="card">
          <h3>Flagged for follow-up</h3>
          <div className="stat">{int(distribution.flagged)}</div>
          <div className="small faint">
            {bandTotal > 0
              ? `${Math.round((distribution.flagged / bandTotal) * 100)}% of scored households`
              : ""}
          </div>
        </div>
        <div className="card">
          <h3>Follow-up cut-off</h3>
          <div className="stat">{num(performance.threshold, 3)}</div>
          <div className="small faint">households scoring above this are flagged for a visit</div>
        </div>
      </div>

      <h2>Risk levels</h2>
      <p className="small muted">
        Risk levels are labels for ranges of the score, not categories of need. A household just below
        a cut-off is not meaningfully different from one just above it.
      </p>
      <table>
        <thead>
          <tr>
            <th>Risk level</th>
            <th>Households</th>
            <th>Share</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(distribution.band_counts).map(([band, count]) => (
            <tr key={band}>
              <td>
                <RampChip band={band} />
              </td>
              <td className="tabular">{int(count)}</td>
              <td className="tabular">
                {bandTotal > 0 ? `${Math.round((count / bandTotal) * 100)}%` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ marginTop: "var(--rhythm)" }}>How scores are spread</h2>
      <Histogram
        edges={distribution.histogram.edges}
        counts={distribution.histogram.counts}
        threshold={performance.threshold}
      />
      <p className="small faint">
        Most households score near one end or the other: the model is clearest about the very likely and
        very unlikely cases. Households near the cut-off are where a visit matters most, because that is
        where the score is least certain.
      </p>

      <h2 style={{ marginTop: "var(--rhythm)" }}>By profile</h2>
      <table>
        <thead>
          <tr>
            <th>Profile</th>
            <th>Households</th>
            <th>Average score</th>
            <th>Flagged</th>
          </tr>
        </thead>
        <tbody>
          {distribution.by_cluster.map((row) => (
            <tr key={row.cluster}>
              <td>{row.cluster}</td>
              <td className="tabular">{int(row.n)}</td>
              <td className="tabular">{num(row.mean_risk, 2)}</td>
              <td className="tabular">{pct(row.flagged_share)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ marginTop: "var(--rhythm)" }}>By region</h2>
      <p className="small muted">
        All eleven regions, including the ones that were not surveyed. A region missing from the map
        reads as “no problem there”, which is false.
      </p>
      <div className="grid">
        {regionsWithFigures.map((row) => (
          <RegionCard row={row} key={row.region_code} />
        ))}
      </div>

      <p className="small faint">
        {int(regions.length - suppressed.length)} regions have figures, {int(unsurveyed.length)} were not
        surveyed, and {int(suppressed.length - unsurveyed.length)} had too few households to report. Treat
        the order of regions as a lead to check: the smallest region shown has only 27 households, so a few
        households can change its place. The <a href="/spatial">regional map</a> shows the same figures on a
        map.
      </p>

      <p className="footnote small">
        <ProvenanceChip
          source="risk_distribution.json + regional_summary.json"
          protocol="Seed-0 held-out agricultural households. The regional map uses public admin-1 boundaries and aggregates only; no household coordinates are exported."
          note="Cells below the reporting threshold are withheld, not zeroed: an unreported region is not a region with no risk. Per-region means are grouped from scored_households.json."
        />
      </p>
    </>
  );
}
