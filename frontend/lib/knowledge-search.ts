/**
 * Search over the knowledge centre, shared by the browser (instant, offline
 * search) and the server (choosing the passages an AI answer may cite). The
 * corpus holds the articles' sections and short summaries of the model's
 * results ("data" passages), which link to the dashboard that shows them.
 *
 * The corpus is about seventy short passages, so a small ranked keyword search is
 * enough: words are reduced to a rough stem and matched on a shared prefix, so
 * "accurate" finds "accuracy" and "irrigated" finds "irrigation". Rare words
 * count for more than common ones, and a match in a heading counts most.
 */
import passagesData from "@/data/knowledge/passages.json";

export type KnowledgePassage = {
  id: string;
  slug: string;
  article: string;
  section: string;
  anchor: string;
  kind: "article" | "data";
  /** Set on results summaries: the page that shows the figures. */
  href?: string;
  text: string;
};

export type KnowledgeMatch = KnowledgePassage & { score: number; href: string };

/** A piece of excerpt text; `hit` marks a word that matched the query. */
export type ExcerptPart = { text: string; hit: boolean };

export const passages = passagesData as KnowledgePassage[];

const STOP_WORDS = new Set([
  "a", "about", "an", "and", "any", "are", "as", "at", "be", "by", "can", "could", "do", "does", "explain",
  "for", "from", "get", "has", "have", "here", "how", "i", "if", "in", "into", "is", "it", "its", "many",
  "me", "mean", "means", "much", "my", "of", "on", "or", "our", "should", "so", "tell", "that", "the",
  "their", "them", "there", "these", "this", "to", "us", "was", "we", "what", "when", "where", "which",
  "who", "why", "will", "with", "would", "you", "your",
]);

const SUFFIXES = ["ations", "ation", "ments", "ment", "ness", "ities", "ity", "ings", "ing", "ies", "ied", "ers",
  "er", "ed", "es", "ly", "s", "e", "y"];

function stem(word: string): string {
  for (const suffix of SUFFIXES) {
    if (word.length - suffix.length >= 3 && word.endsWith(suffix)) return word.slice(0, -suffix.length);
  }
  return word;
}

/** Two stems match when they are equal or share a long enough prefix. */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = Math.min(a.length, b.length);
  if (shorter < 4) return false;
  let common = 0;
  while (common < shorter && a[common] === b[common]) common += 1;
  return common >= Math.max(4, shorter - 2);
}

const WORD = /[\p{L}\p{N}]+/gu;

export function queryTerms(query: string): string[] {
  const words = query.toLocaleLowerCase().match(WORD) ?? [];
  return [...new Set(words.filter((word) => word.length > 1 && !STOP_WORDS.has(word)).map(stem))];
}

type Indexed = { passage: KnowledgePassage; body: string[]; heading: string[] };

const index: Indexed[] = passages.map((passage) => ({
  passage,
  body: (passage.text.toLocaleLowerCase().match(WORD) ?? []).map(stem),
  heading: (`${passage.article} ${passage.section}`.toLocaleLowerCase().match(WORD) ?? []).map(stem),
}));

export function passageHref(passage: Pick<KnowledgePassage, "slug" | "anchor" | "href">): string {
  return passage.href ?? `/knowledge/${passage.slug}${passage.anchor ? `#${passage.anchor}` : ""}`;
}

export function findPassage(id: string): KnowledgePassage | undefined {
  return passages.find((passage) => passage.id === id);
}

export function searchKnowledge(
  query: string,
  limit = 6,
  { kind }: { kind?: KnowledgePassage["kind"] } = {},
): KnowledgeMatch[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];

  const documentFrequency = terms.map(
    (term) => index.filter((entry) => entry.body.some((word) => sameWord(word, term))
      || entry.heading.some((word) => sameWord(word, term))).length,
  );

  const phrase = query.trim().toLocaleLowerCase();
  const scored = index.filter((entry) => !kind || entry.passage.kind === kind).map((entry) => {
    let score = 0;
    let matchedTerms = 0;
    terms.forEach((term, position) => {
      const df = documentFrequency[position] ?? 0;
      if (df === 0) return;
      const idf = Math.log(1 + index.length / df);
      const inBody = Math.min(entry.body.filter((word) => sameWord(word, term)).length, 4);
      const inHeading = entry.heading.some((word) => sameWord(word, term)) ? 3 : 0;
      if (inBody + inHeading > 0) matchedTerms += 1;
      score += idf * (Math.sqrt(inBody) + inHeading);
    });
    // Reward passages that match more of the question, not just one word often.
    score *= matchedTerms / terms.length;
    if (phrase.length > 3 && entry.passage.text.toLocaleLowerCase().includes(phrase)) score += 3;
    return { ...entry.passage, score, href: passageHref(entry.passage) };
  });

  return scored
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/**
 * The most relevant stretch of a passage, about `length` characters, split into
 * parts so matched words can be highlighted without injecting HTML.
 */
export function excerpt(text: string, query: string, length = 260): ExcerptPart[] {
  const terms = queryTerms(query);
  const flat = text.replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();
  const isHit = (word: string) => terms.some((term) => sameWord(stem(word.toLocaleLowerCase()), term));

  // Start at the sentence with the most matching words.
  let best = 0;
  let bestHits = 0;
  for (const sentence of flat.matchAll(/[^.!?•]+[.!?]?/g)) {
    const hits = (sentence[0].match(WORD) ?? []).filter(isHit).length;
    if (hits > bestHits) {
      bestHits = hits;
      best = (sentence.index ?? 0) + (sentence[0].length - sentence[0].trimStart().length);
    }
  }
  const start = best;

  let snippet = flat.slice(start, start + length);
  if (start + length < flat.length) snippet = `${snippet.replace(/\s+\S*$/, "")}…`;
  if (start > 0) snippet = `…${snippet.trimStart()}`;

  const parts: ExcerptPart[] = [];
  let last = 0;
  for (const match of snippet.matchAll(WORD)) {
    if (!isHit(match[0])) continue;
    const at = match.index ?? 0;
    if (at > last) parts.push({ text: snippet.slice(last, at), hit: false });
    parts.push({ text: match[0], hit: true });
    last = at + match[0].length;
  }
  if (last < snippet.length) parts.push({ text: snippet.slice(last), hit: false });
  return parts;
}
