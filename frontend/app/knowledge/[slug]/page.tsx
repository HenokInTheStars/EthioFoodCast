import Link from "next/link";
import { notFound } from "next/navigation";

import { articles, findArticle } from "@/lib/knowledge";

export const dynamicParams = false;

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return articles.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({ params }: Props) {
  const article = findArticle((await params).slug);
  return article ? { title: article.title, description: article.summary } : {};
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params;
  const article = findArticle(slug);
  if (!article) notFound();

  const position = articles.indexOf(article);
  const previous = articles[position - 1];
  const next = articles[position + 1];

  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <ol>
          <li>
            <Link href="/knowledge">Knowledge centre</Link>
          </li>
          <li aria-current="page">{article.title}</li>
        </ol>
      </nav>

      <div className="article-layout">
        <article className="article">
          <header className="article-header">
            <h1>{article.title}</h1>
            <p className="article-summary">{article.summary}</p>
            <p className="article-meta">
              {article.minutes} min read · {article.sections.length} sections
            </p>
          </header>

          {/* Article HTML is rendered at build time from this project's own Markdown files. */}
          <div className="prose" dangerouslySetInnerHTML={{ __html: article.intro }} />
          {article.sections.map((section) => (
            <section key={section.id} id={section.id} className="article-section">
              <h2>{section.heading}</h2>
              <div className="prose" dangerouslySetInnerHTML={{ __html: section.html }} />
            </section>
          ))}

          <nav className="article-pager" aria-label="More articles">
            {previous ? (
              <Link href={`/knowledge/${previous.slug}`} className="pager-link">
                <span className="pager-label">Previous</span>
                <span className="pager-title">{previous.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link href={`/knowledge/${next.slug}`} className="pager-link next">
                <span className="pager-label">Next</span>
                <span className="pager-title">{next.title}</span>
              </Link>
            ) : null}
          </nav>
        </article>

        <aside className="article-aside">
          {article.sections.length > 1 ? (
            <nav className="toc" aria-labelledby="toc-heading">
              <h2 id="toc-heading">On this page</h2>
              <ol>
                {article.sections.map((section) => (
                  <li key={section.id}>
                    <a href={`#${section.id}`}>{section.heading}</a>
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}
          <div className="aside-ask">
            <h2>Have a question?</h2>
            <p>Search all articles, or ask and get an answer that cites its sources.</p>
            <Link href="/knowledge#ask" className="button-link secondary">
              Ask the knowledge centre
            </Link>
          </div>
        </aside>
      </div>
    </>
  );
}
