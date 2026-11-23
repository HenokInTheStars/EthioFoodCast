/** The knowledge centre's articles, prepared at build time by scripts/copy-data.mjs. */
import articlesData from "@/data/knowledge/articles.json";

export type KnowledgeSection = { id: string; heading: string; html: string };
export type KnowledgeArticle = {
  slug: string;
  title: string;
  summary: string;
  minutes: number;
  intro: string;
  sections: KnowledgeSection[];
};

export const articles = articlesData as KnowledgeArticle[];

export function findArticle(slug: string): KnowledgeArticle | undefined {
  return articles.find((article) => article.slug === slug);
}
