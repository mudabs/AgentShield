import { getAddress, hashTypedData, isAddress, isHex, keccak256, stringToBytes, type Address, type Hex } from "viem";

/**
 * Owner-signed spending mandates (see contracts/MandateExecutor.sol). The owner signs one
 * of these in MetaMask, for free; the agent key can then spend up to its budget, to its one
 * recipient, inside its time window, and nothing else. The vault's standing policy still
 * applies on top.
 */
export type Mandate = {
  agentId: bigint;
  agentKey: Address;
  recipient: Address;
  maxTotal: bigint;
  maxPerPayment: bigint;
  validAfter: bigint;
  validUntil: bigint;
  purposeHash: Hex;
  nonce: bigint;
};

export type SerializedMandate = { [K in keyof Mandate]: string };

export type StoredMandate = {
  id: Hex;
  mandate: SerializedMandate;
  signature: Hex;
  purpose: string;
  recipientName?: string;
  createdAt: number;
};

export const MANDATE_TYPES = {
  Mandate: [
    { name: "agentId", type: "uint256" },
    { name: "agentKey", type: "address" },
    { name: "recipient", type: "address" },
    { name: "maxTotal", type: "uint256" },
    { name: "maxPerPayment", type: "uint256" },
    { name: "validAfter", type: "uint64" },
    { name: "validUntil", type: "uint64" },
    { name: "purposeHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export function mandateDomain(executor: Address) {
  return { name: "AgentShield Mandates", version: "1", chainId: 10143, verifyingContract: executor } as const;
}

export const purposeHashOf = (purpose: string) => keccak256(stringToBytes(purpose.trim()));

export function mandateDigest(mandate: Mandate, executor: Address): Hex {
  return hashTypedData({ domain: mandateDomain(executor), types: MANDATE_TYPES, primaryType: "Mandate", message: mandate });
}

export function serializeMandate(mandate: Mandate): SerializedMandate {
  return {
    agentId: mandate.agentId.toString(),
    agentKey: mandate.agentKey,
    recipient: mandate.recipient,
    maxTotal: mandate.maxTotal.toString(),
    maxPerPayment: mandate.maxPerPayment.toString(),
    validAfter: mandate.validAfter.toString(),
    validUntil: mandate.validUntil.toString(),
    purposeHash: mandate.purposeHash,
    nonce: mandate.nonce.toString(),
  };
}

export function parseMandate(value: unknown): Mandate | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const uint = (key: string) => (typeof raw[key] === "string" && /^\d+$/.test(raw[key] as string) ? BigInt(raw[key] as string) : undefined);
  const agentId = uint("agentId");
  const maxTotal = uint("maxTotal");
  const maxPerPayment = uint("maxPerPayment");
  const validAfter = uint("validAfter");
  const validUntil = uint("validUntil");
  const nonce = uint("nonce");
  if ([agentId, maxTotal, maxPerPayment, validAfter, validUntil, nonce].some((item) => item === undefined)) return undefined;
  if (typeof raw.agentKey !== "string" || !isAddress(raw.agentKey, { strict: false })) return undefined;
  if (typeof raw.recipient !== "string" || !isAddress(raw.recipient, { strict: false })) return undefined;
  if (typeof raw.purposeHash !== "string" || !isHex(raw.purposeHash) || raw.purposeHash.length !== 66) return undefined;
  return {
    agentId: agentId!,
    agentKey: getAddress(raw.agentKey),
    recipient: getAddress(raw.recipient),
    maxTotal: maxTotal!,
    maxPerPayment: maxPerPayment!,
    validAfter: validAfter!,
    validUntil: validUntil!,
    purposeHash: raw.purposeHash as Hex,
    nonce: nonce!,
  };
}
