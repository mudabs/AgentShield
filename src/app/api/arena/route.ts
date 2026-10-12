import { connection } from "next/server";
import { arenaStatus, runAttack, type ArenaEvent } from "@/lib/arena/agent";
import { readScoreboard, storageKind, takeDailyBudget } from "@/lib/arena/store";
import { isProviderId } from "@/lib/ai/providers";
import { MAX_REQUEST_LENGTH } from "@/lib/ai/intent";
import { describeError } from "@/lib/errors";

/**
 * Public "Break the Agent" endpoint.
 * GET  -> live state of the demo agent, scoreboard and recent attempts.
 * POST -> { text, mode: "guarded" | "compromised", provider } runs one attempt and
 *         streams each step as a line of JSON (application/x-ndjson).
 */
export const maxDuration = 60;

const WINDOW_MS = 60_000;
const PER_CALLER_PER_MINUTE = Number(process.env.ARENA_RATE_LIMIT_PER_MINUTE) || 5;
const DAILY_ATTEMPTS = Number(process.env.ARENA_DAILY_ATTEMPTS) || 300;
const recent = new Map<string, number[]>();

function limited(caller: string) {
  const now = Date.now();
  const calls = (recent.get(caller) ?? []).filter((time) => now - time < WINDOW_MS);
  const blocked = calls.length >= PER_CALLER_PER_MINUTE;
  if (!blocked) calls.push(now);
  recent.set(caller, calls);
  return blocked;
}

export async function GET() {
  await connection();
  try {
    const [status, scoreboard] = await Promise.all([arenaStatus(), readScoreboard()]);
    return Response.json({ status, ...scoreboard, storage: storageKind() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ message: describeError(error as Error) }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const caller = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (limited(caller)) return Response.json({ message: "Easy there. Wait a minute before the next attempt." }, { status: 429 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ message: "Send a JSON body." }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const mode = body.mode === "compromised" ? "compromised" : "guarded";
  if (!text) return Response.json({ message: "Type something for the agent to do." }, { status: 400 });
  if (text.length > MAX_REQUEST_LENGTH) return Response.json({ message: `Keep it under ${MAX_REQUEST_LENGTH} characters.` }, { status: 400 });
  if (!isProviderId(body.provider)) return Response.json({ message: "Choose Kimi, OpenAI or Claude." }, { status: 400 });
  const provider = body.provider;
  if (!(await takeDailyBudget(DAILY_ATTEMPTS).catch(() => true))) {
    return Response.json({ message: "Today's attempt budget is used up. Come back after 00:00 UTC." }, { status: 429 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: ArenaEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        await runAttack({ text, mode, provider }, emit);
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
