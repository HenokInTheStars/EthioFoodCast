import Link from "next/link";

import areas from "@/data/areas.json";
import comparison from "@/data/artifacts/comparison.json";
import drivers from "@/data/artifacts/drivers.json";
import performance from "@/data/artifacts/performance.json";
import distribution from "@/data/artifacts/risk_distribution.json";
import regionalSummary from "@/data/artifacts/regional_summary.json";
import { HomeLauncher } from "@/components/home-launcher";
import { int, num, pct, rampClass } from "@/lib/format";

/**
 * The overview. Everything here is read from the build artifacts at build time
 * (npm run data -> frontend/data/), so this page renders with no backend running:
 * a reader must be able to see what the model does and how well it does it
 * without starting a service.
 *
 * Nothing on this page is recomputed. If a number is not in an artifact, the
 * page does not show it.
 */

export const metadata = { title: "EthioFoodCast \u2014 overview" };

const BANDS = [
  { key: "High" as const, meaning: "at or above the flagged threshold" },
  { key: "Moderate" as const, meaning: "between the two cut points" },
  { key: "Low" as const, meaning: "below the lower cut point" },
];

/** regional_summary mixes suppressed and reported rows, so it is narrowed here
 * rather than at every use site. */
type RegionRow = {
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

const regions = regionalSummary as unknown as RegionRow[];
const reported = regions.filter((r) => !r.suppressed);
const withObserved = reported.filter((r) => typeof r.observed_rate === "number");
const biggestGap = withObserved.reduce<RegionRow | null>((worst, region) => {
  if (typeof region.mean_risk !== "number" || typeof region.observed_rate !== "number") return worst;
  if (worst === null || typeof worst.mean_risk !== "number" || typeof worst.observed_rate !== "number") return region;
  return Math.abs(region.observed_rate - region.mean_risk) > Math.abs(worst.observed_rate - worst.mean_risk)
    ? region
    : worst;
}, null);

const histogramMax = distribution.histogram.counts.reduce((max, count) => (count > max ? count : max), 0);
const topDomains = drivers.domains.slice(0, 4);
const topFields = drivers.fields.slice(0, 8);

export default function OverviewPage() {
  return (
    <>
      <h1>Where is food insecurity most likely in the surveyed agricultural households?</h1>
      <p className="muted">
        The service scores a household from the 14-question agricultural form and the surveyed area it sits
        in, then shows what moved the score. It ranks and describes. It does not decide who receives
        assistance.
      </p>

      <div className="grid stat-grid" style={{ marginBottom: "var(--rhythm)" }}>
        <div className="card">
          <h3>Households scored</h3>
          <div className="stat">{int(distribution.n_households)}</div>
          <div className="small faint">held-out agricultural households</div>
        </div>
        <div className="card">
          <h3>Observed food insecurity</h3>
          <div className="stat">{pct(distribution.observed_rate)}</div>
          <div className="small faint">the rate a scorer has to beat</div>
        </div>
        <div className="card">
          <h3>Flagged by the model</h3>
          <div className="stat">{int(distribution.flagged)}</div>
          <div className="small faint">
            {pct(distribution.flagged / distribution.n_households)} of the same households
          </div>
        </div>
        <div className="card">
          <h3>Survey areas</h3>
          <div className="stat">{int(areas.length)}</div>
          <div className="small faint">{int(performance.training.households)} households in training</div>
        </div>
      </div>

      <HomeLauncher />

      <h2>Score distribution</h2>
      <p className="small muted">
        {int(distribution.histogram.counts[distribution.histogram.counts.length - 1] ?? 0)} of{" "}
        {int(distribution.n_households)} households score above 0.90, and{" "}
        {int(distribution.histogram.counts[0] ?? 0)} below 0.10. The model separates the extremes far better
        than the middle, so treat a mid-range score as a question, not an answer.
      </p>

      <div className="ramp-bar" style={{ margin: "0.75rem 0 0.35rem" }}>
        {BANDS.map((band) => {
          const count = distribution.band_counts[band.key];
          const share = count / distribution.n_households;
          return (
            <span
              key={band.key}
              className={rampClass(band.key)}
              style={{ width: `${share * 100}%` }}
              title={`${band.key}: ${int(count)} households (${pct(share)}) \u2014 ${band.meaning}`}
            >
              {band.key} {pct(share)}
            </span>
          );
        })}
      </div>
      <p className="small faint">
        Bands are fixed cut points on a descriptive score, not calibrated probabilities of an outcome.
      </p>

      <div className="histogram" aria-hidden="true">
        {distribution.histogram.counts.map((count, index) => (
          <div
            key={index}
            style={{ height: `${histogramMax === 0 ? 0 : (count / histogramMax) * 100}%` }}
            title={`${num(distribution.histogram.edges[index] ?? 0, 1)}\u2013${num(distribution.histogram.edges[index + 1] ?? 1, 1)}: ${int(count)}`}
          />
        ))}
      </div>
      <p className="small faint" style={{ marginTop: "0.25rem" }}>
        Bins of 0.1 from 0.0 to 1.0. Left is low risk, right is high risk.
      </p>

      <h2 style={{ marginTop: "var(--rhythm)" }}>What moves a score</h2>
      <p>
        The largest single driver is not anything the interviewer asks: it is where the household sits. The
        area's neighbourhood context contributes <strong>{num(topDomains[0]?.share_pct ?? 0, 1)}%</strong> of
        the total movement when answers are withheld, more than land, livestock or income combined.
      </p>
      <ul className="plain small">
        {topDomains.map((domain) => (
          <li key={domain.group}>
            <span className="tag">{num(domain.share_pct, 1)}%</span> {domain.group}{" "}
            <span className="faint">({num(domain.total_mean_abs, 3)} mean absolute change)</span>
          </li>
        ))}
      </ul>

      <details>
        <summary className="small">Individual answers, ranked by how much they move a score</summary>
        <table style={{ marginTop: "0.5rem" }}>
          <thead>
            <tr>
              <th>Answer</th>
              <th>Domain</th>
              <th>Mean change</th>
              <th>Direction</th>
            </tr>
          </thead>
          <tbody>
            {topFields.map((field) => (
              <tr key={field.field}>
                <td>{field.field}</td>
                <td className="faint">{field.group}</td>
                <td>{num(field.mean_abs, 3)}</td>
                <td className="faint">
                  {field.share_increasing >= 0.5 ? "usually raises" : "usually lowers"} the score (
                  {pct(field.share_increasing)})
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small faint">{drivers.method}</p>
      </details>

      <h2 style={{ marginTop: "var(--rhythm)" }}>By region</h2>
      <p className="small muted">
        A region with too few surveyed households is shown greyed and hatched, in its place in the list, with
        its reason. Suppressed does not mean no risk; it means this survey cannot say.
      </p>
      <table>
        <thead>
          <tr>
            <th>Region</th>
            <th>Areas</th>
            <th>Households</th>
            <th>Mean score</th>
            <th>Flagged</th>
            <th>Observed</th>
          </tr>
        </thead>
        <tbody>
          {regions.map((region) => (
            <tr key={region.region_code}>
              <td>
                {region.suppressed ? <span className="suppressed">&nbsp;&nbsp;&nbsp;&nbsp;</span> : null}{" "}
                {region.region}
                {region.note ? <div className="small faint">{region.note}</div> : null}
              </td>
              <td>{region.suppressed ? <span className="faint">{"\u2014"}</span> : int(region.n_areas ?? null)}</td>
              <td>{int(region.n)}</td>
              <td>{region.suppressed ? <span className="faint">{"\u2014"}</span> : num(region.mean_risk ?? null, 2)}</td>
              <td>
                {region.suppressed ? (
                  <span className="faint">{"\u2014"}</span>
                ) : (
                  pct(region.flagged_share ?? null)
                )}
              </td>
              <td>
                {region.suppressed ? (
                  <span className="faint">{"\u2014"}</span>
                ) : (
                  pct(region.observed_rate ?? null)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {biggestGap ? (
        <p className="small muted" style={{ marginTop: "0.5rem" }}>
          The model's mean score and the observed rate disagree most in {biggestGap.region}:{" "}
          {num(biggestGap.mean_risk ?? null, 2)} against {pct(biggestGap.observed_rate ?? null)} on{" "}
          {int(biggestGap.n)} households, so a regional ordering is a lead to check, not a result.
        </p>
      ) : null}

      <h2 style={{ marginTop: "var(--rhythm)" }}>Is the model any good?</h2>
      <div className="grid">
        <div className="card">
          <h3>Recall on held-out</h3>
          <div className="stat">{pct(performance.holdout_seed0.recall, 1)}</div>
          <div className="small faint">
            of {int(performance.holdout_seed0.tp + performance.holdout_seed0.fn)} food-insecure households were
            flagged
          </div>
        </div>
        <div className="card">
          <h3>Precision on held-out</h3>
          <div className="stat">{pct(performance.holdout_seed0.precision, 1)}</div>
          <div className="small faint">
            {int(performance.holdout_seed0.fp)} food-secure households were flagged as well
          </div>
        </div>
        <div className="card">
          <h3>ROC AUC</h3>
          <div className="stat">{num(performance.holdout_seed0.roc_auc, 2)}</div>
          <div className="small faint">
            five-split mean {num(performance.five_split.roc_auc_mean, 2)}
          </div>
        </div>
        <div className="card">
          <h3>PR AUC</h3>
          <div className="stat">{num(performance.holdout_seed0.pr_auc, 2)}</div>
          <div className="small faint">against a {pct(performance.baseline_rate)} baseline rate</div>
        </div>
      </div>

      <table style={{ marginTop: "0.75rem" }}>
        <thead>
          <tr>
            <th>Model</th>
            <th>Family</th>
            <th>Accuracy</th>
            <th>ROC AUC</th>
            <th>Recall</th>
          </tr>
        </thead>
        <tbody>
          {comparison.models.map((model) => (
            <tr key={model.key}>
              <td>{model.label}</td>
              <td className="faint">{model.family}</td>
              <td>{num(model.accuracy_mean, 3)}</td>
              <td>{num(model.roc_auc_mean, 3)}</td>
              <td>{num(model.recall_mean, 3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small faint">
        Target accuracy {num(comparison.target_accuracy, 2)}; the deployed model's five-split mean is{" "}
        {num(performance.five_split.accuracy_mean, 3)} with a seed-to-seed sd of{" "}
        {num(performance.five_split.accuracy_sd, 3)}. Differences smaller than about{" "}
        {num(performance.five_split.accuracy_sd * 2, 3)} are noise, and the gap between the top two models is
        smaller than that.
      </p>

      <h2 style={{ marginTop: "var(--rhythm)" }}>Score a household</h2>
      <p>
        Answer as few as {int(performance.min_answers)} of the {int(performance.answers.length)} questions to
        get a score, and as many as you can to get a useful one. An unanswered question is treated as unknown,
        never as zero, and the result reports how much data it had.
      </p>
      <p>
        <a href="/assess">Assess a household</a>{" "}
        <span className="faint">&middot; flag threshold {num(performance.threshold, 3)}</span>
      </p>
    </>
  );
}
