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
      <h1>Evidence desk</h1>
      <p className="muted">
        Search the project&apos;s documentation, keep your own reference files on this device, and ask an AI
        assistant under clear rules. Project figures here describe this model; they are not external research.
      </p>

      <LocalEvidenceSearch />

      <h2>Project evidence at a glance</h2>
      <p className="small muted">
        Build-time evaluation figures. They describe this model and how it was evaluated; they cannot substantiate a
        current shock, a regional event or a policy recommendation.
      </p>

      <div className="grid stat-grid evidence-glance">
        <article className="card evidence-card">
          <h3>Model sensitivities</h3>
          <p>
            Withholding the survey-area context changes a held-out prediction by{" "}
            <strong>{num(areaContext?.mean_abs, 3)}</strong> on average.
          </p>
          <p className="small faint">Source: drivers.json. Sensitivities describe the model, not causes.</p>
          <Link href="/method">Model method and evaluation</Link>
        </article>

        <article className="card evidence-card">
          <h3>Regional evaluation</h3>
          <p>
            {int(reportedRegions)} regions have reportable summaries and {int(suppressedRegions)} are suppressed. The
            model was trained on {int(performance.training?.households)} households.
          </p>
          <p className="small faint">Source: regional_summary.json, performance.json. Suppressed is not zero.</p>
          <Link href="/situation">Survey situation</Link>
        </article>

        <article className="card evidence-card">
          <h3>Area label quality</h3>
          <p>
            {int(Number(areaSummary.areas))} area labels; zone and woreda names are verified at different rates.
          </p>
          <p className="small faint">Source: area_names.json. Labels are approximate.</p>
          <Link href="/areas">Area labels</Link>
        </article>

        <article className="card evidence-card">
          <h3>Scoring threshold</h3>
          <p>
            The operating threshold is <strong>{num(performance.threshold, 3)}</strong>: one evaluation operating
            point, not an eligibility boundary.
          </p>
          <p className="small faint">Source: performance.json.</p>
          <Link href="/method">Evaluation caveats</Link>
        </article>
      </div>
    </>
  );
}
