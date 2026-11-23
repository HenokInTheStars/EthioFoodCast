import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_WINDOW_MS = 60_000;
const GROQ_BASE_URL = process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1";
let lastRequestAt = 0;

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

const requestSchema = z.object({ consent: z.literal(true) }).strict();

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }
  if (!requestSchema.safeParse(body).success) {
    return json({ error: "Confirm the generic Groq test before continuing." }, 400);
  }

  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL;
  if (!apiKey || !model) {
    return json({ error: "Configure GROQ_API_KEY and GROQ_MODEL on the server first." }, 503);
  }

  const now = Date.now();
  if (now - lastRequestAt < RATE_WINDOW_MS) {
    return json({ error: "A connection test was just run. Wait a minute before trying again." }, 429);
  }
  lastRequestAt = now;

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
        temperature: 0,
        max_tokens: 4,
        messages: [
          {
            role: "user",
            content: "Connection test only. Reply with exactly: OK",
          },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch {
    return json({ error: "Could not reach Groq. Check the connection and try again later." }, 502);
  }

  if (providerResponse.status === 401 || providerResponse.status === 403) {
    return json({ error: "Groq rejected the API key or account access." }, 502);
  }
  if (providerResponse.status === 404) {
    return json({ error: "Groq did not recognize the configured model ID." }, 502);
  }
  if (providerResponse.status === 429) {
    return json({ error: "Groq rate limit or quota was reached. Check your Groq account limits." }, 429);
  }
  if (!providerResponse.ok) {
    const errorMessage = await readGroqError(
      providerResponse,
      "Groq returned an error. Check the model and account configuration.",
    );
    return json({ error: errorMessage }, 502);
  }

  let result: { choices?: { message?: { content?: string | null } }[] };
  try {
    result = await providerResponse.json();
  } catch {
    return json({ error: "Groq returned an invalid response." }, 502);
  }

  const reply = result.choices?.[0]?.message?.content?.trim();
  if (!reply) {
    return json({ error: "Groq responded, but the response was empty." }, 502);
  }

  return json({ ok: true, model, reply });
}
