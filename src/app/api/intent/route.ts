import {
  buildSystemPrompt,
  MAX_REQUEST_LENGTH,
  parseModelJson,
  resolveIntents,
  sanitizeAddressBook,
} from "@/lib/ai/intent";
import { complete, isProviderId, listProviders, ProviderError } from "@/lib/ai/providers";
import { takeDailyBudget } from "@/lib/arena/store";

/**
 * POST /api/intent
 * Body: { provider: "kimi" | "openai" | "anthropic", request: string, addressBook: {name, address}[] }
 *
 * Asks the chosen model to interpret the request, then validates the answer.
 * This route never signs, sends, or approves anything. It returns a proposed
 * intent that the browser previews against the vault; the contract decides.
 */

// Basic abuse control: each caller gets a few model calls per minute. In-memory,
// so it resets on restart and is per server instance. Good enough for a demo.
const WINDOW_MS = 60_000;
const MAX_CALLS_PER_WINDOW = Number(process.env.INTENT_RATE_LIMIT_PER_MINUTE) || 20;
const recentCalls = new Map<string, number[]>();
// Global cap on model calls per UTC day, so a public deployment cannot run up the AI bill.
const DAILY_MODEL_CALLS = Number(process.env.INTENT_DAILY_LIMIT) || 500;

function rateLimited(caller: string): boolean {
  const now = Date.now();
  const calls = (recentCalls.get(caller) ?? []).filter((time) => now - time < WINDOW_MS);
  if (calls.length >= MAX_CALLS_PER_WINDOW) {
    recentCalls.set(caller, calls);
    return true;
  }
  calls.push(now);
  recentCalls.set(caller, calls);
  return false;
}

function fail(status: number, message: string) {
  return Response.json({ ok: false, message }, { status });
}

/** Lists which providers this server can use (never exposes keys). */
export async function GET() {
  return Response.json({ providers: listProviders() });
}

export async function POST(request: Request) {
  const caller = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(caller)) return fail(429, "Too many requests. Wait a minute and try again.");

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail(400, "Send a JSON body.");
  }

  const { provider, request: userRequest, addressBook: rawBook } = body;
  if (!isProviderId(provider)) return fail(400, "Choose Kimi, OpenAI, or Claude.");
  if (typeof userRequest !== "string" || !userRequest.trim()) return fail(400, "Type what the agent should pay.");
  if (userRequest.length > MAX_REQUEST_LENGTH) {
    return fail(400, `Keep the request under ${MAX_REQUEST_LENGTH} characters.`);
  }
  const addressBook = sanitizeAddressBook(rawBook);
  if (typeof addressBook === "string") return fail(400, addressBook);

  if (!(await takeDailyBudget(DAILY_MODEL_CALLS, "intent").catch(() => true))) {
    return fail(429, "Today's AI budget for this demo is used up. It resets at 00:00 UTC.");
  }

  const system = buildSystemPrompt(addressBook.map((entry) => entry.name));
  const startedAt = Date.now();
  let completion: { text: string; model: string };
  try {
    completion = await complete(provider, system, userRequest.trim());
  } catch (error) {
    if (error instanceof ProviderError) return fail(error.status, error.message);
    return fail(502, "The model request failed.");
  }

  const parsed = parseModelJson(completion.text);
  const resolved = resolveIntents(parsed, addressBook, userRequest);
  const label = listProviders().find((entry) => entry.id === provider)?.label ?? provider;

  return Response.json({
    ...resolved,
    // The first payment is also returned in the original single-payment fields so
    // older callers (like the e2e script) keep working.
    ...(resolved.ok ? resolved.payments[0] : {}),
    // Declared metadata: what this server asked for and got back. It is not a
    // cryptographic proof of which model produced the text.
    provider,
    providerLabel: label,
    model: completion.model,
    latencyMs: Date.now() - startedAt,
    rawOutput: completion.text.slice(0, 1000),
  });
}
