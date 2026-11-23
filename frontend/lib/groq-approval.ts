export type GroqSourcePolicy = {
  id: string;
  rights_status: string;
  external_ai_policy?: string;
};

export type GroqPassage = {
  sourceId: string;
  citation: string;
  text: string;
  origin: "official_public_source" | "project_document" | "private_upload";
};

export type GroqApprovalResult<T extends GroqPassage = GroqPassage> =
  | { allowed: true; passages: T[] }
  | { allowed: false; reason: string };

export function isSourceApprovedForGroq(source: GroqSourcePolicy): boolean {
  return source.rights_status === "verified"
    && source.external_ai_policy === "approved";
}

/** Use with canonical retrieved passages before a provider call, never client-supplied text. */
export function approveGroqPassages<T extends GroqPassage>(
  passages: readonly T[],
  sources: readonly GroqSourcePolicy[],
  userConsentedForThisRequest: boolean,
): GroqApprovalResult<T> {
  if (!userConsentedForThisRequest) {
    return { allowed: false, reason: "Explicit consent is required for each Groq request." };
  }
  if (passages.length === 0) {
    return { allowed: false, reason: "No retrieved public-source passages are available." };
  }

  const sourcePolicies = new Map(sources.map((source) => [source.id, source]));
  const allPassagesApproved = passages.every((passage) => {
    if (
      passage.origin !== "official_public_source"
      || !passage.citation.trim()
      || !passage.text.trim()
    ) {
      return false;
    }
    const source = sourcePolicies.get(passage.sourceId);
    return source !== undefined && isSourceApprovedForGroq(source);
  });

  if (!allPassagesApproved) {
    return {
      allowed: false,
      reason: "Only cited passages from sources with verified external-AI rights may be shared.",
    };
  }

  return { allowed: true, passages: [...passages] };
}
