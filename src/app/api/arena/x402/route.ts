import { runX402 } from "@/lib/arena/x402-agent";
import type { ArenaEvent } from "@/lib/arena/agent";
import { takeDailyBudget } from "@/lib/arena/store";
import { SCENARIOS, type Scenario } from "@/lib/x402/catalog";

/** POST { scenario } -> the demo agent calls a paid API and streams each step (NDJSON). */
export const maxDuration = 60;

const recent = new Map<string, number[]>();
const PER_MINUTE = Number(process.env.ARENA_RATE_LIMIT_PER_MINUTE) || 5;

export async function POST(request: Request) {
  const caller = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const calls = (recent.get(caller) ?? []).filter((time) => now - time < 60_000);
  if (calls.length >= PER_MINUTE) return Response.json({ message: "Easy there. Wait a minute before the next attempt." }, { status: 429 });
  recent.set(caller, [...calls, now]);

  const body = (await request.json().catch(() => ({}))) as { scenario?: string };
  if (!SCENARIOS.includes(body.scenario as Scenario)) return Response.json({ message: "Unknown scenario." }, { status: 400 });
  if (!(await takeDailyBudget(Number(process.env.ARENA_DAILY_ATTEMPTS) || 300, "arena").catch(() => true))) {
    return Response.json({ message: "Today's attempt budget is used up. Come back after 00:00 UTC." }, { status: 429 });
  }
  const origin = new URL(request.url).origin;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: ArenaEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        await runX402(body.scenario as Scenario, origin, emit);
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
