import { BatchClient } from "./batch-client";
import { CaveatBlock } from "@/components/caveat-block";
import { ProvenanceChip } from "@/components/provenance-chip";

export const metadata = { title: "EthioFoodCast — score a list" };

export default function BatchPage() {
  return (
    <>
      <h1>Score a list of households</h1>
      <p className="muted">
        Program staff work in Excel, so this is the operational door: one CSV in, one ranked list out,
        in your browser. The file is sent to the API for scoring and nothing is stored.
      </p>

      <BatchClient />

      <CaveatBlock
        title="What this page is not"
        caveats={[
          "A score is a lead to check, not a finding. Ranking by score is the whole of the claim.",
          "The 14-question agricultural form requires a surveyed area, because the area supplies the graph context the model needs.",
          "A column the server did not recognise is passed through untouched and reported back, never scored and never a reason to reject the file.",
        ]}
        provenance={{
          source: "POST /api/predict_batch",
          protocol:
            "Scored row by row by the deployed GCN ensemble. Predictors are separated from every other column at the frame level before validation.",
        }}
      />

      <p className="footnote small">
        <ProvenanceChip
          source="Batch scoring runs server-side"
          protocol="Nothing is stored server-side; the scored CSV is produced in the browser from the response."
        />
      </p>
    </>
  );
}
