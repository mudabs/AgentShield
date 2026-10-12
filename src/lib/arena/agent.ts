import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  formatEther,
  getAddress,
  http,
  isAddress,
  parseEventLogs,
  type Address,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet, MONAD_TESTNET_CHAIN_ID } from "../monad";
import { registryAbi, registryAddress, vaultAbi, vaultAddress } from "../guard";
import { describeError } from "../errors";
import { parseModelJson, resolveIntents, type AddressBookEntry } from "../ai/intent";
import { complete, listProviders, ProviderError, type ProviderId } from "../ai/providers";
import { createEnvelope, encodeEnvelope, envelopeRequestId } from "../receipts";
import { modelTextForResolution, promptFor, userTextForResolution, type ArenaMode } from "./prompts";
import { recordAttempt, type ArenaOutcome } from "./store";

/**
 * The public demo agent. Its signing key lives only on the server (DEMO_AGENT_PRIVATE_KEY,
 * testnet only), the way a real autonomous agent would run. The key can do one thing:
 * ask the vault to pay. Everything else in this file is presentation; the vault decides.
 */

export type ArenaEvent =
  | { type: "start"; mode: ArenaMode; provider: string; model: string }
  | { type: "model"; latencyMs: number; raw: string }
  | { type: "app-check"; ok: boolean; message: string; skipped?: boolean }
  | { type: "proposal"; payments: { index: number; recipient: Address; recipientName?: string; amountMon: string; memo?: string }[] }
  | { type: "vault-check"; index: number; allowed: boolean; reason?: string; errorName?: string }
  | { type: "sent"; index: number; hash: Hash }
  | { type: "confirmed"; index: number; paid: boolean; hash: Hash; receiptPath: string }
  | { type: "done"; outcome: ArenaOutcome; headline: string }
  | { type: "error"; message: string }
  | { type: "x402-request"; url: string; attempt: number }
  | { type: "x402-402"; attempt: number; amountMon: string; payTo: Address; payToName?: string; description: string }
  | { type: "x402-response"; attempt: number; status: number; message?: string }
  | { type: "x402-data"; data: unknown };

const RPC_URL = process.env.MONAD_TESTNET_RPC_URL || monadTestnet.rpcUrls.default.http[0];

export function arenaConfig() {
  const key = process.env.DEMO_AGENT_PRIVATE_KEY;
  const agentId = process.env.DEMO_AGENT_ID;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key) || !agentId || !/^\d+$/.test(agentId) || !vaultAddress || !registryAddress) {
    return undefined;
  }
  const book: AddressBookEntry[] = [];
  for (const pair of (process.env.DEMO_ADDRESS_BOOK ?? "").split(",")) {
    const [name, address] = pair.split(":").map((part) => part?.trim());
    if (name && address && isAddress(address)) book.push({ name, address: getAddress(address) });
  }
  const account = privateKeyToAccount(key as `0x${string}`);
  return { account, agentId: BigInt(agentId), book };
}

let clients: { publicClient: ReturnType<typeof createPublicClient>; walletClient: ReturnType<typeof createWalletClient> } | undefined;
function getClients(account: ReturnType<typeof privateKeyToAccount>) {
  clients ??= {
    publicClient: createPublicClient({ chain: monadTestnet, transport: http(RPC_URL) }),
    walletClient: createWalletClient({ account, chain: monadTestnet, transport: http(RPC_URL) }),
  };
  return clients;
}

/** Clients signing as the server-held demo agent key (shared with the mandates demo). */
export function demoAgentClients() {
  const config = arenaConfig();
  if (!config) return undefined;
  return { account: config.account, ...getClients(config.account) };
}

// One payment at a time from this process, so two visitors never race for the same nonce.
let sendQueue: Promise<unknown> = Promise.resolve();
export function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = sendQueue.then(task, task);
  sendQueue = run.catch(() => undefined);
  return run;
}

export function errorName(error: unknown): string | undefined {
  if (!(error instanceof BaseError)) return undefined;
  const reverted = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
  return reverted instanceof ContractFunctionRevertedError ? reverted.data?.errorName : undefined;
}

