import { decodeFunctionData, formatEther, getAddress, isHash, parseEventLogs, type Address, type Hash, type Hex } from "viem";
import { MONAD_TESTNET_CHAIN_ID, MONAD_TESTNET_EXPLORER_URL } from "./monad";
import { registryAbi, registryAddress, vaultAbi, vaultAddress } from "./guard";
import { decodeEnvelope, verifyEnvelope } from "./receipts";
import { serverPublicClient } from "./server-chain";

/**
 * Machine-readable proof that a payment came from a rule-bound AgentShield agent.
 * Everything is read from Monad at request time; nothing is taken from the caller
 * except the transaction hash and, optionally, the request details to check.
 */
export type VerifyResult =
  | { ok: false; error: string }
  | {
      ok: true;
      status: "paid" | "blocked_onchain" | "not_agentshield";
      verifiedAgentPayment: boolean;
      transaction: { hash: Hash; blockNumber: string; timestamp: string; explorer: string };
      chainId: number;
      vault: Address;
      agent?: { id: string; owner: Address; signedBy: Address; currentSigner: Address; active: boolean };
      payment?: {
        recipient: Address;
        amountWei: string;
        amountMon: string;
        requestId: Hex;
        policyVersion?: string;
        utcDay?: string;
        recipientApprovedNow: boolean;
      };
      requestDetails?: { provided: boolean; matchesOnchain?: boolean; mismatches?: string[]; source?: unknown };
      meaning: string;
    };

export async function verifyAgentPayment(hash: string, encodedEnvelope?: string | null): Promise<VerifyResult> {
  if (!isHash(hash)) return { ok: false, error: "tx must be a 0x-prefixed 32-byte transaction hash." };
  if (!vaultAddress || !registryAddress) return { ok: false, error: "This server has no vault configured." };
  const client = serverPublicClient();
  let transaction, receipt;
  try {
    [transaction, receipt] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash })]);
  } catch {
    return { ok: false, error: "Transaction not found on Monad Testnet (it may still be pending)." };
  }
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  const base = {
    ok: true as const,
    chainId: MONAD_TESTNET_CHAIN_ID,
    vault: getAddress(vaultAddress),
    transaction: {
      hash,
      blockNumber: receipt.blockNumber.toString(),
      timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
      explorer: `${MONAD_TESTNET_EXPLORER_URL}/tx/${hash}`,
    },
  };

  let call;
  try {
    call = transaction.to && getAddress(transaction.to) === getAddress(vaultAddress) ? decodeFunctionData({ abi: vaultAbi, data: transaction.input }) : undefined;
  } catch {
    call = undefined;
  }
  if (!call || call.functionName !== "executePayment") {
    return { ...base, status: "not_agentshield", verifiedAgentPayment: false, meaning: "This transaction is not an AgentShield agent payment." };
  }
  const [agentId, requestId, recipientArg, amountArg] = call.args as readonly [bigint, Hex, Address, bigint];
  const executed = receipt.status === "success"
    ? parseEventLogs({ abi: vaultAbi, eventName: "PaymentExecuted", logs: receipt.logs.filter((log) => getAddress(log.address) === getAddress(vaultAddress!)) })[0]
    : undefined;
  const recipient = getAddress(executed?.args.recipient ?? recipientArg);
  const amount = executed?.args.amount ?? amountArg;

  const [agent, approvedNow] = await Promise.all([
    client.readContract({ address: registryAddress, abi: registryAbi, functionName: "getAgent", args: [agentId] }),
    client.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "approvedRecipients", args: [agentId, recipient] }),
  ]);

  let requestDetails: { provided: boolean; matchesOnchain?: boolean; mismatches?: string[]; source?: unknown } = { provided: false };
  if (encodedEnvelope) {
    const envelope = decodeEnvelope(encodedEnvelope);
    if (!envelope) requestDetails = { provided: true, matchesOnchain: false, mismatches: ["The request details could not be decoded."] };
    else {
      const check = verifyEnvelope(envelope, { chainId: MONAD_TESTNET_CHAIN_ID, vault: vaultAddress, agentId, requestId, recipient, amount });
      requestDetails = check.ok
        ? { provided: true, matchesOnchain: true, source: envelope.source ?? { manual: true } }
        : { provided: true, matchesOnchain: false, mismatches: check.mismatches };
    }
  }

  const paid = Boolean(executed);
  return {
    ...base,
    status: paid ? "paid" : "blocked_onchain",
    verifiedAgentPayment: paid,
    agent: {
      id: agentId.toString(),
      owner: getAddress(agent.owner),
      signedBy: getAddress(transaction.from),
      currentSigner: getAddress(agent.authorizedSigner),
      active: agent.active,
    },
    payment: {
      recipient,
      amountWei: amount.toString(),
      amountMon: formatEther(amount),
      requestId: executed?.args.requestId ?? requestId,
      policyVersion: executed?.args.policyVersion.toString(),
      utcDay: executed ? new Date(Number(executed.args.dayIndex) * 86_400_000).toISOString().slice(0, 10) : undefined,
      recipientApprovedNow: approvedNow,
    },
    requestDetails,
    meaning: paid
      ? `Agent #${agentId} paid ${formatEther(amount)} MON to ${recipient}. The vault checked at execution that the signer was the agent's authorized key, the recipient was approved by the owner, and the amount was within the per-payment and daily limits of policy version ${executed!.args.policyVersion}.`
      : "The agent asked the vault to pay and the contract refused. No funds moved.",
  };
}
