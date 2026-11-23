import { z } from "zod";

const finiteNumber = z.number().finite();
const nonNegativeInt = z.number().int().nonnegative();
const probability = finiteNumber.min(0).max(1);

const baseFactorRow = z.object({
  feature: z.string(),
  source_field: z.string(),
  contribution: finiteNumber,
  direction: z.string(),
});

const riskDistributionSchema = z.object({
  n_households: nonNegativeInt,
  band_counts: z.record(nonNegativeInt),
  flagged: nonNegativeInt,
  observed_rate: probability,
  histogram: z.object({
    edges: z.array(finiteNumber),
    counts: z.array(nonNegativeInt),
  }),
  by_cluster: z.array(
    z.object({
      cluster: z.union([z.string(), z.number().int()]),
      n: nonNegativeInt,
      mean_risk: finiteNumber,
      flagged_share: probability,
    }),
  ),
  n_rejected_by_validation: nonNegativeInt,
  scope: z.string(),
});

const regionSummaryRowSchema = z.object({
  region_code: z.number().int(),
  region: z.string(),
  n: nonNegativeInt,
  suppressed: z.boolean(),
  note: z.string().optional(),
  mean_risk: finiteNumber.optional(),
  observed_rate: probability.optional(),
  flagged_share: probability.optional(),
  high_share: probability.optional(),
  n_areas: nonNegativeInt.optional(),
  top_cluster: z.string().optional(),
});

const comparisonSchema = z.object({
  models: z.array(z.object({}).passthrough()),
  target_accuracy: finiteNumber,
  protocol: z.string(),
});

const performanceSchema = z.object({
  model: z.string().optional(),
  holdout_seed0: z.object({}).passthrough(),
  five_split: z.object({}).passthrough(),
  answers: z.array(z.string()),
  min_answers: nonNegativeInt,
  threshold: finiteNumber,
  baseline_rate: probability,
  training: z.object({}).passthrough(),
  split: z.string(),
}).passthrough();

const driverFieldSchema = z.object({
  field: z.string(),
  mean_abs: finiteNumber,
  mean_signed: finiteNumber,
  share_increasing: probability,
  group: z.string(),
});

const driverDomainSchema = z.object({
  group: z.string(),
  total_mean_abs: finiteNumber,
  share_pct: finiteNumber,
});

const driversSchema = z.object({
  method: z.string(),
  fields: z.array(driverFieldSchema),
  domains: z.array(driverDomainSchema),
});

const intakeEvaluationSchema = z.object({
  households: nonNegativeInt,
  threshold: finiteNumber,
  note: z.string(),
  selection: z.union([z.string(), z.object({}).passthrough()]),
  forms: z.array(z.object({}).passthrough()),
  missing_note: z.string(),
  missing: z.array(z.object({}).passthrough()),
}).passthrough();

const clustersSummarySchema = z.array(
  z.object({
    cluster: z.number().int(),
    name_: z.string(),
    n: nonNegativeInt,
    pct: finiteNumber,
    food_insecure_rate: probability,
  }),
);

const clusterProfileSchema = z.array(
  z.object({
    cluster: z.number().int(),
    name: z.string(),
    n: nonNegativeInt,
    pct: finiteNumber,
    food_insecure_rate: probability,
    profile: z.record(finiteNumber),
    z: z.record(finiteNumber),
  }),
);

const areaNamesSchema = z.object({
  summary: z.object({
    areas: nonNegativeInt,
    with_coordinates: nonNegativeInt,
    zone_matches_survey_zone_code: probability,
    woreda_matches_survey_woreda_code: probability,
    zone_verified_share: probability,
    woreda_verified_share: probability,
    areas_without_zone_name: nonNegativeInt,
    rule: z.string(),
    source: z.string(),
  }).passthrough(),
  areas: z.record(
    z.object({
      region_name: z.string(),
      zone: z.string().nullable().optional(),
      woreda: z.string().nullable().optional(),
      zone_verified: z.boolean(),
      woreda_verified: z.boolean(),
      label: z.string(),
    }),
  ),
});

const regionCodesSchema = z.array(
  z.object({
    code: z.number().int(),
    name: z.string(),
  }),
);

const scoredHouseholdSchema = z.array(
  z.object({
    surrogate_id: z.string(),
    region_code: z.number().int(),
    region: z.string(),
    area_label: z.string(),
    agricultural: z.union([z.number(), z.boolean()]),
    probability: z.number().finite().nullable().optional(),
    risk_band: z.string(),
    flagged: z.boolean(),
    cluster: z.union([z.string(), z.number()]).nullable().optional(),
    top_factors: z.array(baseFactorRow),
    support_categories: z.array(z.string()),
  }).passthrough(),
);

const fieldLabelsSchema = z.record(z.string());
const fieldHelpSchema = z.record(z.string());

const derivedAreaSchema = z.array(
  z.object({
    id: z.string(),
    region_code: z.number().int(),
    region_name: z.string(),
    zone: z.string().nullable(),
    woreda: z.string().nullable(),
    zone_verified: z.boolean(),
    woreda_verified: z.boolean(),
    label: z.string(),
  }),
);

export const artifactSchemas = {
  "ui_graph/risk_distribution.json": riskDistributionSchema,
  "ui_graph/regional_summary.json": z.array(regionSummaryRowSchema),
  "ui_graph/comparison.json": comparisonSchema,
  "ui_graph/performance.json": performanceSchema,
  "ui_graph/drivers.json": driversSchema,
  "ui_graph/intake_evaluation.json": intakeEvaluationSchema,
  "ui_graph/cluster_profiles.json": clusterProfileSchema,
  "ui_graph/regions.json": regionCodesSchema,
  "ui_graph/area_names.json": areaNamesSchema,
  "ui_graph/scored_households.json": scoredHouseholdSchema,
  "ui_graph/field_labels.json": fieldLabelsSchema,
  "ui_graph/field_help.json": fieldHelpSchema,
  "ui/clusters.json": clustersSummarySchema,
  "areas.json": derivedAreaSchema,
};

export function validateArtifact(relativePath, value) {
  const schema = artifactSchemas[relativePath];
  if (!schema) {
    throw new Error(`No zod schema is registered for ${relativePath}`);
  }

  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    throw new Error(`${relativePath} failed schema validation: ${issues}`);
  }

  return result.data;
}
