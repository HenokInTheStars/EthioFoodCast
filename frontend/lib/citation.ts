/**
 * How to cite EthioFoodCast. Keep in step with CITATION.cff at the repository
 * root and with content/knowledge/08-sources-and-citation.md.
 */
export const citation = {
  authors: [
    { family: "Solomon", given: "Henok" },
    { family: "Debesay", given: "Niyat" },
    { family: "Aman", given: "Amina" },
  ],
  year: 2026,
  title: "EthioFoodCast: household food-insecurity risk ranking for Ethiopia",
  medium: "Web application",
};

const initial = (given: string) => `${given[0]}.`;

/** APA style, e.g. "Solomon, H., Debesay, N., & Aman, A. (2026). Title [Web application]. url" */
export function apaCitation(url?: string): string {
  const names = citation.authors.map((author) => `${author.family}, ${initial(author.given)}`);
  const authors = names.length > 1 ? `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}` : names[0];
  return `${authors} (${citation.year}). ${citation.title} [${citation.medium}].${url ? ` ${url}` : ""}`;
}

export function bibtexCitation(url?: string, accessed?: string): string {
  const lines = [
    `  author = {${citation.authors.map((author) => `${author.family}, ${author.given}`).join(" and ")}}`,
    `  title = {{${citation.title}}}`,
    `  year = {${citation.year}}`,
    `  note = {${citation.medium}${accessed ? `, accessed ${accessed}` : ""}}`,
  ];
  if (url) lines.push(`  howpublished = {\\url{${url}}}`);
  return `@misc{ethiofoodcast${citation.year},\n${lines.join(",\n")}\n}`;
}
