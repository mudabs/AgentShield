import { getAddress, parseEventLogs, type Address } from "viem";
import { vaultAbi, vaultAddress } from "../guard";
import { serverPublicClient } from "../server-chain";
import { challengeRequestId, isGenuineChallenge, newChallenge, parsePaymentHeader, type PaymentProof, type SignedChallenge } from "./challenge";

// Each paid transaction unlocks its resource once per server instance.
const redeemed = new Set<string>();

export function paymentRequired(signed: SignedChallenge, message = "Payment required") {
  return Response.json(
    { x402Version: 1, error: message, accepts: [signed.challenge], signature: signed.signature },
    { status: 402, headers: { "Cache-Control": "no-store" } },
  );
}

export type Verified = { ok: true; proof: PaymentProof; agentId: string; payer: Address } | { ok: false; reason: string };

/**
 * Checks an X-PAYMENT proof against the chain: the challenge must be ours and unexpired,
 * and the transaction must be a vault PaymentExecuted whose request ID is the challenge
 * hash, paying at least the asked amount to the asked recipient.
 */
export async function verifyPaymentProof(header: string | null, resource: string): Promise<Verified> {
  const proof = parsePaymentHeader(header);
  if (!proof) return { ok: false, reason: "Missing or malformed X-PAYMENT header." };
  if (!isGenuineChallenge(proof)) return { ok: false, reason: "That challenge was not issued by this server." };
  if (proof.challenge.resource !== resource) return { ok: false, reason: "The challenge is for a different resource." };
  if (proof.challenge.expiresAt < Math.floor(Date.now() / 1000)) return { ok: false, reason: "The challenge expired." };
  if (redeemed.has(proof.txHash.toLowerCase())) return { ok: false, reason: "This payment was already used." };
  if (!vaultAddress) return { ok: false, reason: "No vault configured." };
  const receipt = await serverPublicClient()
    .waitForTransactionReceipt({ hash: proof.txHash, timeout: 20_000 })
    .catch(() => undefined);
  if (!receipt || receipt.status !== "success") return { ok: false, reason: "Payment transaction not found or not successful." };
  const [event] = parseEventLogs({
    abi: vaultAbi,
    eventName: "PaymentExecuted",
    logs: receipt.logs.filter((log) => getAddress(log.address) === getAddress(vaultAddress!)),
  });
  if (!event) return { ok: false, reason: "The transaction is not an AgentShield vault payment." };
  if (event.args.requestId.toLowerCase() !== challengeRequestId(proof.challenge).toLowerCase()) {
    return { ok: false, reason: "The payment does not answer this challenge." };
  }
  if (getAddress(event.args.recipient) !== getAddress(proof.challenge.payTo)) return { ok: false, reason: "Paid the wrong recipient." };
  if (event.args.amount < BigInt(proof.challenge.amountWei)) return { ok: false, reason: "Paid less than asked." };
  redeemed.add(proof.txHash.toLowerCase());
  return { ok: true, proof, agentId: event.args.agentId.toString(), payer: getAddress(event.args.signer) };
}

export { newChallenge };
