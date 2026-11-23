"use client";

/**
 * The evidence workspace, in four tabs:
 *   Search documents  local, offline keyword search over bundled project docs
 *   Ask AI            one question box; general (unverified) or cited answers
 *   My library        files kept in this browser only (OfflineEvidenceLibrary)
 *   Official sources  publisher links and metadata, never full text
 *
 * Rules that do not change with the layout:
 *   - Project documents and library files are never sent to Groq.
 *   - Every AI request needs fresh consent; consent resets after each request.
 *   - General answers are labelled unverified. Cited answers stay disabled until
 *     the server reports approved sources and passages.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { z } from "zod";

import projectDocuments from "@/data/evidence/project-documents.json";
import officialSources from "@/data/evidence/public-sources.json";
import { OfflineEvidenceLibrary } from "@/components/offline-evidence-library";
import { isSourceApprovedForGroq } from "@/lib/groq-approval";

type EvidenceDocument = {
  id: string;
  source: string;
  section: string;
  citation: string;
  content: string;
};

type SearchResult = EvidenceDocument & { score: number };
type OfficialSourceItem = {
  id: string;
  title: string;
  url: string;
  published_at: string | null;
  language: string;
  content_type: string;
};
type OfficialSource = {
  id: string;
  name: string;
  publisher_url: string;
  reuse_terms_url?: string;
  rights_notes?: string;
  content_type: string;
  rights_status: string;
  external_ai_policy?: string;
  offline_content_policy: string;
  retrieved_at: string;
  items: OfficialSourceItem[];
};

const documents = projectDocuments as EvidenceDocument[];
const localDocumentCount = new Set(documents.map((document) => document.source)).size;
const sourceSnapshot = officialSources as {
  retrieved_at: string | null;
  sources: OfficialSource[];
};
const groqApprovedSourceCount = sourceSnapshot.sources.filter(isSourceApprovedForGroq).length;
const officialItemCount = sourceSnapshot.sources.reduce((total, source) => total + source.items.length, 0);
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how",
  "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "was",
  "what", "when", "where", "which", "who", "with",
]);
const SUGGESTED_SEARCHES = ["evaluation caveats", "area context", "threshold", "PSNP", "offline use", "risk bands"];

type GroqAvailability = {
  available: boolean;
  reason: string;
  sourceCount: number;
  passageCount: number;
};

type AiMode = "general" | "cited";
type AiAnswer =
  | { mode: "general"; text: string; warning: string }
  | { mode: "cited"; text: string; citations: { label: string; url: string }[] };

const groqAnswerSchema = z.object({
  answer: z.string(),
  citations: z.array(z.object({
    label: z.string(),
    url: z.string().url(),
  })),
});
const generalAnswerSchema = z.object({
  answer: z.string(),
  verified: z.literal(false),
  warning: z.string(),
});
const failureSchema = z.object({ error: z.string() });

function termsFor(query: string): string[] {
  return [...new Set(
    (query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
      .filter((term) => term.length > 1 && !STOP_WORDS.has(term)),
  )];
}

/** Markdown emphasis and code marks read as noise in a plain-text excerpt. */
function readable(markdown: string): string {
  return markdown.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
}

