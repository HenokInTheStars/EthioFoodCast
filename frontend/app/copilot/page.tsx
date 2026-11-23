import Link from "next/link";

import areaNamesData from "@/data/artifacts/area_names.json";
import driversData from "@/data/artifacts/drivers.json";
import performanceData from "@/data/artifacts/performance.json";
import regionalData from "@/data/artifacts/regional_summary.json";
import { LocalEvidenceSearch } from "@/components/local-evidence-search";
import { int, num, pct } from "@/lib/format";

export const metadata = { title: "Evidence desk — EthioFoodCast" };

const regions = regionalData as {
  region_code: number;
  region: string;
  n: number;
  suppressed: boolean;
}[];
const areaSummary = (areaNamesData as { summary: Record<string, unknown> }).summary;

export default function EvidenceDeskPage() {
  const areaContext = driversData.fields.find((field) => field.field === "area_context");
  const reportedRegions = regions.filter((region) => !region.suppressed).length;
  const suppressedRegions = regions.filter((region) => region.suppressed).length;
  const performance = performanceData as {
    training?: { households?: number };
    threshold?: number;
  };

  return (
    <>
      <h1>Reviewer evidence desk</h1>
      <p className="muted">
        A transparent evidence workspace with local document search, an unverified general-answer
        option, and a separate document-grounded reviewer copilot that stays disabled until sources
        are approved. Project metrics are not presented as external research.
      </p>

      <section className="readiness-panel" aria-labelledby="copilot-status">
        <div className="readiness-heading">
          <span className="tag">Local search available</span>
          <h2 id="copilot-status">Local project-document search is ready</h2>
        </div>
        <p className="small">
          This first step searches bundled project documentation and cites its source section.
          Official Ministry, WFP, and FAO pages provide metadata and links only; source-specific
          reuse conditions are shown below. PDF, TXT, and Markdown files can be imported into this
          browser's offline library when you have permission. Files and extracted text remain on
          this device and are not sent to a server or Groq. In production, open this page online
          once to cache the app shell for offline use.
        </p>
      </section>

      <LocalEvidenceSearch />

      <h2>Available project evidence</h2>
      <p className="small muted">
        These are local, build-time evaluation artifacts. They can describe this model and its
        evaluation, but they cannot substantiate a current market shock, regional event, or policy
        recommendation.
      </p>

      <div className="grid">
        <article className="card evidence-card">
          <h3>Model sensitivities</h3>
          <p>
            Area context has an average absolute prediction change of{" "}
            <strong>{num(areaContext?.mean_abs, 3)}</strong> when withheld in held-out evaluation.
          </p>
          <p className="small faint">
            Source: <code>drivers.json</code>. Sensitivities are model behaviour, not causes.
          </p>
          <Link href="/method">Review model method and evaluation</Link>
        </article>

        <article className="card evidence-card">
          <h3>Regional evaluation</h3>
          <p>
            {int(reportedRegions)} regions have reportable summaries; {int(suppressedRegions)} are
            suppressed or unavailable. The project training artifact covers{" "}
            {int(performance.training?.households)} households.
          </p>
          <p className="small faint">
            Source: <code>regional_summary.json</code> and <code>performance.json</code>. Suppressed
            values are not zero.
          </p>
          <Link href="/situation">Review survey situation</Link>
        </article>

        <article className="card evidence-card">
          <h3>Area label quality</h3>
          <p>
            {int(Number(areaSummary.areas))} area labels are available; zone and woreda matches have
            different verification rates.
          </p>
          <p className="small faint">
            Source: <code>area_names.json</code>; the underlying labels are approximate.
          </p>
          <Link href="/areas">Review area labels</Link>
        </article>

        <article className="card evidence-card">
          <h3>Scoring threshold</h3>
          <p>
            The current model threshold is {num(performance.threshold, 3)}. It is one evaluation
            operating point, not an assistance eligibility boundary.
          </p>
          <p className="small faint">Source: <code>performance.json</code>.</p>
          <Link href="/method">Read evaluation caveats</Link>
        </article>
      </div>

      <section className="readiness-panel evidence-next" aria-labelledby="next-steps-heading">
        <h2 id="next-steps-heading">What is needed to activate a cited copilot</h2>
        <ol>
          <li>Approved, versioned source documents with clear reuse rights.</li>
          <li>Separate external-AI rights approval and fresh user consent for each request.</li>
          <li>A deployment choice for document storage, retrieval, and the language model.</li>
          <li>Ingestion that preserves page-level citations and reports missing or stale sources.</li>
          <li>Review tests that verify every generated claim against retrieved source passages.</li>
        </ol>
        <p className="small">
          Keep model occlusion explanations separate from retrieved regional context; neither
          establishes causality or determines assistance.
        </p>
      </section>

      <p className="footnote small">
        Project documentation and imported documents are searched locally. Imported document
        storage is browser-specific. No generated answers are provided.
      </p>
    </>
  );
}
