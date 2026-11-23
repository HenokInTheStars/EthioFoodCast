import { BatchClient } from "./batch-client";
import { CaveatBlock } from "@/components/caveat-block";
import { ProvenanceChip } from "@/components/provenance-chip";

export const metadata = { title: "Score a list" };

export default function BatchPage() {
  return (
    <>
      <h1>Score a list of households</h1>
      <p className="muted">
        Upload a CSV with one household per row and get the same list back, ranked by score. The file is
        sent to the scoring service only to be scored; nothing is stored.
      </p>

      <BatchClient />

      <CaveatBlock
        title="What this page is not"
        caveats={[
          "A score is a lead to check, not a finding.",
          "Each row needs a survey area (area_id), because where a household was surveyed strongly affects its score.",
          "Columns the service does not recognise, such as your own IDs or notes, come back unchanged and are never used for scoring.",
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