function searchDocuments(query: string): SearchResult[] {
  const terms = termsFor(query);
  if (terms.length === 0) return [];

  return documents
    .map((document) => {
      const content = document.content.toLocaleLowerCase();
      const heading = `${document.source} ${document.section}`.toLocaleLowerCase();
      let score = 0;

      for (const term of terms) {
        const occurrences = content.split(term).length - 1;
        if (occurrences > 0) score += Math.min(occurrences, 5);
        if (heading.includes(term)) score += 4;
      }
      if (content.includes(query.trim().toLocaleLowerCase())) score += 5;
      return { ...document, score };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.citation.localeCompare(b.citation))
    .slice(0, 6);
}

const TABS = [
  { id: "search", label: "Search documents", hint: `${documents.length} passages` },
  { id: "ask", label: "Ask AI", hint: "Groq, with consent" },
  { id: "library", label: "My library", hint: "This device only" },
  { id: "sources", label: "Official sources", hint: `${officialItemCount} links` },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function LocalEvidenceSearch() {
  const baseId = useId();
  const [tab, setTab] = useState<TabId>("search");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Deep links: /copilot#ask opens the Ask AI tab.
  useEffect(() => {
    const fromHash = window.location.hash.replace("#", "");
    if (TABS.some((entry) => entry.id === fromHash)) setTab(fromHash as TabId);
  }, []);

  function select(next: TabId, focus = false) {
    setTab(next);
    window.history.replaceState(null, "", `#${next}`);
    if (focus) tabRefs.current[TABS.findIndex((entry) => entry.id === next)]?.focus();
  }

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = TABS.length - 1;
    const target =
      event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
        : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
          : event.key === "Home" ? 0
            : event.key === "End" ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    const entry = TABS[target];
    if (entry) select(entry.id, true);
  }

  return (
    <div className="evidence-workspace">
      <div className="tabs" role="tablist" aria-label="Evidence tools">
        {TABS.map((entry, index) => (
          <button
            key={entry.id}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${entry.id}`}
            aria-selected={tab === entry.id}
            aria-controls={`${baseId}-panel-${entry.id}`}
            tabIndex={tab === entry.id ? 0 : -1}
            className={tab === entry.id ? "tab active" : "tab"}
            onClick={() => select(entry.id)}
            onKeyDown={(event) => onTabKey(event, index)}
          >
            <span className="tab-label">{entry.label}</span>
            <span className="tab-hint">{entry.hint}</span>
          </button>
        ))}
      </div>

      {TABS.map((entry) => (
        <div
          key={entry.id}
          role="tabpanel"
          id={`${baseId}-panel-${entry.id}`}
          aria-labelledby={`${baseId}-tab-${entry.id}`}
          hidden={tab !== entry.id}
          className="tab-panel"
        >
          {entry.id === "search" ? <SearchPanel /> : null}
          {entry.id === "ask" ? <AskPanel /> : null}
          {entry.id === "library" ? <OfflineEvidenceLibrary /> : null}
          {entry.id === "sources" ? <SourcesPanel /> : null}
        </div>
      ))}
    </div>
  );
}

function SearchPanel() {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchDocuments(query), [query]);
  const hasSearch = termsFor(query).length > 0;

  return (
    <section aria-labelledby="search-heading">
      <div className="panel-intro">
        <h2 id="search-heading">Search project documents</h2>
        <p>
          Searches the project&apos;s own documentation on this device, with no network or AI call. Each result
          cites the document and section it came from.
        </p>
      </div>

      <div className="search-input evidence-search">
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M13 13l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search for a topic, for example evaluation caveats"
          aria-label="Search project documents"
          aria-describedby="local-evidence-status"
        />
      </div>

      <div className="suggestions" aria-label="Suggested searches">
        <span className="suggestions-label">Try</span>
        {SUGGESTED_SEARCHES.map((suggestion) => (
          <button key={suggestion} type="button" className="suggestion" onClick={() => setQuery(suggestion)}>
            {suggestion}
          </button>
        ))}
      </div>

      <p id="local-evidence-status" className="search-status" role="status" aria-live="polite">
        {!hasSearch
          ? `${documents.length} passages from ${localDocumentCount} project documents are available offline.`
          : results.length
            ? `${results.length} matching passage${results.length === 1 ? "" : "s"}, best match first.`
            : "No matching passages. Try a shorter or different word."}
      </p>

      {results.length > 0 ? (
        <ol className="search-results">
          {results.map((result) => (
            <li key={result.id} className="search-result">
              <p className="search-result-source">
                <span className="source-doc">{result.source}</span>
                <span className="source-section">{result.section}</span>
              </p>
              <p className="search-result-content">{readable(result.content)}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function AskPanel() {
  const [mode, setMode] = useState<AiMode>("general");
  const [question, setQuestion] = useState("");
  const [consent, setConsent] = useState(false);
  const [availability, setAvailability] = useState<GroqAvailability | null>(null);
  const [answer, setAnswer] = useState<AiAnswer | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const citedAvailable = availability?.available === true;

  useEffect(() => {
    const controller = new AbortController();
    async function loadAvailability() {
      try {
        const response = await fetch("/api/copilot/answer", { signal: controller.signal, cache: "no-store" });
        setAvailability((await response.json()) as GroqAvailability);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setAvailability({
          available: false,
          reason: caught instanceof Error
            ? `Could not check readiness: ${caught.message}`
            : "Could not check readiness.",
          sourceCount: 0,
          passageCount: 0,
        });
      }
    }
    void loadAvailability();
    return () => controller.abort();
  }, []);

  async function ask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!consent || working || question.trim().length < 3) return;
    if (mode === "cited" && !citedAvailable) return;

    setWorking(true);
    setConsent(false); // consent is per request
    setAnswer(null);
    setError("");
    try {
      const response = await fetch(mode === "cited" ? "/api/copilot/answer" : "/api/copilot/general-answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, consent: true }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const failure = failureSchema.safeParse(data);
        setError(failure.success ? failure.data.error : "The request failed.");
      } else if (mode === "cited") {
        const parsed = groqAnswerSchema.safeParse(data);
        if (parsed.success) setAnswer({ mode: "cited", text: parsed.data.answer, citations: parsed.data.citations });
        else setError("The server returned an invalid answer format.");
      } else {
        const parsed = generalAnswerSchema.safeParse(data);
        if (parsed.success) setAnswer({ mode: "general", text: parsed.data.answer, warning: parsed.data.warning });
        else setError("The server returned an invalid answer format.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? `Could not reach the server: ${caught.message}` : "Could not reach the server.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section aria-labelledby="ask-heading">
      <div className="panel-intro">
        <h2 id="ask-heading">Ask an AI assistant</h2>
        <p>
          Questions are answered by Groq, an external AI service, only after you consent to each request. Project
          documents and files in your library are never sent.
        </p>
      </div>

      <div className="ai-modes" role="radiogroup" aria-label="Answer type">
        <button
          type="button"
          role="radio"
          aria-checked={mode === "general"}
          className={mode === "general" ? "ai-mode active" : "ai-mode"}
          onClick={() => {
            setMode("general");
            setConsent(false);
          }}
        >
          <span className="ai-mode-title">General answer</span>
          <span className="ai-mode-text">From the model&apos;s general knowledge. Unverified and uncited.</span>
          <span className="ai-mode-state available">Available</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === "cited"}
          aria-disabled={!citedAvailable}
          className={`ai-mode${mode === "cited" ? " active" : ""}${citedAvailable ? "" : " unavailable"}`}
          onClick={() => {
            setMode("cited");
            setConsent(false);
          }}
        >
          <span className="ai-mode-title">Cited answer</span>
          <span className="ai-mode-text">Grounded in approved official passages, with citations.</span>
          <span className={citedAvailable ? "ai-mode-state available" : "ai-mode-state"}>
            {availability === null ? "Checking…" : citedAvailable ? "Available" : "Not yet available"}
          </span>
        </button>
      </div>

      {mode === "cited" && !citedAvailable ? (
        <div className="notice ai-unavailable" role="status">
          <strong>Cited answers are not available yet.</strong>{" "}
          {availability?.reason ?? "Checking whether approved sources are configured…"} {groqApprovedSourceCount} of{" "}
          {sourceSnapshot.sources.length} official sources are cleared for AI processing. See “How AI answers are
          controlled” below.
        </div>
      ) : (
        <form className="ai-form" onSubmit={(event) => void ask(event)}>
          <label htmlFor="ai-question" className="ai-label">
            Your question
          </label>
          <textarea
            id="ai-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            maxLength={500}
            rows={4}
            required
            minLength={3}
            placeholder="For example: What does the Productive Safety Net Programme provide?"
          />
          <div className="ai-form-meta">
            <span>{question.length}/500</span>
          </div>
          <label className="consent">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            <span>
              {mode === "cited"
                ? "Send this question and the matching approved public passages to Groq for this one request."
                : "Send only this question to Groq for this one request."}{" "}
              I have not included names or any personal, household or confidential information.
            </span>
          </label>
          <div className="ai-actions">
            <button type="submit" disabled={!consent || question.trim().length < 3 || working}>
              {working ? "Waiting for Groq…" : mode === "cited" ? "Ask with citations" : "Ask (unverified)"}
            </button>
            <span className="small faint">Consent resets after every request.</span>
          </div>
        </form>
      )}

      {error ? (
        <div className="error ai-result" role="alert">
          <strong>No answer.</strong> {error}
        </div>
      ) : null}

      {answer ? (
        <article className={`ai-result ai-answer ${answer.mode}`} aria-live="polite">
          <header>
            <span className={answer.mode === "general" ? "badge" : "badge verified"}>
              {answer.mode === "general" ? "Unverified · no sources checked" : "Cited answer"}
            </span>
          </header>
          <p className="ai-answer-text">{answer.text}</p>
          {answer.mode === "cited" ? (
            <>
              <h3>Sources used</h3>
              <ol>
                {answer.citations.map((citation) => (
                  <li key={`${citation.url}:${citation.label}`}>
                    <a href={citation.url} target="_blank" rel="noreferrer">{citation.label}</a>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="small muted">{answer.warning}</p>
          )}
          <p className="small faint">
            AI answers can be wrong. Check important or time-sensitive claims with an authoritative source. Never use
            an answer to decide assistance eligibility or make household-level decisions.
          </p>
        </article>
      ) : null}

      <details className="disclosure">
        <summary>How AI answers are controlled</summary>
        <ul>
          <li>
            A cited answer uses only reviewed public passages held on the server. A source needs verified reuse
            rights and a separate external-AI approval; the Ministry of Agriculture, WFP and FAO records are
            currently blocked, so cited answers stay off.
          </li>
          <li>Project documents and files in your library are never sent, even when they match a search.</li>
          <li>A general answer sends only your question and is always labelled unverified.</li>
        </ul>
        <h3>What is needed to switch on cited answers</h3>
        <ol>
          <li>Approved, versioned source documents with clear reuse rights.</li>
          <li>Separate external-AI approval for each source, and fresh consent for each request.</li>
          <li>A deployment choice for document storage, retrieval and the language model.</li>
          <li>Ingestion that keeps page-level citations and reports missing or stale sources.</li>
          <li>Review tests that check every generated claim against the retrieved passages.</li>
        </ol>
      </details>

      <ConnectionTest />
    </section>
  );
}

function ConnectionTest() {
  const [consent, setConsent] = useState(false);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  async function run() {
    if (!consent || working) return;
    setWorking(true);
    setResult("");
    setError("");
    setConsent(false);
    try {
      const response = await fetch("/api/copilot/groq-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const failure = failureSchema.safeParse(data);
        setError(failure.success ? failure.data.error : "Groq connection test failed.");
      } else {
        const parsed = z.object({ ok: z.literal(true), model: z.string(), reply: z.string() }).safeParse(data);
        if (!parsed.success) setError("Groq returned an unexpected test response.");
        else if (parsed.data.reply !== "OK") setError("Groq responded, but did not return the expected “OK”.");
        else setResult(`Connected. ${parsed.data.model} replied “OK”.`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? `Could not run the test: ${caught.message}` : "Could not run the test.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <details className="disclosure">
      <summary>Diagnostics: test the Groq connection</summary>
      <p className="small muted">
        Sends one fixed prompt (“Reply with exactly: OK”) to check the server&apos;s key, model and network. It
        sends no question, passages, documents or files.
      </p>
      <label className="consent">
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
        <span>I understand this sends a fixed test prompt to Groq.</span>
      </label>
      <button type="button" className="secondary" disabled={!consent || working} onClick={() => void run()}>
        {working ? "Testing…" : "Run connection test"}
      </button>
      {result ? <p className="library-status" role="status">{result}</p> : null}
      {error ? <p className="error ai-result" role="alert">{error}</p> : null}
    </details>
  );
}

function SourcesPanel() {
  return (
    <section aria-labelledby="sources-heading">
      <div className="panel-intro">
        <h2 id="sources-heading">Official source updates</h2>
        <p>
          Links and titles from official publishers. Full text and PDFs are not copied into the app until reuse
          rights are verified, and the list is refreshed manually
          {sourceSnapshot.retrieved_at ? ` (last checked ${new Date(sourceSnapshot.retrieved_at).toLocaleDateString()})` : ""}.
        </p>
      </div>
      {sourceSnapshot.sources.length === 0 ? (
        <p className="notice small">
          No source metadata has been synced yet. Run <code>python scripts/sync_official_sources.py</code>, then
          rebuild the frontend data.
        </p>
      ) : (
        <div className="source-cards">
          {sourceSnapshot.sources.map((source) => (
            <article className="source-card" key={source.id}>
              <header>
                <h3>
                  <a href={source.publisher_url} target="_blank" rel="noreferrer">
                    {source.name}
                  </a>
                </h3>
                <div className="source-badges">
                  <span className={source.rights_status === "verified" ? "badge verified" : "badge"}>
                    {source.rights_status === "verified"
                      ? "Reuse verified"
                      : source.rights_status === "conditional"
                        ? "Reuse has conditions"
                        : "Metadata only"}
                  </span>
                  <span className={isSourceApprovedForGroq(source) ? "badge verified" : "badge"}>
                    {isSourceApprovedForGroq(source) ? "AI sharing approved" : "AI sharing blocked"}
                  </span>
                </div>
              </header>
              {source.rights_notes ? <p className="small muted">{source.rights_notes}</p> : null}
              {source.items.length > 0 ? (
                <ul className="source-items">
                  {source.items.map((item) => (
                    <li key={item.id}>
                      <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
                      <span>
                        {item.content_type}
                        {item.published_at ? ` · ${new Date(item.published_at).toLocaleDateString()}` : ""}
                        {item.language === "am" ? " · Amharic" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="small faint">No entries were listed at the last check.</p>
              )}
              <footer>
                <span>Checked {new Date(source.retrieved_at).toLocaleDateString()}</span>
                {source.reuse_terms_url ? (
                  <a href={source.reuse_terms_url} target="_blank" rel="noreferrer">
                    Reuse terms
                  </a>
                ) : null}
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
