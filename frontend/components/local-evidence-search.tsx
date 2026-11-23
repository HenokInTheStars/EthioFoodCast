"use client";

import { useEffect, useMemo, useState } from "react";
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
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how",
  "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "was",
  "what", "when", "where", "which", "who", "with",
]);

type GroqAvailability = {
  available: boolean;
  reason: string;
  sourceCount: number;
  passageCount: number;
};

type GroqAnswer = {
  text: string;
  citations: { label: string; url: string }[];
};

type GeneralAnswer = {
  text: string;
  warning: string;
};

const groqAnswerSchema = z.object({
  answer: z.string(),
  citations: z.array(z.object({
    label: z.string(),
    url: z.string().url(),
  })),
});

function termsFor(query: string): string[] {
  return [...new Set(
    (query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
      .filter((term) => term.length > 1 && !STOP_WORDS.has(term)),
  )];
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

export function LocalEvidenceSearch() {
  const [query, setQuery] = useState("");
  const [question, setQuestion] = useState("");
  const [generalQuestion, setGeneralQuestion] = useState("");
  const [consent, setConsent] = useState(false);
  const [availability, setAvailability] = useState<GroqAvailability | null>(null);
  const [answer, setAnswer] = useState<GroqAnswer | null>(null);
  const [answerError, setAnswerError] = useState("");
  const [answerWorking, setAnswerWorking] = useState(false);
  const [generalConsent, setGeneralConsent] = useState(false);
  const [generalAnswer, setGeneralAnswer] = useState<GeneralAnswer | null>(null);
  const [generalAnswerError, setGeneralAnswerError] = useState("");
  const [generalAnswerWorking, setGeneralAnswerWorking] = useState(false);
  const [testConsent, setTestConsent] = useState(false);
  const [testWorking, setTestWorking] = useState(false);
  const [testResult, setTestResult] = useState("");
  const [testError, setTestError] = useState("");
  const results = useMemo(() => searchDocuments(query), [query]);
  const hasSearch = termsFor(query).length > 0;

  useEffect(() => {
    const controller = new AbortController();
    async function loadAvailability() {
      try {
        const response = await fetch("/api/copilot/answer", {
          signal: controller.signal,
          cache: "no-store",
        });
        const data = await response.json() as GroqAvailability;
        setAvailability(data);
      } catch (error) {
        if (controller.signal.aborted) return;
        setAvailability({
          available: false,
          reason: error instanceof Error
            ? `Could not check Groq readiness: ${error.message}`
            : "Could not check Groq readiness.",
          sourceCount: 0,
          passageCount: 0,
        });
      }
    }
    void loadAvailability();
    return () => controller.abort();
  }, []);

  async function requestAnswer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!consent || !availability?.available || answerWorking) return;

    setAnswerWorking(true);
    setConsent(false);
    setAnswer(null);
    setAnswerError("");
    try {
      const response = await fetch("/api/copilot/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, consent: true }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const failure = z.object({ error: z.string() }).safeParse(data);
        setAnswerError(
          failure.success ? failure.data.error : "The answer request failed.",
        );
      } else {
        const result = groqAnswerSchema.safeParse(data);
        if (!result.success) {
          setAnswerError("The server returned an invalid answer format.");
        } else {
          setAnswer({ text: result.data.answer, citations: result.data.citations });
        }
      }
    } catch (error) {
      setAnswerError(error instanceof Error
        ? `Could not request an answer: ${error.message}`
        : "Could not request an answer.");
    } finally {
      setAnswerWorking(false);
    }
  }

  async function testGroqConnection() {
    if (!testConsent || testWorking) return;
    setTestWorking(true);
    setTestResult("");
    setTestError("");
    setTestConsent(false);

    try {
      const response = await fetch("/api/copilot/groq-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const failure = z.object({ error: z.string() }).safeParse(data);
        setTestError(failure.success ? failure.data.error : "Groq connection test failed.");
      } else {
        const result = z.object({ ok: z.literal(true), model: z.string(), reply: z.string() })
          .safeParse(data);
        if (!result.success) {
          setTestError("Groq returned an unexpected test response.");
        } else if (result.data.reply !== "OK") {
          setTestError("Groq responded, but did not return the expected “OK” reply.");
        } else {
          setTestResult(`Connection successful. ${result.data.model} replied “OK”.`);
        }
      }
    } catch (error) {
      setTestError(error instanceof Error
        ? `Could not run the Groq test: ${error.message}`
        : "Could not run the Groq test.");
    } finally {
      setTestWorking(false);
    }
  }

  async function requestGeneralAnswer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!generalConsent || generalAnswerWorking) return;

    setGeneralAnswerWorking(true);
    setGeneralConsent(false);
    setGeneralAnswer(null);
    setGeneralAnswerError("");
    try {
      const response = await fetch("/api/copilot/general-answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: generalQuestion, consent: true }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const failure = z.object({ error: z.string() }).safeParse(data);
        setGeneralAnswerError(
          failure.success ? failure.data.error : "The general answer request failed.",
        );
      } else {
        const result = z.object({
          answer: z.string(),
          verified: z.literal(false),
          warning: z.string(),
        }).safeParse(data);
        if (!result.success) {
          setGeneralAnswerError("The server returned an invalid answer format.");
        } else {
          setGeneralAnswer({ text: result.data.answer, warning: result.data.warning });
        }
      }
    } catch (error) {
      setGeneralAnswerError(error instanceof Error
        ? `Could not request a general answer: ${error.message}`
        : "Could not request a general answer.");
    } finally {
      setGeneralAnswerWorking(false);
    }
  }

  return (
    <section className="readiness-panel local-evidence" aria-labelledby="local-evidence-heading">
      <div className="readiness-heading">
        <span className="tag">Local-only search</span>
        <h2 id="local-evidence-heading">Search project documents</h2>
      </div>
      <p className="small muted">
        Search the project&apos;s bundled documentation without a network or model call. Production
        installs cache this page and its assets after you open it online; the development server
        does not enable offline support. Results cite source sections. Internal project documents
        are never sent to Groq.
      </p>

      <section className="library-warning" aria-labelledby="groq-gate-heading">
        <h3 id="groq-gate-heading">
          Groq sharing gate: {availability?.available ? "ready" : "closed"}
        </h3>
        <p className="small">
          {groqApprovedSourceCount} official source
          {groqApprovedSourceCount === 1 ? " is" : "s are"} explicitly cleared for external AI
          processing. A source requires verified reuse rights and a separate external-AI approval;
          the current MoA, WFP, and FAO records are blocked. No public-source passages are currently
          cleared for Groq.
        </p>
        <p className="small">
          The endpoint only retrieves reviewed public-source passages from its server-side corpus.
          Project documents and offline uploads are excluded, even if they appear in local search.
        </p>
      </section>

      <section className="groq-answer" aria-labelledby="groq-answer-heading">
        <h3 id="groq-answer-heading">Ask the online evidence copilot</h3>
        <p className="small muted">
          When enabled, your question and matching cited public-source passages are sent to Groq.
          Review each source and consent separately for every request.
        </p>
        <p className="small faint" role="status" aria-live="polite">
          {availability
            ? availability.reason
            : "Checking whether approved sources and server configuration are available…"}
        </p>
        <section className="general-answer-panel" aria-labelledby="general-answer-heading">
          <h4 id="general-answer-heading">Ask without verified sources</h4>
          <p className="small muted">
            This mode sends only your question to Groq. It does not include FAO text, project
            documents, or offline uploads. The reply is general AI output, not verified research
            and not a cited RAG answer.
          </p>
          <form className="groq-answer-form" onSubmit={(event) => void requestGeneralAnswer(event)}>
            <label className="local-evidence-query">
              Your question
              <textarea
                value={generalQuestion}
                onChange={(event) => setGeneralQuestion(event.target.value)}
                maxLength={500}
                rows={3}
                required
                minLength={3}
                aria-describedby="general-answer-consent-note"
              />
            </label>
            <label className="library-consent">
              <input
                type="checkbox"
                checked={generalConsent}
                onChange={(event) => setGeneralConsent(event.target.checked)}
              />
              I consent to sending this question to Groq. I will not include personal, household,
              or confidential information.
            </label>
            <p id="general-answer-consent-note" className="small faint">
              This question is separate from the local search box and the cited-answer form below.
            </p>
            <button
              className="button"
              type="submit"
              disabled={!generalConsent || generalQuestion.trim().length < 3 || generalAnswerWorking}
            >
              {generalAnswerWorking ? "Generating unverified answer…" : "Ask Groq (unverified)"}
            </button>
          </form>
          {generalAnswerError ? (
            <p className="library-error" role="alert">{generalAnswerError}</p>
          ) : null}
          {generalAnswer ? (
            <div className="general-answer-result" aria-live="polite">
              <strong className="tag">Unverified · no source check</strong>
              <p className="small">{generalAnswer.warning}</p>
              <p className="groq-answer-text">{generalAnswer.text}</p>
              <p className="small faint">
                Verify important or time-sensitive claims with an authoritative source. This answer
                must not be used to determine assistance eligibility or make household-level decisions.
              </p>
            </div>
          ) : null}
        </section>
        <div className="groq-connection-test">
          <h4>Test Groq connection</h4>
          <p className="small muted">
            Sends one fixed “Reply with exactly: OK” prompt to Groq. It does not send your question,
            source passages, project documents, or offline uploads. This only checks API access; it
            does not enable cited answers.
          </p>
          <label className="library-consent">
            <input
              type="checkbox"
              checked={testConsent}
              onChange={(event) => setTestConsent(event.target.checked)}
            />
            I understand this sends a generic connection-test prompt to Groq.
          </label>
          <button
            className="button button-secondary"
            type="button"
            disabled={!testConsent || testWorking}
            onClick={() => void testGroqConnection()}
          >
            {testWorking ? "Testing Groq…" : "Run connection test"}
          </button>
          {testResult ? <p className="library-status" role="status">{testResult}</p> : null}
          {testError ? <p className="library-error" role="alert">{testError}</p> : null}
        </div>
        <form className="groq-answer-form" onSubmit={(event) => void requestAnswer(event)}>
          <label className="local-evidence-query">
            Question for the copilot
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              maxLength={500}
              rows={3}
              required
              minLength={3}
              aria-describedby="groq-consent-note"
            />
          </label>
          <label className="library-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            I consent to sending this question and the retrieved approved public passages to Groq
            for this request. My local project documents and offline uploads will not be sent.
          </label>
          <p id="groq-consent-note" className="small faint">
            Consent resets after every request. Never include personal, household, or confidential
            information in the question.
          </p>
          <button
            className="button"
            type="submit"
            disabled={!availability?.available || !consent || question.trim().length < 3 || answerWorking}
          >
            {answerWorking ? "Requesting answer…" : "Ask Groq with citations"}
          </button>
        </form>
        {answerError ? <p className="library-error" role="alert">{answerError}</p> : null}
        {answer ? (
          <div className="groq-answer-result" aria-live="polite">
            <h4>Answer</h4>
            <p className="groq-answer-text">{answer.text}</p>
            <h4>Sources used</h4>
            <ol>
              {answer.citations.map((citation) => (
                <li key={`${citation.url}:${citation.label}`}>
                  <a href={citation.url} target="_blank" rel="noreferrer">{citation.label}</a>
                </li>
              ))}
            </ol>
            <p className="small faint">
              AI-generated answers can be wrong. Check the cited source before relying on a claim.
            </p>
          </div>
        ) : null}
      </section>

      <label className="local-evidence-query">
        Search terms
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="For example: evaluation caveats or area context"
          aria-describedby="local-evidence-status"
        />
      </label>

      <p id="local-evidence-status" className="small faint" role="status" aria-live="polite">
        {!hasSearch
          ? `${documents.length} passages from ${localDocumentCount} project documents are bundled with the app.`
          : results.length
            ? `${results.length} matching passages shown.`
            : "No matching passages found in the offline project documents."}
      </p>

      {results.length > 0 ? (
        <div className="local-evidence-results">
          {results.map((result) => (
            <article className="card local-evidence-result" key={result.id}>
              <p className="small faint">{result.citation}</p>
              <p className="local-evidence-content">{result.content}</p>
            </article>
          ))}
        </div>
      ) : null}

      <section className="official-source-list" aria-labelledby="official-source-heading">
        <h3 id="official-source-heading">Official source updates</h3>
        <p className="small muted">
          Only official publisher links and metadata are listed here. Full text and PDFs remain
          disabled until reuse rights are verified; source sync is manual.
        </p>
        {sourceSnapshot.sources.length === 0 ? (
          <p className="small faint">
            No source metadata has been synced yet. Run <code>python scripts/sync_official_sources.py</code>,
            then rebuild the web data.
          </p>
        ) : (
          sourceSnapshot.sources.map((source) => (
            <div className="official-source" key={source.id}>
              <div>
                <a href={source.publisher_url} target="_blank" rel="noreferrer">
                  {source.name}
                </a>
                <span className="tag">
                  {source.rights_status === "verified"
                    ? "reuse verified"
                    : source.rights_status === "conditional"
                      ? "reuse has conditions"
                      : "metadata only"}
                </span>
                <span className="tag">
                  {isSourceApprovedForGroq(source) ? "Groq sharing approved" : "Groq sharing blocked"}
                </span>
                <p className="small faint">
                  {source.content_type} listing checked: {new Date(source.retrieved_at).toLocaleString()}
                  {" "}· reuse rights {source.rights_status}
                </p>
                {source.rights_notes ? <p className="small muted">{source.rights_notes}</p> : null}
                {source.reuse_terms_url ? (
                  <a className="small" href={source.reuse_terms_url} target="_blank" rel="noreferrer">
                    Review reuse terms
                  </a>
                ) : null}
              </div>
              {source.items.length > 0 ? (
                <ul className="official-source-items">
                  {source.items.map((item) => (
                    <li key={item.id}>
                      <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
                      <span className="small faint">
                        {item.content_type}
                        {item.published_at
                          ? ` · ${new Date(item.published_at).toLocaleDateString()}`
                          : " · date unavailable"}
                        {item.language === "am" ? " · Amharic title" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="small faint">No listing entries were available at the last sync.</p>
              )}
            </div>
          ))
        )}
      </section>

      <OfflineEvidenceLibrary />
    </section>
  );
}
