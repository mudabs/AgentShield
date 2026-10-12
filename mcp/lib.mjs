// Pure helpers shared by the AgentShield MCP server. Kept in plain JavaScript so the
// server runs with `node` alone from any working directory. These must produce exactly
// the same bytes as src/lib/receipts.ts and src/lib/x402/challenge.ts (see the tests).
import { getAddress, keccak256, stringToBytes } from "viem";

export function canonicalEnvelope(envelope) {
  const s = envelope.source;
  const source = s
    ? {
        provider: s.provider,
        model: s.model,
        prompt: s.prompt,
        ...(s.memo ? { memo: s.memo } : {}),
        ...(s.recipientName ? { recipientName: s.recipientName } : {}),
        ...(s.part ? { part: s.part } : {}),
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

export const envelopeRequestId = (envelope) => keccak256(stringToBytes(canonicalEnvelope(envelope)));

export function encodeEnvelope(envelope) {
  return Buffer.from(canonicalEnvelope(envelope), "utf8").toString("base64url");
}

export function canonicalChallenge(c) {
  return JSON.stringify({
    scheme: c.scheme,
    network: c.network,
    chainId: c.chainId,
    asset: c.asset,
    amountWei: c.amountWei,
    payTo: getAddress(c.payTo),
    resource: c.resource,
    description: c.description,
    nonce: c.nonce.toLowerCase(),
    expiresAt: c.expiresAt,
  });
}

export const challengeRequestId = (challenge) => keccak256(stringToBytes(canonicalChallenge(challenge)));

/** "0.05" -> wei, strictly (no exponents, at most 18 decimals). */
export function parseMon(value) {
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,18})?$/.test(text)) throw new Error(`"${text}" is not a plain MON amount like 0.05`);
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
}

export function parseAddressBook(raw) {
  const book = [];
  for (const pair of (raw ?? "").split(",")) {
    const [name, address] = pair.split(":").map((part) => part?.trim());
    if (name && /^0x[0-9a-fA-F]{40}$/.test(address ?? "")) book.push({ name, address: getAddress(address.toLowerCase()) });
  }
  return book;
}