/** Live state of the demo agent for the page header. */
export async function arenaStatus() {
  const config = arenaConfig();
  if (!config) return { configured: false as const };
  const { publicClient } = getClients(config.account);
  const [agent, policy, balance, gas, approvals] = await Promise.all([
    publicClient.readContract({ address: registryAddress!, abi: registryAbi, functionName: "getAgent", args: [config.agentId] }),
    publicClient.readContract({ address: vaultAddress!, abi: vaultAbi, functionName: "getPolicy", args: [config.agentId] }),
    publicClient.readContract({ address: vaultAddress!, abi: vaultAbi, functionName: "vaultBalance", args: [config.agentId] }),
    publicClient.getBalance({ address: config.account.address }),
    Promise.all(
      config.book.map((entry) =>
        publicClient.readContract({
          address: vaultAddress!,
          abi: vaultAbi,
          functionName: "approvedRecipients",
          args: [config.agentId, entry.address],
        }),
      ),
    ),
  ]);
  const [perPaymentLimit, dailyLimit, spentToday, , policyVersion, paused] = policy;
  return {
    configured: true as const,
    agentId: config.agentId.toString(),
    signer: config.account.address,
    owner: agent.owner,
    active: agent.active,
    vaultBalance: formatEther(balance),
    gasBalance: formatEther(gas),
    perPaymentLimit: formatEther(perPaymentLimit),
    dailyLimit: formatEther(dailyLimit),
    spentToday: formatEther(spentToday),
    policyVersion: policyVersion.toString(),
    paused,
    recipients: config.book.map((entry, index) => ({ name: entry.name, address: entry.address, approved: approvals[index] })),
    providers: listProviders().filter((provider) => provider.configured),
  };
}

export async function runAttack(
  input: { text: string; mode: ArenaMode; provider: ProviderId },
  emit: (event: ArenaEvent) => void,
): Promise<void> {
  const config = arenaConfig();
  if (!config) {
    emit({ type: "error", message: "The demo agent is not configured on this server." });
    return;
  }
  const { publicClient, walletClient } = getClients(config.account);
  const approved = new Set(config.book.map((entry) => entry.address));
  const providerInfo = listProviders().find((provider) => provider.id === input.provider)!;
  let outcome: ArenaOutcome = "error";
  let headline = "Something went wrong before the agent could act.";
  let summary = "";
  let paidWei = BigInt(0);
  let unapprovedWei = BigInt(0);
  let firstHash: Hash | undefined;

  emit({ type: "start", mode: input.mode, provider: providerInfo.label, model: providerInfo.model });
  try {
    // 1. The agent's brain.
    const started = Date.now();
    let completion: { text: string; model: string };
    try {
      completion = await complete(input.provider, promptFor(input.mode, config.book.map((entry) => entry.name)), input.text);
    } catch (error) {
      throw new Error(error instanceof ProviderError ? error.message : "The model request failed.");
    }
    emit({ type: "model", latencyMs: Date.now() - started, raw: completion.text.slice(0, 800) });

    // 2. App-side validation (switched off in compromised mode, apart from basic shape).
    const modelText = modelTextForResolution(input.mode, completion.text);
    const resolved = resolveIntents(
      parseModelJson(modelText),
      config.book,
      userTextForResolution(input.mode, input.text, modelText),
    );
    if (!resolved.ok) {
      emit({
        type: "app-check",
        ok: false,
        message: resolved.code === "model_declined" ? `The AI refused: ${resolved.message}` : `AgentShield rejected the AI's answer: ${resolved.message}`,
      });
      outcome = "ai_refused";
      headline = resolved.code === "model_declined" ? "The AI refused. Nothing reached the vault." : "The app rejected the AI's answer. Nothing reached the vault.";
      summary = resolved.code === "model_declined" ? "AI refused the request" : `App rejected AI output (${resolved.code})`;
      return;
    }
    emit({
      type: "app-check",
      ok: true,
      skipped: input.mode === "compromised",
      message:
        input.mode === "compromised"
          ? "App-side checks are off in compromised mode. Only the vault contract is left."
          : "Answer is well formed and uses only approved names or addresses you typed.",
    });
    emit({
      type: "proposal",
      payments: resolved.payments.map((payment, index) => ({
        index,
        recipient: payment.intent.recipient,
        recipientName: payment.recipientName,
        amountMon: formatEther(BigInt(payment.intent.amountWei)),
        memo: payment.intent.memo,
      })),
    });

    // 3. The vault decides, payment by payment.
    let paidCount = 0;
    let refusedCount = 0;
    const reasons: string[] = [];
    for (const [index, payment] of resolved.payments.entries()) {
      const recipient = getAddress(payment.intent.recipient);
      const amountWei = BigInt(payment.intent.amountWei);
      const envelope = createEnvelope({
        chainId: MONAD_TESTNET_CHAIN_ID,
        vault: vaultAddress!,
        agentId: config.agentId,
        recipient,
        amountWei,
        source: {
          provider: providerInfo.label,
          model: completion.model,
          prompt: input.text,
          memo: payment.intent.memo,
          recipientName: payment.recipientName,
          ...(resolved.payments.length > 1 ? { part: `${index + 1} of ${resolved.payments.length}` } : {}),
        },
      });
      const args = [config.agentId, envelopeRequestId(envelope), recipient, amountWei] as const;

      const result = await serialized(async () => {
        try {
          await publicClient.simulateContract({ account: config.account, address: vaultAddress!, abi: vaultAbi, functionName: "executePayment", args });
        } catch (error) {
          return { allowed: false as const, reason: describeError(error as Error), name: errorName(error) };
        }
        emit({ type: "vault-check", index, allowed: true });
        const gas = await publicClient.estimateContractGas({
          account: config.account,
          address: vaultAddress!,
          abi: vaultAbi,
          functionName: "executePayment",
          args,
        });
        const hash = await walletClient.writeContract({
          account: config.account,
          chain: monadTestnet,
          address: vaultAddress!,
          abi: vaultAbi,
          functionName: "executePayment",
          args,
          gas: (gas * BigInt(125)) / BigInt(100),
        });
        emit({ type: "sent", index, hash });
        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 45_000 });
        const executed = parseEventLogs({ abi: vaultAbi, eventName: "PaymentExecuted", logs: receipt.logs });
        return { allowed: true as const, hash, paid: receipt.status === "success" && executed.length > 0 };
      });

      if (!result.allowed) {
        refusedCount += 1;
        reasons.push(result.name ?? "refused");
        emit({ type: "vault-check", index, allowed: false, reason: result.reason, errorName: result.name });
        continue;
      }
      emit({
        type: "confirmed",
        index,
        paid: result.paid,
        hash: result.hash,
        receiptPath: `/receipt/${result.hash}#e=${encodeEnvelope(envelope)}`,
      });
      if (result.paid) {
        paidCount += 1;
        paidWei += amountWei;
        firstHash ??= result.hash;
        if (!approved.has(recipient)) unapprovedWei += amountWei;
      } else {
        refusedCount += 1;
        reasons.push("reverted");
      }
    }

    if (paidCount > 0) {
      outcome = "paid_within_policy";
      headline =
        refusedCount > 0
          ? `${paidCount} payment${paidCount > 1 ? "s" : ""} allowed by policy, ${refusedCount} refused by the vault.`
          : `Paid ${formatEther(paidWei)} MON to an approved recipient, within the owner's limits.`;
      summary = `Paid ${formatEther(paidWei)} MON within policy${refusedCount ? `, ${refusedCount} refused (${[...new Set(reasons)].join(", ")})` : ""}`;
    } else {
      outcome = "vault_refused";
      headline = `The vault refused ${refusedCount === 1 ? "the payment" : `all ${refusedCount} payments`}. 0 MON moved.`;
      const total = resolved.payments.reduce((sum, payment) => sum + BigInt(payment.intent.amountWei), BigInt(0));
      summary = `Vault refused ${formatEther(total)} MON (${[...new Set(reasons)].join(", ")})`;
    }
  } catch (error) {
    outcome = "error";
    headline = error instanceof Error ? error.message : "Unexpected error.";
    summary = "Error";
    emit({ type: "error", message: headline });
  } finally {
    emit({ type: "done", outcome, headline });
    try {
      await recordAttempt(
        { at: Date.now(), mode: input.mode, provider: providerInfo.label, outcome, summary: summary || headline, hash: firstHash },
        paidWei,
        unapprovedWei,
      );
    } catch {
      // The scoreboard is best effort; the attack result above is what matters.
    }
  }
}


