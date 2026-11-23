import Link from "next/link";

import officialSources from "@/data/evidence/public-sources.json";
import { CiteBlock } from "@/components/cite-block";
import { KnowledgeAsk } from "@/components/knowledge-ask";
import { OfflineEvidenceLibrary } from "@/components/offline-evidence-library";
import { furtherReading } from "@/lib/further-reading";
import { articles } from "@/lib/knowledge";

export const metadata = {
  title: "Knowledge centre",
  description: "How EthioFoodCast works: the data, the model, its accuracy and limits, and how to use it responsibly.",
};

type SourceItem = { id: string; title: string; url: string; published_at: string | null; language: string };
type Source = { id: string; name: string; publisher_url: string; retrieved_at: string; items: SourceItem[] };

const sources = (officialSources as { retrieved_at: string | null; sources: Source[] }).sources.filter(
  (source) => source.items.length > 0,
);
const lastChecked = (officialSources as { retrieved_at: string | null }).retrieved_at;
const date = (value: string) =>
  new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default function KnowledgePage() {
  return (
    <>
      <section className="kc-hero">
        <p className="hero-eyebrow">Knowledge centre</p>
        <h1>Understand the data, the model and its limits</h1>
        <p className="hero-lede">
          Plain-language articles on how EthioFoodCast works and how to use it well. Search them, or ask a question
          and get a short answer that cites its sources.
        </p>
        <KnowledgeAsk />
      </section>

      <section className="home-section" aria-labelledby="topics-heading">
        <h2 id="topics-heading">Browse topics</h2>
        <ol className="topic-cards">
          {articles.map((article, index) => (
            <li key={article.slug}>
              <Link href={`/knowledge/${article.slug}`} className="topic-card">
                <span className="topic-card-number" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="topic-card-title">{article.title}</span>
                <span className="topic-card-text">{article.summary}</span>
                <span className="topic-card-meta">{article.minutes} min read</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="home-section" aria-labelledby="reading-heading">
        <h2 id="reading-heading">Further reading</h2>
        <p className="section-lede">
          A short, hand-picked list for going further: the surveys behind the model, how hunger is measured, and where
          to check current conditions. Links open the publisher&apos;s website.
        </p>
        <div className="reading-cards">
          {furtherReading.map((group) => (
            <article className="reading-card" key={group.id}>
              <h3>{group.heading}</h3>
              <ul>
                {group.items.map((item) => (
                  <li key={item.url}>
                    <a href={item.url} target="_blank" rel="noreferrer">
                      {item.title}
                    </a>
                    <span className="reading-publisher">{item.publisher}</span>
                    <span className="reading-note">{item.note}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        {sources.length > 0 ? (
          <>
            <h3 className="reading-subheading">Latest from official sources</h3>
            <p className="section-lede">
              Recent publications, listed automatically
              {lastChecked ? `; last checked on ${date(lastChecked)}` : ""}.
            </p>
            <div className="reading-cards">
              {sources.map((source) => (
                <article className="reading-card" key={source.id}>
                  <h4>{source.name}</h4>
                  <ul>
                    {source.items.slice(0, 4).map((item) => (
                      <li key={item.id}>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          lang={item.language === "am" ? "am" : undefined}
                        >
                          {item.title}
                        </a>
                        {item.published_at ? <span>{date(item.published_at)}</span> : null}
                      </li>
                    ))}
                  </ul>
                  <a className="reading-card-more" href={source.publisher_url} target="_blank" rel="noreferrer">
                    More from {source.name} <span aria-hidden="true">↗</span>
                  </a>
                </article>
              ))}
            </div>
          </>
        ) : null}
      </section>

      <section className="home-section" id="cite" aria-labelledby="cite-heading">
        <h2 id="cite-heading">Cite this work</h2>
        <p className="section-lede">
          If EthioFoodCast helps your report, paper or application, please cite it, together with the surveys it is
          built on.
        </p>
        <CiteBlock />
      </section>

      <section className="home-section">
        <details className="library-disclosure">
          <summary>
            <span className="library-disclosure-title">Your offline reference library</span>
            <span className="library-disclosure-text">
              Keep your own PDF, text and Markdown files on this device and search them without a connection. Files
              are never uploaded or sent to the AI assistant.
            </span>
          </summary>
          <OfflineEvidenceLibrary />
        </details>
      </section>
    </>
  );
}
