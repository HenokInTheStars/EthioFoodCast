import { PlanClient } from "./plan-client";
import { CaveatBlock } from "@/components/caveat-block";
import { RampLegend } from "@/components/ramp-chip";

export const metadata = { title: "Plan assessments" };

export default function PlanPage() {
  return (
    <>
      <h1>Who to assess first</h1>
      <p className="muted">
        Set how many households your team can visit, filter to the places you can reach, and take the top
        of the list. The ranking guides follow-up visits; it does not decide who receives help.
      </p>

      <RampLegend />

      <PlanClient />

      <CaveatBlock
        title="What this list is not"
        caveats={[
          "Anonymous test households from a past survey, each with a random ID: not a list of real people to visit.",
          "The ranking is a lead to check, not a finding. Two households a few places apart are not meaningfully different.",
          "Households that could not be scored are excluded from the list, not placed at the bottom.",
        ]}
        provenance={{
          source: "scored_households.json",
          protocol:
            "Seed-0 held-out agricultural households, never used to fit the deployed graph model, scored by that same model.",
        }}
      />
    </>
  );
}
