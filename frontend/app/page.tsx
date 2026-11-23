import performance from "@/data/artifacts/performance.json";
import distribution from "@/data/artifacts/risk_distribution.json";
import areas from "@/data/areas.json";
import { int, pct } from "@/lib/format";

/**
 * The landing page. It says what the tool does, shows the four numbers that
 * matter (including the 61% baseline, which must be seen before any score), and
 * sends the reader on. The detail lives on the Insights and About pages.
 *
 * Everything is read from the build data, so it renders with no API running.
 */

export const metadata = { title: { absolute: "EthioFoodCast — household food-security forecasting" } };

const STEPS = [
  {
    title: "Interview",
    text: "Choose where the household was surveyed and answer up to 14 short questions about the household, its farm, its animals and its income.",
  },
  {
    title: "Score and explain",
    text: "Get a risk level, the answers that moved it most, and topics to cover in a follow-up visit.",
  },
  {
    title: "Plan visits",
    text: "Rank many households at once and take the top of the list your team can reach.",
  },
];

const EXPLORE = [
  { href: "/situation", title: "Risk overview", text: "How scores are spread across households, regions and profiles." },
  { href: "/spatial", title: "Regional map", text: "Predicted risk and observed food insecurity, region by region." },
  { href: "/segments", title: "Household profiles", text: "Five kinds of farming household and how they differ." },
  { href: "/method", title: "How it works", text: "The model, how it was tested, and where it falls short." },
];

export default function OverviewPage() {
  const five = performance.five_split;
  return (
    <>
      <section className="hero">
        <p className="hero-eyebrow">Food-security forecasting · Ethiopia</p>
        <h1>Find the farming households most likely to face food insecurity</h1>
        <p className="hero-lede">
          EthioFoodCast scores a household from a short interview and the area where it was surveyed, explains what
          moved the score, and ranks households so field teams know whom to visit first. It supports a human
          assessment; it never decides who receives help.
        </p>
        <div className="hero-actions">
          <a className="button-link" href="/assess">
            Assess a household
          </a>
          <a className="button-link secondary" href="/plan">
            See the priority list
          </a>
        </div>
      </section>

      <section aria-labelledby="numbers-heading">
        <h2 id="numbers-heading" className="visually-hidden">
          Key numbers
        </h2>
        <div className="grid stat-grid">
          <div className="card">
            <h3>Test households</h3>
            <div className="stat">{int(distribution.n_households)}</div>
            <div className="small faint">never seen while the model was trained</div>
          </div>
          <div className="card">
            <h3>Were food insecure</h3>
            <div className="stat">{pct(distribution.observed_rate)}</div>
            <div className="small faint">the rate any useful model must beat</div>
          </div>
          <div className="card">
            <h3>Accuracy</h3>
            <div className="stat">{pct(five.accuracy_mean, 1)}</div>
            <div className="small faint">average over five independent tests</div>
          </div>
          <div className="card">
            <h3>Food-insecure households found</h3>
            <div className="stat">{pct(five.recall_mean, 1)}</div>
            <div className="small faint">of those who were, the share flagged</div>
          </div>
        </div>
      </section>

      <section aria-labelledby="how-heading" className="home-section">
        <h2 id="how-heading">How it works</h2>
        <ol className="steps">
          {STEPS.map((step, index) => (
            <li key={step.title} className="step-card">
              <span className="step-card-number" aria-hidden="true">
                {index + 1}
              </span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="explore-heading" className="home-section">
        <h2 id="explore-heading">Explore the results</h2>
        <div className="link-cards">
          {EXPLORE.map((entry) => (
            <a key={entry.href} href={entry.href} className="link-card">
              <span className="link-card-title">{entry.title}</span>
              <span className="link-card-text">{entry.text}</span>
              <span className="link-card-arrow" aria-hidden="true">
                →
              </span>
            </a>
          ))}
        </div>
      </section>

      <section aria-labelledby="use-heading" className="home-section responsible">
        <h2 id="use-heading">Built to support people, not replace them</h2>
        <ul>
          <li>
            <strong>A score is a starting point.</strong> It ranks households for a visit; a trained person makes the
            assessment.
          </li>
          <li>
            <strong>Risk levels are labels, not certainties.</strong> A household just below a cut-off is not
            meaningfully different from one just above it.
          </li>
          <li>
            <strong>Reasons are not causes.</strong> They show which answers moved the score, not why a household is
            struggling.
          </li>
          <li>
            <strong>No personal data.</strong> Interviews collect no names, and the {int(areas.length)} survey areas
            are shown by name only, never by location.
          </li>
        </ul>
      </section>
    </>
  );
}
