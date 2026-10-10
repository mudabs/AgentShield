/**
 * Server-side model adapters. Import this only from route handlers (src/app/api/**). API keys are read from server environment
 * variables (no NEXT_PUBLIC_ prefix), so they never reach the browser bundle,
 * are never logged, and never leave this module except in the request header
 * to the provider itself.
 *
 * Every adapter returns raw text. Interpreting that text is not trusted here:
 * src/lib/ai/intent.ts validates it before anything else sees it.
 */

export type ProviderId = "kimi" | "openai" | "anthropic";

export type ProviderInfo = { id: ProviderId; label: string; model: string; configured: boolean };

type Completion = { text: string; model: string };

const TIMEOUT_MS = 30_000;

const config = {
  kimi: {
    label: "Kimi",
    key: () => process.env.KIMI_API_KEY,
    model: () => process.env.KIMI_MODEL || "kimi-k2.6",
    baseUrl: () => process.env.KIMI_BASE_URL || "https://api.moonshot.ai/v1",
  },
  openai: {
    label: "OpenAI",
    key: () => process.env.OPENAI_API_KEY,
    model: () => process.env.OPENAI_MODEL || "gpt-5-mini",
    baseUrl: () => "https://api.openai.com/v1",
  },
  anthropic: {
    label: "Claude",
    key: () => process.env.ANTHROPIC_API_KEY,
    model: () => process.env.ANTHROPIC_MODEL || "claude-haiku-5-5",
    baseUrl: () => "https://api.anthropic.com/v1",
  },
} as const;

export const PROVIDER_ORDER: ProviderId[] = ["kimi", "openai", "anthropic"];

export function listProviders(): ProviderInfo[] {
  return PROVIDER_ORDER.map((id) => ({
    id,
    label: config[id].label,
    model: config[id].model(),
    configured: Boolean(config[id].key()),
  }));
}

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_ORDER as string[]).includes(value);
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

export async function complete(provider: ProviderId, system: string, user: string): Promise<Completion> {
  const key = config[provider].key();
  if (!key) throw new ProviderError(`${config[provider].label} is not configured on this server.`, 503);
  const model = config[provider].model();
  return provider === "anthropic"
    ? completeAnthropic(key, model, system, user)
    : completeOpenAICompatible(provider, key, model, system, user);
}

/** Kimi and OpenAI both speak the OpenAI chat-completions format. */
async function completeOpenAICompatible(
  provider: "kimi" | "openai",
  key: string,
  model: string,
  system: string,
  user: string,
): Promise<Completion> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
  };
  if (provider === "openai") {
    // GPT-5 family models are reasoning models: keep reasoning short and leave room for it.
    body.reasoning_effort = process.env.OPENAI_REASONING_EFFORT || "low";
    body.max_completion_tokens = 2000;
  } else {
    body.max_tokens = 2000;
  }

  const json = await postJson(`${config[provider].baseUrl()}/chat/completions`, body, {
    Authorization: `Bearer ${key}`,
  }, config[provider].label);

  const choice = (json as { choices?: { message?: { content?: unknown } }[] }).choices?.[0];
  const text = typeof choice?.message?.content === "string" ? choice.message.content : "";
  if (!text) throw new ProviderError(`${config[provider].label} returned an empty answer.`);
  return { text, model: typeof (json as { model?: unknown }).model === "string" ? (json as { model: string }).model : model };
}

async function completeAnthropic(key: string, model: string, system: string, user: string): Promise<Completion> {
  const json = await postJson(
    `${config.anthropic.baseUrl()}/messages`,
    { model, max_tokens: 1000, system, messages: [{ role: "user", content: user }] },
    { "x-api-key": key, "anthropic-version": "2023-06-01" },
    config.anthropic.label,
  );
  const blocks = (json as { content?: { type?: string; text?: unknown }[] }).content ?? [];
  const text = blocks
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("");
  if (!text) throw new ProviderError("Claude returned an empty answer.");
  return { text, model: typeof (json as { model?: unknown }).model === "string" ? (json as { model: string }).model : model };
}

async function postJson(url: string, body: unknown, headers: Record<string, string>, label: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new ProviderError(timedOut ? `${label} took too long to answer.` : `Could not reach ${label}.`, 504);
  }

  if (!response.ok) {
    // Surface the provider's own error message (never the request, which holds the key header).
    let detail = "";
    try {
      const errorJson = (await response.json()) as { error?: { message?: unknown } | string };
      const message = typeof errorJson.error === "string" ? errorJson.error : errorJson.error?.message;
      if (typeof message === "string") detail = `: ${message.slice(0, 200)}`;
    } catch {
      // Non-JSON error body; the status code is enough.
    }
    const hint =
      response.status === 401
        ? " Check the API key in .env."
        : response.status === 402 || response.status === 429
          ? " The account may be out of credit or rate limited."
          : "";
    throw new ProviderError(`${label} returned HTTP ${response.status}${detail}.${hint}`);
  }
  return response.json();
}
