/**
 * An AI-written text with [n] markers, shown as numbered links to its sources.
 * Used by the knowledge centre's answers and by "Explain this result". The
 * `idPrefix` keeps the source anchors unique when both appear on one page.
 */
import Link from "next/link";

export type Citation = { n: number; article: string; section: string; href: string };

export const citationLabel = (item: { article: string; section: string }) =>
  item.section ? `${item.article}: ${item.section}` : item.article;

export function CitedText({ text, idPrefix }: { text: string; idPrefix: string }) {
  const paragraphs = text.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  return (
    <>
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="kc-answer-text">
          {paragraph.split(/(\[\d+\])/).map((piece, pieceIndex) => {
            const marker = /^\[(\d+)\]$/.exec(piece);
            if (!marker) return <span key={pieceIndex}>{piece}</span>;
            return (
              <a key={pieceIndex} className="kc-cite" href={`#${idPrefix}-${marker[1]}`}>
                <span className="visually-hidden">source </span>
                {marker[1]}
              </a>
            );
          })}
        </p>
      ))}
    </>
  );
}

export function SourceList({ citations, idPrefix }: { citations: Citation[]; idPrefix: string }) {
  return (
    <>
      <p className="kc-sources-title">Sources</p>
      <ol className="kc-sources numbered">
        {citations.map((citation) => (
          <li key={citation.n} id={`${idPrefix}-${citation.n}`}>
            {citation.href.startsWith("#") ? (
              <a href={citation.href}>{citationLabel(citation)}</a>
            ) : (
              <Link href={citation.href}>{citationLabel(citation)}</Link>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}
