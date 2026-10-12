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
  // Vercel's Upstash integration names these KV_REST_API_*; a direct Upstash setup uses UPSTASH_REDIS_REST_*.
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
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
    try {
      await pipeline(commands);
      return;
    } catch {
      // Fall through and keep the count in memory.
    }
  }
  memory.stats.attempts += 1;
  if (field) (memory.stats[field] as number) += 1;
  memory.stats.paidWei = (BigInt(memory.stats.paidWei) + paidWei).toString();
  memory.stats.unapprovedWei = (BigInt(memory.stats.unapprovedWei) + unapprovedWei).toString();
  memory.feed = [entry, ...memory.feed].slice(0, FEED_LENGTH);
}

export async function readScoreboard(): Promise<{ stats: ArenaStats; feed: FeedEntry[] }> {
  if (!redisConfig()) return { stats: { ...memory.stats }, feed: [...memory.feed] };
  // If the shared store is unavailable (or its free quota is used up), show this server's own counts instead of an error.
  return readSharedScoreboard().catch(() => ({ stats: { ...memory.stats }, feed: [...memory.feed] }));
}

async function readSharedScoreboard(): Promise<{ stats: ArenaStats; feed: FeedEntry[] }> {
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
export async function takeDailyBudget(limit: number, name = "arena"): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const key = `${name}:budget:${day}`;
  if (redisConfig()) {
    const [count] = await pipeline([
      ["INCR", key],
      ["EXPIRE", key, 172_800],
    ]);
    return Number(count) <= limit;
  }
  for (const existing of memory.daily.keys()) if (!existing.endsWith(day)) memory.daily.delete(existing);
  const next = (memory.daily.get(key) ?? 0) + 1;
  memory.daily.set(key, next);
  return next <= limit;
}
