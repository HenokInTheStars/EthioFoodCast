import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 4 * 1024;
const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 8;
const GROQ_BASE_URL = process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1";
const requestTimes: number[] = [];

async function readGroqError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.clone().json() as { error?: { message?: string; type?: string } };
    const message = payload?.error?.message?.trim();
    if (message) return message;
  } catch {
    // Ignore JSON parse failures and fall back to the generic server error below.
  }
  return fallback;
}

const requestSchema = z.object({
  question: z.string().trim().min(3).max(500),
  consent: z.literal(true),
}).strict();

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return json({ error: "Requests must come from this app's origin." }, 403);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    return json({ error: "Request is too large." }, 413);
  }

  let body: unknown;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      return json({ error: "Request is too large." }, 413);
    }
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  const parsedRequest = requestSchema.safeParse(body);
  if (!parsedRequest.success) {
    return json({ error: "Enter a question and consent to sending it to Groq." }, 400);
  }

  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL;
  if (!apiKey || !model) {
    return json({ error: "Groq is not configured on the server." }, 503);
  }

  const now = Date.now();
  while (
    requestTimes.length > 0
    && requestTimes[0] !== undefined
    && requestTimes[0] <= now - RATE_WINDOW_MS
  ) {
    requestTimes.shift();
  }
  if (requestTimes.length >= MAX_REQUESTS_PER_WINDOW) {
    return json({ error: "Too many requests. Wait a minute before trying again." }, 429);
  }
  requestTimes.push(now);

  let providerResponse: Response;
  try {
    providerResponse = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 600,
        messages: [
          {
            role: "system",
            content: "Answer the user's question using your general knowledge. You have not been given or asked to retrieve any source documents. Do not claim that the answer is verified, current, or sourced. Be candid when unsure, and recommend checking authoritative sources for consequential or time-sensitive claims.",
          },
          { role: "user", content: parsedRequest.data.question },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
  } catch {
    return json({ error: "Groq could not be reached. Try again later." }, 502);
  }

  if (providerResponse.status === 403) {
    // Groq answers 403 when it blocks the server's network or country (for example a VPN).
    return json({
      error: "Groq refused access from this server's network. This is usually a blocked VPN, proxy or "
        + "country rather than a bad key; try another network or run the server where Groq is available.",
    }, 502);
  }
  if (!providerResponse.ok) {
    const errorMessage = await readGroqError(
      providerResponse,
      "Groq did not complete the request. Check server configuration and try again.",
    );
    return json({ error: errorMessage }, 502);
  }

  let providerData: {
    choices?: { message?: { content?: string | null } }[];
  };
  try {
    providerData = await providerResponse.json();
  } catch {
    return json({ error: "Groq returned an invalid response." }, 502);
  }

  const answer = providerData.choices?.[0]?.message?.content?.trim();
  if (!answer) {
    return json({ error: "Groq returned an empty answer." }, 502);
  }

  return json({
    answer,
    verified: false,
    warning: "Unverified general AI answer. It was not checked against or grounded in approved sources.",
  });
}
