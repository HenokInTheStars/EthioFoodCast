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

export const metadata = { title: "EthioFoodCast — situation" };

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
      <h1>Where the risk sits in the surveyed households</h1>
      <p className="muted">{distribution.scope}</p>

      <div className="grid" style={{ marginBottom: "var(--rhythm)" }}>
        <div className="card">
          <h3>Households scored</h3>
          <div className="stat">{int(distribution.n_households)}</div>
          <div className="small faint">
            held-out agricultural households
            {distribution.n_rejected_by_validation > 0
              ? ` · ${int(distribution.n_rejected_by_validation)} rejected by validation`
              : " · none rejected by validation"}
          </div>
        </div>
        <div className="card">
          <h3>Observed food insecurity</h3>
          <div className="stat">{pct(distribution.observed_rate)}</div>
          <div className="small faint">the rate a scorer has to beat</div>
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
          <h3>Flag threshold</h3>
          <div className="stat">{num(performance.threshold, 3)}</div>
          <div className="small faint">one chosen operating point, not a boundary of fact</div>
        </div>
      </div>

      <h2>Bands</h2>
      <p className="small muted">
        Bands describe the score. They are not calibrated categories of assistance, and a household
        just under a cut point is not meaningfully different from one just over it.
      </p>
      <table>
        <thead>
          <tr>
            <th>Band</th>
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

      <h2 style={{ marginTop: "var(--rhythm)" }}>Raw score distribution</h2>
      <Histogram
        edges={distribution.histogram.edges}
        counts={distribution.histogram.counts}
        threshold={performance.threshold}
      />
      <p className="small faint">
        The distribution is bimodal rather than a smooth curve: the model separates the extremes
        better than the middle. Households near the line are where a human assessment matters most,
        because that is where the score is least confident.
      </p>

      <h2 style={{ marginTop: "var(--rhythm)" }}>By profile</h2>
      <table>
        <thead>
          <tr>
            <th>Profile</th>
            <th>Households</th>
            <th>Mean score</th>
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
        {int(regions.length - suppressed.length)} regions reported a figure, {int(unsurveyed.length)}{" "}
        were not surveyed at all, and {int(suppressed.length - unsurveyed.length)} were surveyed but
        fell below the reporting threshold. Regional ordering is a lead to check, not a result: the
        smallest reported cell holds 27 households, so one region&rsquo;s position can move on a
        handful of them. The per-region means are grouped here from the same scored households shown
        on <a href="/plan">the plan</a>, because the regional artifact carries counts and suppression
        flags rather than rates. See <a href="/spatial">the regional map</a> for the reportable
        aggregates; it does not plot household locations.
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
