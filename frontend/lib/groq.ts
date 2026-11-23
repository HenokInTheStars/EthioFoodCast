/**
 * Server-only access to Groq's chat API. The key never reaches the browser: it
 * is read from GROQ_API_KEY here and must not have a NEXT_PUBLIC_ prefix.
 */
const GROQ_BASE_URL = process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type GroqResult = { ok: true; text: string; model: string } | { ok: false; status: number; error: string };

export function groqConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY && process.env.GROQ_MODEL);
}

export async function groqChat(
  messages: ChatMessage[],
  { temperature = 0.1, maxTokens = 600 }: { temperature?: number; maxTokens?: number } = {},
): Promise<GroqResult> {
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL;
  if (!apiKey || !model) {
    return { ok: false, status: 503, error: "The AI assistant is not configured on this server." };
  }

  let response: Response;
  try {
    response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, temperature, max_tokens: maxTokens, messages }),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 502, error: "The AI service could not be reached. Try again later." };
  }

  if (response.status === 403) {
    // Groq answers 403 when it blocks the server's network or country (for example a VPN).
    return {
      ok: false,
      status: 502,
      error: "The AI service refused this server's network. This is usually a blocked VPN, proxy or country "
        + "rather than a bad key.",
    };
  }
  if (response.status === 429) {
    return { ok: false, status: 429, error: "The AI service is busy. Wait a minute and try again." };
  }
  if (!response.ok) {
    let message = "The AI service did not complete the request.";
    try {
      const payload = (await response.json()) as { error?: { message?: string } };
      if (payload.error?.message) message = payload.error.message;
    } catch {
      // Keep the generic message.
    }
    return { ok: false, status: 502, error: message };
  }

  try {
    const data = (await response.json()) as { choices?: { message?: { content?: string | null } }[] };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) return { ok: false, status: 502, error: "The AI service returned an empty answer." };
    return { ok: true, text, model };
  } catch {
    return { ok: false, status: 502, error: "The AI service returned an invalid response." };
  }
}
