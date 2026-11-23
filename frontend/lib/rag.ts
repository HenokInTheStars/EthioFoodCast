/**
 * Shared by the AI routes (/api/knowledge/ask and /api/knowledge/explain):
 * request checks, rate limiting, numbering the sources sent to the model, and
 * checking the citations in what comes back. Server only.
 */
import { NextRequest, NextResponse } from "next/server";
import type { z } from "zod";

const WINDOW_MS = 60_000;
const PER_CLIENT_LIMIT = Number(process.env.ASK_RATE_LIMIT ?? 6);
const GLOBAL_LIMIT = Number(process.env.ASK_GLOBAL_RATE_LIMIT ?? 60);

/** A numbered source as the model sees it and as the visitor sees it in the source list. */
export type RagSource = { article: string; section: string; href: string; text: string };
export type RagCitation = { n: number; article: string; section: string; href: string };

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/**
 * Same-origin only. Browsers mark every request with Sec-Fetch-Site, which a
 * page cannot set, so that is checked first; some browsers leave out Origin on
 * same-origin requests. Without it, the Origin must name the host the request
 * was sent to (the Host header, not request.url, which a proxy may rewrite).
 */
export function isSameSite(request: NextRequest): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin";
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return Boolean(origin && host && new URL(origin).host === host);
  } catch {
    return false;
  }
}

const recent = new Map<string, number[]>();

/** Sliding one-minute window per client and for the whole server, shared by every AI route. */
export function allowRequest(request: NextRequest, now = Date.now()): boolean {
  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const prune = (key: string) => (recent.get(key) ?? []).filter((time) => time > now - WINDOW_MS);
  const mine = prune(client);
  const all = prune("*");
  if ((PER_CLIENT_LIMIT > 0 && mine.length >= PER_CLIENT_LIMIT) || (GLOBAL_LIMIT > 0 && all.length >= GLOBAL_LIMIT)) {
    recent.set(client, mine);
    recent.set("*", all);
    return false;
  }
  recent.set(client, [...mine, now]);
  recent.set("*", [...all, now]);
  return true;
}

export const rateLimited = () =>
  json({ error: "Too many questions in a short time. Wait a minute and try again." }, 429, { "Retry-After": "60" });

/** Reads and validates a small JSON body; returns the data or a ready error response. */
export async function readBody<T extends z.ZodTypeAny>(
  request: NextRequest,
  schema: T,
  maxBytes: number,
  invalidMessage: string,
): Promise<{ data: z.infer<T> } | { response: NextResponse }> {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    return { response: json({ error: "The request is too large." }, 413) };
  }
  try {
    const result = schema.safeParse(JSON.parse(raw));
    return result.success ? { data: result.data } : { response: json({ error: invalidMessage }, 400) };
  } catch {
    return { response: json({ error: "The request was not valid JSON." }, 400) };
  }
}

export function numberedSources(sources: RagSource[]): string {
  return sources
    .map((source, index) => `[${index + 1}] ${source.article}${source.section ? ` > ${source.section}` : ""}\n${source.text}`)
    .join("\n\n");
}

/**
 * Every [n] marker must point at a source that was sent, and there must be at
 * least one; otherwise the text is not shown. Citations are renumbered in order
 * of first use, so the text reads [1], [2], ...
 */
export function checkCitations(
  text: string,
  sources: RagSource[],
): { ok: true; text: string; citations: RagCitation[] } | { ok: false } {
  const markers = [...text.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
  if (markers.length === 0 || markers.some((number) => number < 1 || number > sources.length)) return { ok: false };
  const order = [...new Set(markers)];
  const cleaned = text
    // A paragraph holding only markers belongs to the sentence before it.
    .replace(/\s*\n+\s*((?:\[\d+\]\s*)+)(?=\n|$)/g, " $1")
    .trim()
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\[(\d+)\]/g, (_, n) => `[${order.indexOf(Number(n)) + 1}]`);
  const citations = order.map((number, index) => {
    const source = sources[number - 1] as RagSource;
    return { n: index + 1, article: source.article, section: source.section, href: source.href };
  });
  return { ok: true, text: cleaned, citations };
}

/** Removes a reasoning block some models put before the answer. */
export const stripThinking = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
