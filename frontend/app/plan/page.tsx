import { PlanClient } from "./plan-client";
import { CaveatBlock } from "@/components/caveat-block";
import { RampLegend } from "@/components/ramp-chip";

export const metadata = { title: "EthioFoodCast — assessment plan" };

export default function PlanPage() {
  return (
    <>
      <h1>Who to assess first</h1>
      <p className="muted">
        The ordered list is the product. Set your capacity, filter to what your team can reach, and
        take the top of the list — the estimate ranks households for a human follow-up assessment,
        it is not an eligibility decision.
      </p>

      <RampLegend />

      <PlanClient />

      <CaveatBlock
        title="What this list is not"
        caveats={[
          "An anonymised held-out historical set with surrogate ids — not a register of real beneficiaries.",
          "Ranking by model score is a lead to check, not a finding. Two households one place apart in the list are not meaningfully different.",
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
