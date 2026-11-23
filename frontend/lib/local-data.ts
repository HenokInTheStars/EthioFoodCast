export const ASSESS_DRAFT_KEY = "ethiofoodcast:assess:draft:v1";
export const ASSESS_RECENTS_KEY = "ethiofoodcast:assess:recents:v1";

export type RecentAssessment = {
  scoredAt: string;
  areaId: string;
  areaLabel: string;
  riskBand: string;
  probability: number | null;
};
