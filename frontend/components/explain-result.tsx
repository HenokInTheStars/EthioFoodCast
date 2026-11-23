"use client";

/**
 * "Explain this result": a plain-language explanation of one household's score,
 * written by the AI service from the result itself, the household's region and
 * profile figures, and the knowledge centre's sections on how scores work. Every
 * sentence cites its source. Sends only the score, the band, what moved it, the
 * survey area id and the profile id; never the interview answers.
 */
import { useEffect, useState } from "react";
import { z } from "zod";

import { CitedText, SourceList } from "@/components/cited-answer";
import type { Area, PredictResult } from "@/lib/api";

const responseSchema = z.object({
  status: z.literal("explained"),
  explanation: z.string(),
  citations: z.array(z.object({ n: z.number(), article: z.string(), section: z.string(), href: z.string() })),
});
type Explanation = z.infer<typeof responseSchema>;

const FIELD = /^[a-z0-9_]{1,60}$/;

function requestBody(result: PredictResult, area: Area | null) {
  return {
    score: result.probability,
    band: result.risk_band,
    flagged: result.flagged,
    answered: result.n_predictive_supplied,
    areaId: area?.id ?? null,
    profileId: result.cluster?.id ?? null,
    factors: result.top_factors
      .filter((factor) => FIELD.test(factor.source_field))
      .slice(0, 20)
      .map((factor) => ({ field: factor.source_field, contribution: factor.contribution })),
    prompts: result.recommendations.slice(0, 8).map((item) => ({
      category: item.category.slice(0, 60),
      prompt: item.prompt.slice(0, 240),
    })),
  };
}

export function ExplainResult({ result, area }: { result: PredictResult; area: Area | null }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/knowledge/ask", { signal: controller.signal, cache: "no-store" })
      .then((reply) => reply.json() as Promise<{ configured?: boolean }>)
      .then((data) => setConfigured(data.configured === true))
      .catch(() => {
        if (!controller.signal.aborted) setConfigured(null);
      });
    return () => controller.abort();
  }, []);

  // A new score makes the old explanation wrong.
  useEffect(() => {
    setExplanation(null);
    setError("");
  }, [result]);

  if (configured === false || result.probability === null) return null;

  async function explain() {
    if (working) return;
    setExplanation(null);
    setError("");
    if (!navigator.onLine) {
      setError("You are offline. Explanations need a connection; the reasons above still apply.");
      return;
    }
    setWorking(true);
    try {
      const reply = await fetch("/api/knowledge/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody(result, area)),
      });
      const data: unknown = await reply.json();
      if (!reply.ok) {
        const failure = z.object({ error: z.string() }).safeParse(data);
        setError(failure.success ? failure.data.error : "The explanation could not be loaded.");
        return;
      }
      const parsed = responseSchema.safeParse(data);
      if (parsed.success) setExplanation(parsed.data);
      else setError("The server sent the explanation in an unexpected format.");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="card result-section explain-result">
      <div className="explain-head">
        <div>
          <h3>Explain this result</h3>
          <p className="small muted">
            A short explanation in plain language, written by AI from this result, the figures for its region and
            profile, and the knowledge centre. Only the score and what moved it are sent, never the answers.
          </p>
        </div>
        <button type="button" className="button-secondary explain-button" onClick={explain} disabled={working}>
          {working ? "Explaining…" : explanation ? "Explain again" : "Explain this result"}
        </button>
      </div>

      <div aria-live="polite">
        {working ? (
          <div className="kc-answer is-loading" aria-busy="true">
            <span className="kc-skeleton" />
            <span className="kc-skeleton" />
            <span className="kc-skeleton short" />
          </div>
        ) : null}
        {error ? (
          <div className="kc-answer is-error" role="alert">
            <p>{error}</p>
          </div>
        ) : null}
        {explanation ? (
          <article className="kc-answer">
            <CitedText text={explanation.explanation} idPrefix="explain-source" />
            <SourceList citations={explanation.citations} idPrefix="explain-source" />
            <p className="kc-answer-foot">
              Written by AI. It does not change the score. Check it against the reasons above, and never use it to
              decide whether a household receives support.
            </p>
          </article>
        ) : null}
      </div>
    </div>
  );
}
