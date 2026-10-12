import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getAddress, isAddress, keccak256, stringToBytes, type Address, type Hex } from "viem";

/**
 * x402-style payment challenges, settled through the AgentShield vault.
 *
 * x402 (HTTP 402 Payment Required) lets a server tell an agent "pay X to Y, then retry".
 * The public x402 flow settles stablecoin transfers through a facilitator; this
 * implementation keeps the same request/response shape but settles in native MON through
 * the agent's vault, so every payment passes the owner's onchain rules.
 *
 * Key idea: the vault request ID is the hash of the signed challenge. One challenge can
 * therefore be paid at most once (the vault rejects duplicate request IDs), which stops
 * retry loops from paying twice, and the server can check that a payment answers exactly
 * the challenge it issued.
 */

export type PaymentChallenge = {
  scheme: "agentshield-vault";
  network: "monad-testnet";
  chainId: 10143;
  asset: "MON";
  amountWei: string;
  payTo: Address;
  resource: string;
  description: string;
  nonce: Hex;
  expiresAt: number;
};

export type SignedChallenge = { challenge: PaymentChallenge; signature: Hex };
export type PaymentProof = SignedChallenge & { txHash: Hex };

function secret() {
  const explicit = process.env.X402_SECRET;
  if (explicit) return explicit;
  // Derive a stable server secret from one that already exists, so the demo needs no extra setup.
  const base = process.env.DEMO_AGENT_PRIVATE_KEY ?? "agentshield-dev-only";
  return keccak256(stringToBytes(`x402:${base}`));
}

export function canonicalChallenge(challenge: PaymentChallenge): string {
  return JSON.stringify({
    scheme: challenge.scheme,
    network: challenge.network,
    chainId: challenge.chainId,
    asset: challenge.asset,
    amountWei: challenge.amountWei,
    payTo: getAddress(challenge.payTo),
    resource: challenge.resource,
    description: challenge.description,
    nonce: challenge.nonce.toLowerCase(),
    expiresAt: challenge.expiresAt,
  });
}

/** The vault request ID that pays this challenge. */
export function challengeRequestId(challenge: PaymentChallenge): Hex {
  return keccak256(stringToBytes(canonicalChallenge(challenge)));
}

export function signChallenge(challenge: PaymentChallenge): SignedChallenge {
  const signature = `0x${createHmac("sha256", secret()).update(canonicalChallenge(challenge)).digest("hex")}` as Hex;
  return { challenge, signature };
}

export function isGenuineChallenge(signed: SignedChallenge): boolean {
  try {
    const expected = Buffer.from(signChallenge(signed.challenge).signature.slice(2), "hex");
    const given = Buffer.from(signed.signature.slice(2), "hex");
    return expected.length === given.length && timingSafeEqual(expected, given);
  } catch {
    return false;
  }
}

export function newChallenge(input: { amountWei: bigint; payTo: Address; resource: string; description: string; ttlSeconds?: number; nonce?: Hex }): SignedChallenge {
  return signChallenge({
    scheme: "agentshield-vault",
    network: "monad-testnet",
    chainId: 10143,
    asset: "MON",
    amountWei: input.amountWei.toString(),
    payTo: getAddress(input.payTo),
    resource: input.resource,
    description: input.description,
    nonce: input.nonce ?? (`0x${randomBytes(16).toString("hex")}` as Hex),
    expiresAt: Math.floor(Date.now() / 1000) + (input.ttlSeconds ?? 300),
  });
}

/** Parses the X-PAYMENT header (base64 JSON). Returns undefined for anything malformed. */
export function parsePaymentHeader(header: string | null): PaymentProof | undefined {
  if (!header) return undefined;
  try {
    const value = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as PaymentProof;
    const c = value?.challenge;
    if (!c || c.scheme !== "agentshield-vault" || !isAddress(c.payTo) || !/^\d+$/.test(c.amountWei)) return undefined;
    if (!/^0x[0-9a-fA-F]{64}$/.test(value.txHash) || !/^0x[0-9a-fA-F]{64}$/.test(value.signature)) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

export function encodePaymentHeader(proof: PaymentProof): string {
  return Buffer.from(JSON.stringify(proof), "utf8").toString("base64");
}
