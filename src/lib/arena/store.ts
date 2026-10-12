/**
 * Scoreboard storage for the public "Break the Agent" page.
 *
 * Uses Upstash Redis over its REST API when UPSTASH_REDIS_REST_URL and
 * UPSTASH_REDIS_REST_TOKEN are set (survives restarts and is shared by every
 * serverless instance). Otherwise falls back to memory, which resets when the
 * server restarts. Only aggregate counts and short summaries are stored, never
 * the text a visitor typed.
 */

export type ArenaOutcome = "ai_refused" | "vault_refused" | "paid_within_policy" | "error";

export type FeedEntry = {
  at: number;
  mode: "guarded" | "compromised";
  provider: string;
  outcome: ArenaOutcome;
  summary: string;
  hash?: string;
};

export type ArenaStats = {
  attempts: number;
  aiRefused: number;
  vaultRefused: number;
  paidWithinPolicy: number;
  /** Total wei paid out, all of it to approved recipients by construction. */
  paidWei: string;
  /** Wei paid to addresses outside the approved list. The vault makes this impossible. */
  unapprovedWei: string;
};

const FEED_LENGTH = 30;

const memory = {
  stats: { attempts: 0, aiRefused: 0, vaultRefused: 0, paidWithinPolicy: 0, paidWei: "0", unapprovedWei: "0" } as ArenaStats,
  feed: [] as FeedEntry[],
  daily: new Map<string, number>(),
};

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : undefined;
}

async function pipeline(commands: (string | number)[][]): Promise<unknown[]> {
  const redis = redisConfig()!;
  const response = await fetch(`${redis.url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${redis.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Scoreboard storage failed (HTTP ${response.status}).`);
  const results = (await response.json()) as { result?: unknown; error?: string }[];
  return results.map((item) => item.result);
}

const counterField: Record<ArenaOutcome, keyof ArenaStats | undefined> = {
  ai_refused: "aiRefused",
  vault_refused: "vaultRefused",
  paid_within_policy: "paidWithinPolicy",
  error: undefined,
};

export const storageKind = () => (redisConfig() ? "shared" : "memory");

export async function recordAttempt(entry: FeedEntry, paidWei: bigint, unapprovedWei: bigint) {
  const field = counterField[entry.outcome];
  if (redisConfig()) {
    const commands: (string | number)[][] = [
      ["HINCRBY", "arena:stats", "attempts", 1],
      ["LPUSH", "arena:feed", JSON.stringify(entry)],
      ["LTRIM", "arena:feed", 0, FEED_LENGTH - 1],
    ];
    if (field) commands.push(["HINCRBY", "arena:stats", field, 1]);
    // Wei totals stay well inside Redis's 64-bit integers for test amounts.
    if (paidWei > BigInt(0)) commands.push(["HINCRBY", "arena:stats", "paidWei", paidWei.toString()]);
    if (unapprovedWei > BigInt(0)) commands.push(["HINCRBY", "arena:stats", "unapprovedWei", unapprovedWei.toString()]);
    await pipeline(commands);
    return;
  }
  memory.stats.attempts += 1;
  if (field) (memory.stats[field] as number) += 1;
  memory.stats.paidWei = (BigInt(memory.stats.paidWei) + paidWei).toString();
  memory.stats.unapprovedWei = (BigInt(memory.stats.unapprovedWei) + unapprovedWei).toString();
  memory.feed = [entry, ...memory.feed].slice(0, FEED_LENGTH);
}

export async function readScoreboard(): Promise<{ stats: ArenaStats; feed: FeedEntry[] }> {
  if (!redisConfig()) return { stats: { ...memory.stats }, feed: [...memory.feed] };
  const [hash, list] = await pipeline([
    ["HGETALL", "arena:stats"],
    ["LRANGE", "arena:feed", 0, FEED_LENGTH - 1],
  ]);
  const flat = Array.isArray(hash) ? (hash as string[]) : [];
  const map = new Map<string, string>();
  for (let index = 0; index + 1 < flat.length; index += 2) map.set(flat[index], flat[index + 1]);
  const number = (key: string) => Number(map.get(key) ?? 0);
  const feed: FeedEntry[] = [];
  for (const raw of Array.isArray(list) ? (list as string[]) : []) {
    try {
      feed.push(JSON.parse(raw) as FeedEntry);
    } catch {
      // Skip a corrupted entry rather than failing the page.
    }
  }
  return {
    stats: {
      attempts: number("attempts"),
      aiRefused: number("aiRefused"),
      vaultRefused: number("vaultRefused"),
      paidWithinPolicy: number("paidWithinPolicy"),
      paidWei: map.get("paidWei") ?? "0",
      unapprovedWei: map.get("unapprovedWei") ?? "0",
    },
    feed,
  };
}

/** Counts one model call against today's global budget. Returns false once the budget is spent. */
export async function takeDailyBudget(limit: number): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  if (redisConfig()) {
    const [count] = await pipeline([
      ["INCR", `arena:budget:${day}`],
      ["EXPIRE", `arena:budget:${day}`, 172_800],
    ]);
    return Number(count) <= limit;
  }
  const next = (memory.daily.get(day) ?? 0) + 1;
  memory.daily.clear();
  memory.daily.set(day, next);
  return next <= limit;
}
