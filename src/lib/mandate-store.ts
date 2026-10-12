import type { StoredMandate } from "./mandates";

// Signed mandates waiting to be used by the demo agent. Redis (Upstash REST) when
// configured, otherwise memory. A mandate is only a signed message: storing it grants
// nothing by itself, the executor contract checks it on every payment.
const memory: StoredMandate[] = [];
const LIMIT = 50;

function redis() {
  // Vercel's Upstash integration names these KV_REST_API_*; a direct Upstash setup uses UPSTASH_REDIS_REST_*.
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : undefined;
}

async function pipeline(commands: (string | number)[][]) {
  const config = redis()!;
  const response = await fetch(`${config.url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Mandate storage failed (HTTP ${response.status}).`);
  return ((await response.json()) as { result?: unknown }[]).map((item) => item.result);
}

export async function saveMandate(entry: StoredMandate) {
  if (redis()) {
    await pipeline([
      ["LPUSH", "mandates:list", JSON.stringify(entry)],
      ["LTRIM", "mandates:list", 0, LIMIT - 1],
    ]);
    return;
  }
  memory.unshift(entry);
  memory.splice(LIMIT);
}

export async function listMandates(): Promise<StoredMandate[]> {
  if (!redis()) return [...memory];
  const [list] = await pipeline([["LRANGE", "mandates:list", 0, LIMIT - 1]]);
  const entries: StoredMandate[] = [];
  for (const raw of Array.isArray(list) ? (list as string[]) : []) {
    try {
      entries.push(JSON.parse(raw) as StoredMandate);
    } catch {
      // skip corrupted entries
    }
  }
  return entries;
}
