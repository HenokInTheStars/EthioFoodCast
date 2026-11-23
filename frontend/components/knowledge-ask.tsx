"use client";

/**
 * One box for both searching and asking.
 *
 * Typing searches the knowledge centre on this device, instantly and offline.
 * Pressing Ask sends only the question to the server, which picks the matching
 * passages itself and returns an AI-written answer that cites them, or says the
 * articles do not cover the question.
 */
import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { z } from "zod";

import { CitedText, SourceList, citationLabel as label, type Citation } from "@/components/cited-answer";
import { excerpt, queryTerms, searchKnowledge } from "@/lib/knowledge-search";

const SUGGESTIONS = [
  "How accurate is the model?",
  "Which region has the highest risk?",
  "What counts as food insecure?",
  "Why does the survey area matter?",
  "Can a score decide who gets aid?",
];

const citationSchema = z.object({
  n: z.number(),
  article: z.string(),
  section: z.string(),
  href: z.string(),
});
const responseSchema = z.union([
  z.object({ status: z.literal("answered"), answer: z.string(), citations: z.array(citationSchema) }),
  z.object({ status: z.literal("not_covered"), related: z.array(citationSchema.omit({ n: true })) }),
]);
type AskResponse = z.infer<typeof responseSchema>;

export function KnowledgeAsk() {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState("");
  const [response, setResponse] = useState<AskResponse | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);

  const matches = useMemo(() => searchKnowledge(query, 5), [query]);
  const hasTerms = queryTerms(query).length > 0;

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

  async function ask(question: string) {
    const trimmed = question.trim();
    if (trimmed.length < 3 || working) return;
    setAsked(trimmed);
    setResponse(null);
    setError("");
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setError("You are offline. Search still works below; answers need a connection.");
      return;
    }
    setWorking(true);
    try {
      const reply = await fetch("/api/knowledge/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const data: unknown = await reply.json();
      if (!reply.ok) {
        const failure = z.object({ error: z.string() }).safeParse(data);
        setError(failure.success ? failure.data.error : "The answer could not be loaded.");
        return;
      }
      const parsed = responseSchema.safeParse(data);
      if (parsed.success) setResponse(parsed.data);
      else setError("The server sent an answer in an unexpected format.");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setWorking(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (configured === false) return;
    void ask(query);
  }

  function suggest(question: string) {
    setQuery(question);
    if (configured !== false) void ask(question);
  }

  return (
    <div className="kc-ask" id="ask">
      <form className="kc-ask-form" onSubmit={onSubmit} role="search">
        <label htmlFor={inputId} className="visually-hidden">
          Search the knowledge centre or ask a question
        </label>
        <div className="kc-ask-field">
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M13 13l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            id={inputId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={500}
            autoComplete="off"
            placeholder="Search, or ask a question such as “How was the model tested?”"
          />
          {configured !== false ? (
            <button type="submit" className="primary" disabled={working || query.trim().length < 3}>
              {working ? "Answering…" : "Ask"}
            </button>
          ) : null}
        </div>
      </form>

      <div className="kc-suggestions" aria-label="Example questions">
        <span>Try</span>
        {SUGGESTIONS.map((suggestion) => (
          <button key={suggestion} type="button" className="suggestion" onClick={() => suggest(suggestion)}>
            {suggestion}
          </button>
        ))}
      </div>

      <p className="kc-ask-note">
        {configured === false
          ? "AI answers are switched off on this server. Matching sections appear as you type."
          : "Answers are written by an AI service (Groq) using only these articles and the model's published results, and cite what they use. Do not include names or personal details."}
      </p>

      <div aria-live="polite">
        {working ? (
          <div className="kc-answer is-loading" aria-busy="true">
            <p className="kc-answer-label">Answering “{asked}”</p>
            <span className="kc-skeleton" />
            <span className="kc-skeleton" />
            <span className="kc-skeleton short" />
          </div>
        ) : null}

        {error ? (
          <div className="kc-answer is-error" role="alert">
            <p className="kc-answer-label">No answer</p>
            <p>{error}</p>
          </div>
        ) : null}

        {response?.status === "answered" ? <Answer question={asked} text={response.answer} citations={response.citations} /> : null}

        {response?.status === "not_covered" ? (
          <div className="kc-answer is-empty">
            <p className="kc-answer-label">Not covered</p>
            <p>
              The knowledge centre does not answer “{asked}”. Try other words, or browse the topics below.
            </p>
            {response.related.length > 0 ? (
              <>
                <p className="kc-sources-title">Closest sections</p>
                <ul className="kc-sources">
                  {response.related.map((item) => (
                    <li key={item.href}>
                      <Link href={item.href}>{label(item)}</Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {hasTerms ? (
        <section className="kc-matches" aria-label="Matching sections">
          <p className="kc-matches-status" role="status">
            {matches.length
              ? `${matches.length} matching section${matches.length === 1 ? "" : "s"}`
              : "No matching sections. Try a shorter or different word."}
          </p>
          {matches.length > 0 ? (
            <ol className="kc-match-list">
              {matches.map((match) => (
                <li key={match.id}>
                  <Link href={match.href} className="kc-match">
                    <span className="kc-match-where">
                      <span className="kc-match-article">{match.article}</span>
                      {match.section ? <span className="kc-match-section">{match.section}</span> : null}
                    </span>
                    <span className="kc-match-text">
                      {excerpt(match.text, query).map((part, index) =>
                        part.hit ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>,
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function Answer({ question, text, citations }: { question: string; text: string; citations: Citation[] }) {
  return (
    <article className="kc-answer">
      <p className="kc-answer-label">Answer to “{question}”</p>
      <CitedText text={text} idPrefix="kc-source" />
      <SourceList citations={citations} idPrefix="kc-source" />
      <p className="kc-answer-foot">
        Written by AI from the sections above. Check the sources before relying on it, and never use an answer to
        decide whether a household receives support.
      </p>
    </article>
  );
}
