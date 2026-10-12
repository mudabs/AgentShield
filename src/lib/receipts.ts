import { getAddress, isAddress, isHex, keccak256, stringToBytes, type Address, type Hex } from "viem";

/**
 * A payment request envelope. Its keccak256 hash is the requestId sent to the vault,
 * so the onchain PaymentExecuted event commits to everything in here: which agent,
 * recipient and amount, and (for AI requests) the prompt and the declared model.
 *
 * What this proves: the context shown on a receipt is exactly the context that
 * existed when the payment was signed; nobody can change the prompt afterwards.
 * What it does not prove: that the declared model really produced the answer.
 * The model name is declared by the AgentShield server, not attested by the provider.
 */
export type RequestSource = {
  provider: string;
  model: string;
  prompt: string;
  memo?: string;
  recipientName?: string;
  /** For several payments from one sentence, e.g. "2 of 3". */
  part?: string;
};

export type RequestEnvelope = {
  v: 1;
  chainId: number;
  vault: Address;
  agentId: string;
  recipient: Address;
  amountWei: string;
  /** 32 random bytes so two identical requests still get different IDs (replay protection). */
  salt: Hex;
  source?: RequestSource;
};

export function newSalt(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function createEnvelope(input: {
  chainId: number;
  vault: Address;
  agentId: bigint;
  recipient: Address;
  amountWei: bigint;
  source?: RequestSource;
  salt?: Hex;
}): RequestEnvelope {
  return {
    v: 1,
    chainId: input.chainId,
    vault: getAddress(input.vault),
    agentId: input.agentId.toString(),
    recipient: getAddress(input.recipient),
    amountWei: input.amountWei.toString(),
    salt: input.salt ?? newSalt(),
    ...(input.source ? { source: input.source } : {}),
  };
}

/** Fixed key order and no undefined fields, so the same envelope always hashes the same way. */
export function canonicalEnvelope(envelope: RequestEnvelope): string {
  const source = envelope.source
    ? {
        provider: envelope.source.provider,
        model: envelope.source.model,
        prompt: envelope.source.prompt,
        ...(envelope.source.memo ? { memo: envelope.source.memo } : {}),
        ...(envelope.source.recipientName ? { recipientName: envelope.source.recipientName } : {}),
        ...(envelope.source.part ? { part: envelope.source.part } : {}),
      }
    : undefined;
  return JSON.stringify({
    v: envelope.v,
    chainId: envelope.chainId,
    vault: getAddress(envelope.vault),
    agentId: envelope.agentId,
    recipient: getAddress(envelope.recipient),
    amountWei: envelope.amountWei,
    salt: envelope.salt.toLowerCase(),
    ...(source ? { source } : {}),
  });
}

export function envelopeRequestId(envelope: RequestEnvelope): Hex {
  return keccak256(stringToBytes(canonicalEnvelope(envelope)));
}

/** Validates untrusted JSON (from a link or storage) into an envelope, or returns undefined. */
export function parseEnvelope(value: unknown): RequestEnvelope | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.v !== 1 || typeof raw.chainId !== "number") return undefined;
  if (typeof raw.vault !== "string" || !isAddress(raw.vault, { strict: false })) return undefined;
  if (typeof raw.recipient !== "string" || !isAddress(raw.recipient, { strict: false })) return undefined;
  if (typeof raw.agentId !== "string" || !/^\d+$/.test(raw.agentId)) return undefined;
  if (typeof raw.amountWei !== "string" || !/^\d+$/.test(raw.amountWei)) return undefined;
  if (typeof raw.salt !== "string" || !isHex(raw.salt) || raw.salt.length !== 66) return undefined;
  let source: RequestSource | undefined;
  if (raw.source !== undefined) {
    const s = raw.source as Record<string, unknown>;
    if (typeof s !== "object" || s === null) return undefined;
    if (typeof s.provider !== "string" || typeof s.model !== "string" || typeof s.prompt !== "string") return undefined;
    source = {
      provider: s.provider,
      model: s.model,
      prompt: s.prompt,
      ...(typeof s.memo === "string" && s.memo ? { memo: s.memo } : {}),
      ...(typeof s.recipientName === "string" && s.recipientName ? { recipientName: s.recipientName } : {}),
      ...(typeof s.part === "string" && s.part ? { part: s.part } : {}),
    };
  }
  return {
    v: 1,
    chainId: raw.chainId,
    vault: getAddress(raw.vault),
    agentId: raw.agentId,
    recipient: getAddress(raw.recipient),
    amountWei: raw.amountWei,
    salt: raw.salt as Hex,
    ...(source ? { source } : {}),
  };
}

/** base64url of the canonical JSON, for putting in a link fragment (never sent to a server). */
export function encodeEnvelope(envelope: RequestEnvelope): string {
  const bytes = stringToBytes(canonicalEnvelope(envelope));
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeEnvelope(encoded: string): RequestEnvelope | undefined {
  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return parseEnvelope(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return undefined;
  }
}

export type OnchainPayment = {
  chainId: number;
  vault: Address;
  agentId: bigint;
  requestId: Hex;
  recipient: Address;
  amount: bigint;
};

export type EnvelopeCheck = { ok: true } | { ok: false; mismatches: string[] };

/** Compares a claimed envelope against what the vault actually recorded. */
export function verifyEnvelope(envelope: RequestEnvelope, payment: OnchainPayment): EnvelopeCheck {
  const mismatches: string[] = [];
  if (envelopeRequestId(envelope).toLowerCase() !== payment.requestId.toLowerCase()) {
    mismatches.push("The request details do not hash to the request ID recorded onchain.");
  }
  if (envelope.chainId !== payment.chainId) mismatches.push("Different chain.");
  if (getAddress(envelope.vault) !== getAddress(payment.vault)) mismatches.push("Different vault.");
  if (envelope.agentId !== payment.agentId.toString()) mismatches.push("Different agent.");
  if (getAddress(envelope.recipient) !== getAddress(payment.recipient)) mismatches.push("Different recipient.");
  if (envelope.amountWei !== payment.amount.toString()) mismatches.push("Different amount.");
  return mismatches.length ? { ok: false, mismatches } : { ok: true };
}
