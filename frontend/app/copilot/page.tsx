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
        Figures from testing the model. They describe the model, not current events, and are not policy advice.
      </p>

      <div className="grid stat-grid evidence-glance">
        <article className="card evidence-card">
          <h3>Survey area effect</h3>
          <p>
            Leaving out the survey area changes a test household&apos;s score by{" "}
            <strong>{num(areaContext?.mean_abs, 2)}</strong> on average.
          </p>
          <p className="small faint">This shows how the model works, not what causes hardship.</p>
          <Link href="/method">Model method and evaluation</Link>
        </article>

        <article className="card evidence-card">
          <h3>Regions</h3>
          <p>
            {int(reportedRegions)} regions have reportable summaries and {int(suppressedRegions)} are suppressed. The
            model was trained on {int(performance.training?.households)} households.
          </p>
          <p className="small faint">A region with no figure does not have zero risk.</p>
          <Link href="/situation">Survey situation</Link>
        </article>

        <article className="card evidence-card">
          <h3>Area label quality</h3>
          <p>
            {int(Number(areaSummary.areas))} area labels; zone and woreda names are verified at different rates.
          </p>
          <p className="small faint">Names marked “(approx.)” are not confirmed.</p>
          <Link href="/areas">Area labels</Link>
        </article>

        <article className="card evidence-card">
          <h3>Follow-up cut-off</h3>
          <p>
            Households scoring above <strong>{num(performance.threshold, 2)}</strong> are flagged for a visit. It is a
            cut-off for planning, not a line between need and no need.
          </p>
          <p className="small faint">Chosen during testing.</p>
          <Link href="/method">Evaluation caveats</Link>
        </article>
      </div>
    </>
  );
}