/**
 * Pays from the demo agent's vault with a caller-chosen request ID (used by the x402
 * flow, where the request ID is the hash of the server's payment challenge).
 * Previews first; only sends when the vault would allow it.
 */
export async function vaultPayAsDemoAgent(
  input: { recipient: Address; amountWei: bigint; requestId: `0x${string}`; index: number },
  emit: (event: ArenaEvent) => void,
): Promise<{ allowed: false; reason: string; name?: string } | { allowed: true; paid: boolean; hash: Hash }> {
  const config = arenaConfig();
  if (!config) throw new Error("The demo agent is not configured on this server.");
  const { publicClient, walletClient } = getClients(config.account);
  const args = [config.agentId, input.requestId, getAddress(input.recipient), input.amountWei] as const;
  return serialized(async () => {
    try {
      await publicClient.simulateContract({ account: config.account, address: vaultAddress!, abi: vaultAbi, functionName: "executePayment", args });
    } catch (error) {
      const result = { allowed: false as const, reason: describeError(error as Error), name: errorName(error) };
      emit({ type: "vault-check", index: input.index, allowed: false, reason: result.reason, errorName: result.name });
      return result;
    }
    emit({ type: "vault-check", index: input.index, allowed: true });
    const gas = await publicClient.estimateContractGas({ account: config.account, address: vaultAddress!, abi: vaultAbi, functionName: "executePayment", args });
    const hash = await walletClient.writeContract({
      account: config.account,
      chain: monadTestnet,
      address: vaultAddress!,
      abi: vaultAbi,
      functionName: "executePayment",
      args,
      gas: (gas * BigInt(125)) / BigInt(100),
    });
    emit({ type: "sent", index: input.index, hash });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 45_000 });
    const paid = receipt.status === "success" && parseEventLogs({ abi: vaultAbi, eventName: "PaymentExecuted", logs: receipt.logs }).length > 0;
    emit({ type: "confirmed", index: input.index, paid, hash, receiptPath: `/receipt/${hash}` });
    return { allowed: true as const, paid, hash };
  });
}
