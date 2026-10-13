"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useAccount,
  useBalance,
  useConnect,
  useDisconnect,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import {
  formatEther,
  getAddress,
  isAddress,
  parseEther,
  parseEventLogs,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { MONAD_TESTNET_CHAIN_ID, MONAD_TESTNET_EXPLORER_URL } from "@/lib/monad";
import { registryAddress, vaultAbi, vaultAddress } from "@/lib/guard";
import { loadAgents, sameAddress } from "@/lib/agents";
import { parseMonAmount } from "@/lib/amounts";
import { describeError } from "@/lib/errors";
import { setRecipientName, useAddressBook, type BookEntry } from "@/lib/recipients";
import { SiteNav } from "../site-nav";
import { setSelectedAgentId, useSelectedAgentId } from "@/lib/selected-agent";
import { addHistory, useHistory, type HistoryOutcome, type HistoryRecord } from "@/lib/history";
import { createEnvelope, encodeEnvelope, envelopeRequestId, type RequestEnvelope } from "@/lib/receipts";
import { BrandMark } from "../brand-mark";

// A payment that the vault refuses reverts very early, so a fixed gas limit is
// plenty. It lets the "submit anyway" path reach the chain even though the
// wallet's own gas estimate would fail. (Monad charges by gas limit.)
const FORCED_SUBMIT_GAS = BigInt(150_000);
const LOW_GAS_WARNING = parseEther("0.02");

/** Declared AI context for a request: what was typed and which model interpreted it. */
type Source = { providerLabel: string; model: string; prompt: string; memo?: string; recipientName?: string; part?: string };
type Request = { requestId: Hex; recipient: Address; amountWei: bigint; source?: Source; envelope: RequestEnvelope };

type ProviderInfo = { id: string; label: string; model: string; configured: boolean };
type Interpretation =
  | {
      ok: true;
      intent: { recipient: Address; amountWei: string; memo?: string };
      recipientName?: string;
      /** Every payment in the request, in order. One entry for a normal request. */
      payments: { intent: { recipient: Address; amountWei: string; memo?: string }; recipientName?: string }[];
      providerLabel: string;
      model: string;
      latencyMs: number;
      prompt: string;
    }
  | { ok: false; message: string; providerLabel?: string; model?: string; rawOutput?: string };
type Preview = Request & ({ verdict: "allowed" } | { verdict: "refused"; reason: string });
type BatchState = "ready" | "refused" | "sending" | "paid" | "blocked" | "failed" | "skipped";
type BatchItem = Request & { state: BatchState; reason?: string };

type Attempt = Request & {
  outcome: HistoryOutcome;
  hash?: Hash;
  note: string;
  policyVersion?: bigint;
  dayIndex?: bigint;
};

// Normal sends use the node's gas estimate plus this margin instead of the wallet's
// default padding. Monad charges for the gas limit, so a tight limit is cheaper.
const GAS_MARGIN_PERCENT = BigInt(125);

function shortAddress(value?: string) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—";
}

function utcDate(dayIndex: bigint) {
  return new Date(Number(dayIndex) * 86_400_000).toISOString().slice(0, 10);
}

export default function AgentConsolePage() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: MONAD_TESTNET_CHAIN_ID });
  const isOnMonadTestnet = chainId === MONAD_TESTNET_CHAIN_ID;
  const activeConnector = connectors[0];

  const [recipientInput, setRecipientInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [isConfirming, setIsConfirming] = useState(false);
  const [batch, setBatch] = useState<BatchItem[]>();
  const [isSendingBatch, setIsSendingBatch] = useState(false);

  // Agents whose authorized signer is the connected account.
  const agentsQuery = useQuery({
    queryKey: ["signer-agents", registryAddress, address],
    enabled: Boolean(publicClient && registryAddress && address),
    queryFn: () =>
      loadAgents(publicClient!, registryAddress!, (agent) => sameAddress(agent.authorizedSigner, address)),
  });
  const agents = agentsQuery.data ?? [];
  const agentId = useSelectedAgentId(agents.map((candidate) => candidate.id));
  const agent = agents.find((candidate) => candidate.id === agentId);
  const book = useAddressBook(agentId);
  const namedBook = book.filter((entry) => entry.name.trim());

  // AI interpretation state.
  const providersQuery = useQuery({
    queryKey: ["ai-providers"],
    queryFn: async () => {
      const response = await fetch("/api/intent");
      if (!response.ok) throw new Error("Could not load AI providers.");
      return ((await response.json()) as { providers: ProviderInfo[] }).providers;
    },
    staleTime: 60_000,
  });
  const providers = providersQuery.data ?? [];
  const [chosenProvider, setChosenProvider] = useState<string>();
  const activeProvider = chosenProvider ?? providers.find((entry) => entry.configured)?.id;
  const [aiText, setAiText] = useState("");
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [interpretation, setInterpretation] = useState<Interpretation>();

  const { data: policy, refetch: refetchPolicy } = useReadContract({
    address: vaultAddress,
    abi: vaultAbi,
    functionName: "getPolicy",
    args: agentId === undefined ? undefined : [agentId],
    chainId: MONAD_TESTNET_CHAIN_ID,
    query: { enabled: Boolean(vaultAddress && agentId !== undefined) },
  });
  const { data: vaultBalance, refetch: refetchVaultBalance } = useReadContract({
    address: vaultAddress,
    abi: vaultAbi,
    functionName: "vaultBalance",
    args: agentId === undefined ? undefined : [agentId],
    chainId: MONAD_TESTNET_CHAIN_ID,
    query: { enabled: Boolean(vaultAddress && agentId !== undefined) },
  });
  const { data: gasBalance, refetch: refetchGasBalance } = useBalance({
    address,
    chainId: MONAD_TESTNET_CHAIN_ID,
    query: { enabled: Boolean(address) },
  });

  // Receipts are awaited with viem directly. wagmi's receipt helper throws on a
  // reverted transaction, which would hide the fact that it was mined and refused.
  const { isPending: isAwaitingWallet, writeContractAsync } = useWriteContract();

  const history = useHistory(agentId);
  const recordAttempt = (attempt: Attempt) =>
    addHistory({
      envelope: attempt.envelope,
      outcome: attempt.outcome,
      note: attempt.note,
      hash: attempt.hash,
      policyVersion: attempt.policyVersion?.toString(),
      dayIndex: attempt.dayIndex?.toString(),
    });

  const [perPaymentLimit, dailyLimit, spentToday, , policyVersion, paused] = policy ?? [];
  const remainingToday =
    dailyLimit !== undefined && spentToday !== undefined && dailyLimit > spentToday
      ? dailyLimit - spentToday
      : BigInt(0);

  const amount = parseMonAmount(amountInput);
  const recipientValid = isAddress(recipientInput.trim());
  const busy = isChecking || isAwaitingWallet || isConfirming || isSendingBatch;
  const canPreview = isConnected && isOnMonadTestnet && agentId !== undefined && !busy;
  const canCheck = canPreview && recipientValid && amount.ok;

  const clearPreview = () => {
    setPreview(undefined);
    setBatch(undefined);
  };

  /**
   * The request ID is the hash of everything about this request, including the
   * prompt and declared model for AI requests, so the onchain record commits to it.
   */
  const buildRequest = (recipient: Address, amountWei: bigint, source?: Source): Request | undefined => {
    if (!vaultAddress || agentId === undefined) return undefined;
    const envelope = createEnvelope({
      chainId: MONAD_TESTNET_CHAIN_ID,
      vault: vaultAddress,
      agentId,
      recipient,
      amountWei,
      source: source && {
        provider: source.providerLabel,
        model: source.model,
        prompt: source.prompt,
        memo: source.memo,
        recipientName: source.recipientName,
        part: source.part,
      },
    });
    return { requestId: envelopeRequestId(envelope), recipient, amountWei, source, envelope };
  };

  /** Step 1: ask the vault, without sending anything, whether it would allow this payment. */
  const runCheck = async (recipient: Address, amountWei: bigint, source?: Source) => {
    if (!canPreview || !publicClient || !vaultAddress || !address || agentId === undefined) return;
    const request = buildRequest(recipient, amountWei, source);
    if (!request) return;
    setIsChecking(true);
    try {
      await publicClient.simulateContract({
        account: address,
        address: vaultAddress,
        abi: vaultAbi,
        functionName: "executePayment",
        args: [agentId, request.requestId, request.recipient, request.amountWei],
      });
      setPreview({ ...request, verdict: "allowed" });
    } catch (error) {
      setPreview({ ...request, verdict: "refused", reason: describeError(error as Error) });
    } finally {
      setIsChecking(false);
    }
  };

  const checkWithVault = () => {
    if (!canCheck || !amount.ok) return;
    void runCheck(getAddress(recipientInput.trim()), amount.wei);
  };

  /** Sends the sentence to the server, which asks the chosen model and validates its answer. */
  const interpret = async () => {
    const prompt = aiText.trim();
    if (!prompt || !activeProvider) return;
    setIsInterpreting(true);
    setInterpretation(undefined);
    clearPreview();
    try {
      const response = await fetch("/api/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: activeProvider,
          request: prompt,
          addressBook: namedBook.map((entry) => ({ name: entry.name.trim(), address: entry.address })),
        }),
      });
      const result = (await response.json()) as Record<string, unknown>;
      if (result.ok === true) {
        const ok = result as Omit<Extract<Interpretation, { ok: true }>, "prompt">;
        const payments = Array.isArray(ok.payments) && ok.payments.length > 0
          ? ok.payments
          : [{ intent: ok.intent, recipientName: ok.recipientName }];
        setInterpretation({ ...ok, payments, ok: true, prompt });
      } else {
        setInterpretation({
          ok: false,
          message: typeof result.message === "string" ? result.message : `Request failed (HTTP ${response.status}).`,
          providerLabel: typeof result.providerLabel === "string" ? result.providerLabel : undefined,
          model: typeof result.model === "string" ? result.model : undefined,
          rawOutput: typeof result.rawOutput === "string" ? result.rawOutput : undefined,
        });
      }
    } catch {
      setInterpretation({ ok: false, message: "Could not reach the AgentShield server." });
    } finally {
      setIsInterpreting(false);
    }
  };

  /**
   * Hands the validated AI proposal to the exact same vault check as a manual request.
   * The proposal is consumed here, so it cannot be sent twice, and the manual form
   * is left alone: the preview card shows exactly what will be paid.
   */
  const applyInterpretation = () => {
    if (!interpretation?.ok) return;
    if (interpretation.payments.length > 1) {
      void runBatchCheck(interpretation);
      return;
    }
    const { intent } = interpretation;
    const amountWei = BigInt(intent.amountWei);
    setInterpretation(undefined);
    void runCheck(getAddress(intent.recipient), amountWei, {
      providerLabel: interpretation.providerLabel,
      model: interpretation.model,
      prompt: interpretation.prompt,
      memo: intent.memo,
      recipientName: interpretation.recipientName,
    });
  };

  /**
   * Step 2: send the real transaction. The contract re-checks everything at execution.
   * Every path ends by closing the preview and recording exactly one attempt.
   */
  const sendOne = async (request: Request, forceOnchain: boolean, previewReason?: string): Promise<HistoryOutcome> => {
    if (!vaultAddress || !publicClient || !address || agentId === undefined) return "failed";
    let outcome: HistoryOutcome = "failed";
    const args = [agentId, request.requestId, request.recipient, request.amountWei] as const;

    let gas = forceOnchain ? FORCED_SUBMIT_GAS : undefined;
    if (!forceOnchain) {
      try {
        const estimate = await publicClient.estimateContractGas({
          account: address,
          address: vaultAddress,
          abi: vaultAbi,
          functionName: "executePayment",
          args,
        });
        gas = (estimate * GAS_MARGIN_PERCENT) / BigInt(100);
      } catch {
        // Let the wallet estimate; the vault still decides.
      }
    }

    let hash: Hash;
    try {
      hash = await writeContractAsync({
        address: vaultAddress,
        abi: vaultAbi,
        functionName: "executePayment",
        args,
        chainId: MONAD_TESTNET_CHAIN_ID,
        ...(gas ? { gas } : {}),
      });
    } catch (error) {
      recordAttempt({ ...request, outcome: "failed", note: `Nothing was sent. ${describeError(error as Error)}` });
      return "failed";
    }

    setIsConfirming(true);
    try {
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status === "success") {
        const [executed] = parseEventLogs({
          abi: vaultAbi,
          eventName: "PaymentExecuted",
          logs: receipt.logs.filter((log) => sameAddress(log.address, vaultAddress)),
        });
        outcome = "paid";
        recordAttempt({
          ...request,
          outcome: "paid",
          hash,
          note: "Paid. The vault checked every rule onchain and sent the funds.",
          policyVersion: executed?.args.policyVersion,
          dayIndex: executed?.args.dayIndex,
        });
      } else {
        // Replay the call against the state of the block it was mined in to learn
        // the contract's actual reason. A reverted transaction changes no state.
        let reason: string | undefined;
        try {
          await publicClient.simulateContract({
            account: address,
            address: vaultAddress,
            abi: vaultAbi,
            functionName: "executePayment",
            args,
            blockNumber: receipt.blockNumber,
          });
        } catch (replayError) {
          reason = describeError(replayError as Error);
        }
        reason ??= previewReason ? `${previewReason} (from the preview)` : "reason unavailable";
        outcome = "reverted-onchain";
        recordAttempt({
          ...request,
          outcome: "reverted-onchain",
          hash,
          note: `Reached Monad and was reverted by the vault. No funds moved. ${reason}`,
        });
      }
    } catch (error) {
      recordAttempt({
        ...request,
        outcome: "failed",
        hash,
        note: `Sent, but the result could not be confirmed yet: ${describeError(error as Error)} Check the transaction link.`,
      });
    } finally {
      setIsConfirming(false);
      void refetchPolicy();
      void refetchVaultBalance();
      void refetchGasBalance();
    }
    return outcome;
  };

  /** Sends the single previewed payment, then closes it and clears the manual form. */
  const submit = async (forceOnchain: boolean) => {
    if (!preview) return;
    const request = preview;
    await sendOne(request, forceOnchain, request.verdict === "refused" ? request.reason : undefined);
    // The request reached the chain or failed for good: clear the form so the same
    // payment is not sent again by accident.
    setPreview(undefined);
    setRecipientInput("");
    setAmountInput("");
  };

  /**
   * Several payments from one sentence. Each is previewed against the vault, and the
   * running total is checked against today's remaining limit and the vault balance,
   * because the vault checks each payment against the state left by the previous one.
   */
  const runBatchCheck = async (result: Extract<Interpretation, { ok: true }>) => {
    if (!canPreview || !publicClient || !vaultAddress || !address || agentId === undefined) return;
    setInterpretation(undefined);
    setPreview(undefined);
    setIsChecking(true);
    const items: BatchItem[] = [];
    let runningTotal = BigInt(0);
    const total = result.payments.length;
    try {
      for (const [index, payment] of result.payments.entries()) {
        const request = buildRequest(getAddress(payment.intent.recipient), BigInt(payment.intent.amountWei), {
          providerLabel: result.providerLabel,
          model: result.model,
          prompt: result.prompt,
          memo: payment.intent.memo,
          recipientName: payment.recipientName,
          part: `${index + 1} of ${total}`,
        });
        if (!request) return;
        let reason: string | undefined;
        try {
          await publicClient.simulateContract({
            account: address,
            address: vaultAddress,
            abi: vaultAbi,
            functionName: "executePayment",
            args: [agentId, request.requestId, request.recipient, request.amountWei],
          });
        } catch (error) {
          reason = describeError(error as Error);
        }
        if (!reason) {
          const nextTotal = runningTotal + request.amountWei;
          if (policy && nextTotal > remainingToday) {
            reason = "Together with the earlier payments in this request, this would go over today's limit.";
          } else if (vaultBalance !== undefined && nextTotal > vaultBalance) {
            reason = "Together with the earlier payments in this request, this is more than the vault holds.";
          } else {
            runningTotal = nextTotal;
          }
        }
        items.push({ ...request, state: reason ? "refused" : "ready", reason });
      }
      setBatch(items);
    } finally {
      setIsChecking(false);
    }
  };

  /** Sends the allowed payments one by one, each its own transaction. Stops at the first problem. */
  const sendBatch = async () => {
    if (!batch) return;
    setIsSendingBatch(true);
    const items = batch.map((item) => ({ ...item }));
    let stopped = false;
    try {
      for (const item of items) {
        if (item.state === "refused") {
          recordAttempt({ ...item, outcome: "refused-not-sent", note: `Not sent. ${item.reason}` });
          continue;
        }
        if (stopped) {
          item.state = "skipped";
          continue;
        }
        item.state = "sending";
        setBatch(items.map((entry) => ({ ...entry })));
        const outcome = await sendOne(item, false);
        item.state = outcome === "paid" ? "paid" : outcome === "reverted-onchain" ? "blocked" : "failed";
        if (outcome !== "paid") stopped = true;
        setBatch(items.map((entry) => ({ ...entry })));
      }
    } finally {
      setIsSendingBatch(false);
      setBatch(items.map((entry) => ({ ...entry })));
    }
  };

  const discardBatch = () => {
    // Refused items are recorded once: here if nothing was sent, or by sendBatch.
    const started = batch?.some((item) => item.state !== "ready" && item.state !== "refused");
    if (!started) {
      batch?.filter((item) => item.state === "refused").forEach((item) =>
        recordAttempt({ ...item, outcome: "refused-not-sent", note: `Not sent. ${item.reason}` }),
      );
    }
    setBatch(undefined);
  };

  const declineToSend = () => {
    if (preview?.verdict !== "refused") return;
    recordAttempt({ ...preview, outcome: "refused-not-sent", note: `Not sent. ${preview.reason}` });
    setPreview(undefined);
  };


  return (
    <main className="relative min-h-screen overflow-hidden bg-[#080a0d] text-zinc-100">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-60" />
      <div className="relative mx-auto w-full max-w-6xl px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-6">
          <Link className="flex items-center gap-3" href="/">
            <BrandMark />
            <div>
              <p className="text-sm font-semibold tracking-wide text-white">AgentShield</p>
              <p className="text-xs text-zinc-500">Agent console</p>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <SiteNav />
            {isConnected ? (
              <button
                className="rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/10"
                onClick={() => disconnect()}
              >
                {shortAddress(address)}
              </button>
            ) : (
              <button
                className="rounded-full bg-lime-300 px-4 py-2 text-xs font-bold text-zinc-950 transition hover:bg-lime-200 disabled:opacity-60"
                disabled={isConnecting || !activeConnector}
                onClick={() => activeConnector && connect({ connector: activeConnector })}
              >
                {isConnecting ? "Connecting…" : "Connect wallet"}
              </button>
            )}
          </div>
        </header>

        <section className="py-10 lg:py-12">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-lime-200/70">Step 3 · Acting as the agent</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
            Ask the vault to pay.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-400">
            This page does not decide anything. It sends the request to the vault contract, which checks
            the signer, the recipient list, the limits, and the pause switch before any MON moves.
          </p>
        </section>

        {isConnected && !isOnMonadTestnet && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4 text-sm text-cyan-100">
            <span>Your wallet is on chain {chainId}. Switch to Monad Testnet (chain {MONAD_TESTNET_CHAIN_ID}).</span>
            <button
              className="rounded-xl bg-cyan-300 px-4 py-2 text-xs font-bold text-zinc-950 hover:bg-cyan-200 disabled:opacity-60"
              disabled={isSwitching}
              onClick={() => switchChain({ chainId: MONAD_TESTNET_CHAIN_ID })}
            >
              {isSwitching ? "Requesting switch…" : "Switch to Monad Testnet"}
            </button>
          </div>
        )}

        {!isConnected ? (
          <Notice tone="info">
            This page is where an agent makes payments. Connect the wallet account you chose as your agent&apos;s signer
            when you created it on <Link className="underline underline-offset-4" href="/agent">Owner setup</Link>. No agent
            yet? Create one there in about two minutes, or try the{" "}
            <Link className="underline underline-offset-4" href="/arena">no-wallet demo agent</Link>.
          </Notice>
        ) : agentsQuery.isLoading ? (
          <Notice tone="info">Looking up agents that this account signs for…</Notice>
        ) : agentsQuery.error ? (
          <Notice tone="error">Could not read the registry: {describeError(agentsQuery.error)}</Notice>
        ) : agents.length === 0 ? (
          <Notice tone="warning">
            {shortAddress(address)} is not the signer for any agent yet. Each agent has its own signer account, separate
            from its owner, so the agent can never change its own rules. To get started:{" "}
            <Link className="underline underline-offset-4" href="/agent">create an agent on Owner setup</Link> with your owner
            account and give it a second account as its signer, then switch MetaMask to that second account here. If you
            are connected as an owner, this is expected: owners set the rules, agents make the payments.
          </Notice>
        ) : (
          <section className="grid gap-5 pb-10 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-3xl border border-white/10 bg-[#101419] p-6 sm:p-7">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Payment request</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">New request</h2>

              {agents.length > 1 && (
                <div className="mt-5 flex flex-wrap gap-2">
                  {agents.map((candidate) => (
                    <button
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                        candidate.id === agentId
                          ? "border-lime-300 bg-lime-300 text-zinc-950"
                          : "border-white/15 bg-white/[0.04] text-zinc-300"
                      }`}
                      key={candidate.id.toString()}
                      onClick={() => {
                        setSelectedAgentId(candidate.id);
                        clearPreview();
                      }}
                    >
                      Agent #{candidate.id.toString()}
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-5 rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.05] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-cyan-100">Ask in plain language</p>
                  <div className="flex flex-wrap gap-1.5">
                    {providers.map((entry) => (
                      <button
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                          entry.id === activeProvider
                            ? "border-cyan-300 bg-cyan-300 text-zinc-950"
                            : "border-white/15 bg-white/[0.04] text-zinc-300 hover:bg-white/10"
                        }`}
                        disabled={!entry.configured}
                        key={entry.id}
                        onClick={() => setChosenProvider(entry.id)}
                        title={entry.configured ? entry.model : `${entry.label} is not configured on this server`}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                </div>
                <textarea
                  className="mt-3 w-full resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-cyan-300/50"
                  maxLength={500}
                  onChange={(event) => setAiText(event.target.value)}
                  placeholder={
                    namedBook[0] ? `e.g. Pay ${namedBook[0].name} 0.05 MON for the coffee order` : "e.g. Pay Shop 0.05 MON for the coffee order"
                  }
                  rows={2}
                  value={aiText}
                />
                <p className="mt-1 text-[11px] leading-4 text-zinc-500">
                  {namedBook.length > 0
                    ? `The AI may only choose from your named recipients: ${namedBook.map((entry) => entry.name).join(", ")}.`
                    : "The AI only knows recipients by name. Name at least one below."}
                </p>
                {agentId !== undefined && book.length > 0 && <AddressBookEditor agentId={agentId} book={book} />}
                <button
                  className="mt-3 w-full rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-bold text-zinc-950 hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!aiText.trim() || !activeProvider || isInterpreting || busy}
                  onClick={() => void interpret()}
                >
                  {isInterpreting
                    ? "Interpreting…"
                    : activeProvider
                      ? `Interpret with ${providers.find((entry) => entry.id === activeProvider)?.label ?? "AI"}`
                      : providersQuery.isLoading
                        ? "Loading models…"
                        : "No AI model configured"}
                </button>

                {interpretation?.ok && (
                  <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 text-xs leading-5">
                    {interpretation.payments.length > 1 ? (
                      <>
                        <p className="text-zinc-300">
                          <span className="font-semibold text-white">
                            {interpretation.providerLabel} ({interpretation.model})
                          </span>{" "}
                          understood {interpretation.payments.length} payments, totalling{" "}
                          <span className="font-mono text-white">
                            {formatEther(interpretation.payments.reduce((sum, item) => sum + BigInt(item.intent.amountWei), BigInt(0)))} MON
                          </span>
                          :
                        </p>
                        <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-zinc-300">
                          {interpretation.payments.map((item, index) => (
                            <li key={index}>
                              <span className="font-mono text-white">{formatEther(BigInt(item.intent.amountWei))} MON</span> to{" "}
                              <span className="text-white">{item.recipientName ?? "an address you typed"}</span>
                              {item.intent.memo ? ` for "${item.intent.memo}"` : ""}
                            </li>
                          ))}
                        </ol>
                      </>
                    ) : (
                      <p className="text-zinc-300">
                        <span className="font-semibold text-white">
                          {interpretation.providerLabel} ({interpretation.model})
                        </span>{" "}
                        understood: pay <span className="font-mono text-white">{formatEther(BigInt(interpretation.intent.amountWei))} MON</span> to{" "}
                        <span className="text-white">{interpretation.recipientName ?? "an address you typed"}</span>{" "}
                        <span className="font-mono text-zinc-400">({shortAddress(interpretation.intent.recipient)})</span>
                        {interpretation.intent.memo ? ` for "${interpretation.intent.memo}"` : ""}.
                      </p>
                    )}
                    <p className="mt-1 text-zinc-500">
                      Checked by AgentShield: valid address from your address book or your own text, valid amount.
                      The vault still decides. ({interpretation.latencyMs} ms)
                    </p>
                    <button
                      className="mt-3 w-full rounded-lg bg-lime-300 px-3 py-2 text-xs font-bold text-zinc-950 hover:bg-lime-200 disabled:opacity-40"
                      disabled={!canPreview}
                      onClick={applyInterpretation}
                    >
                      {interpretation.payments.length > 1
                        ? `Check all ${interpretation.payments.length} with the vault`
                        : "Check this request with the vault"}
                    </button>
                  </div>
                )}
                {interpretation && !interpretation.ok && (
                  <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-xs leading-5 text-amber-100">
                    <p>
                      {interpretation.providerLabel ? `${interpretation.providerLabel}: ` : ""}
                      {interpretation.message} Nothing was sent to the vault.
                    </p>
                    {interpretation.rawOutput && (
                      <details className="mt-2 text-zinc-400">
                        <summary className="cursor-pointer">Model output</summary>
                        <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[11px]">{interpretation.rawOutput}</pre>
                      </details>
                    )}
                  </div>
                )}
              </div>

              {batch && (
                <BatchCard
                  busy={busy}
                  isSending={isSendingBatch}
                  items={batch}
                  onDiscard={discardBatch}
                  onSend={() => void sendBatch()}
                />
              )}

              <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Or fill it in yourself</p>
              <label className="mt-3 block">
                <span className="text-xs text-zinc-400">Pay to</span>
                <input
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 font-mono text-sm text-white outline-none placeholder:text-zinc-600 focus:border-lime-300/50"
                  onChange={(event) => {
                    setRecipientInput(event.target.value);
                    clearPreview();
                  }}
                  placeholder="0x… recipient address"
                  spellCheck={false}
                  value={recipientInput}
                />
              </label>
              {book.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {book.map((entry) => (
                    <button
                      className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-white/10"
                      key={entry.address}
                      onClick={() => {
                        setRecipientInput(entry.address);
                        clearPreview();
                      }}
                    >
                      {entry.name ? `${entry.name} · ` : ""}
                      <span className="font-mono">{shortAddress(entry.address)}</span>
                    </button>
                  ))}
                </div>
              )}
              {recipientInput.trim() && !recipientValid && (
                <p className="mt-2 text-xs text-rose-300">That is not a valid address.</p>
              )}

              <label className="mt-4 block">
                <span className="text-xs text-zinc-400">Amount (MON)</span>
                <input
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 font-mono text-sm text-white outline-none placeholder:text-zinc-600 focus:border-lime-300/50"
                  inputMode="decimal"
                  onChange={(event) => {
                    setAmountInput(event.target.value);
                    clearPreview();
                  }}
                  placeholder="0.05"
                  value={amountInput}
                />
              </label>
              {amountInput.trim() && !amount.ok && <p className="mt-2 text-xs text-rose-300">{amount.message}</p>}

              {!preview && (
                <button
                  className="mt-5 w-full rounded-xl bg-lime-300 px-4 py-3 text-sm font-bold text-zinc-950 transition hover:bg-lime-200 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!canCheck}
                  onClick={checkWithVault}
                >
                  {isChecking ? "Asking the vault…" : "Check with the vault"}
                </button>
              )}

              {preview && preview.verdict === "allowed" && (
                <div className="mt-5 rounded-2xl border border-lime-300/25 bg-lime-300/[0.07] p-4">
                  <p className="text-sm font-semibold text-lime-100">The vault would allow this payment.</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-400">
                    {formatEther(preview.amountWei)} MON to {preview.source?.recipientName ?? shortAddress(preview.recipient)}.
                    This is a preview; the contract checks again when the transaction executes.
                  </p>
                  {preview.source && <SourceLine source={preview.source} />}
                  <button
                    className="mt-4 w-full rounded-xl bg-lime-300 px-4 py-3 text-sm font-bold text-zinc-950 hover:bg-lime-200 disabled:opacity-40"
                    disabled={busy}
                    onClick={() => void submit(false)}
                  >
                    {isAwaitingWallet ? "Confirm in MetaMask…" : isConfirming ? "Confirming onchain…" : "Send payment"}
                  </button>
                </div>
              )}

              {preview && preview.verdict === "refused" && (
                <div className="mt-5 rounded-2xl border border-rose-300/25 bg-rose-300/[0.07] p-4">
                  <p className="text-sm font-semibold text-rose-100">The vault would refuse this payment.</p>
                  <p className="mt-1 text-xs leading-5 text-rose-100/80">{preview.reason}</p>
                  {preview.source && <SourceLine source={preview.source} />}
                  <p className="mt-3 text-xs leading-5 text-zinc-400">
                    For the demo you can submit it anyway. The transaction will reach Monad and be reverted by the
                    contract, so no funds move. It still costs a small gas fee from the agent&apos;s wallet.
                    MetaMask may warn that it is likely to fail; that is the point.
                  </p>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <button
                      className="rounded-xl border border-white/15 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-40"
                      disabled={busy}
                      onClick={declineToSend}
                    >
                      Don&apos;t send
                    </button>
                    <button
                      className="rounded-xl bg-rose-300 px-4 py-3 text-sm font-bold text-zinc-950 hover:bg-rose-200 disabled:opacity-40"
                      disabled={busy}
                      onClick={() => void submit(true)}
                    >
                      {isAwaitingWallet ? "Confirm in MetaMask…" : isConfirming ? "Confirming onchain…" : "Submit anyway"}
                    </button>
                  </div>
                </div>
              )}

              {gasBalance && gasBalance.value < LOW_GAS_WARNING && (
                <Notice tone="warning">
                  This account has {formatEther(gasBalance.value)} MON for gas. Send it a little MON from the
                  owner account so it can pay transaction fees.
                </Notice>
              )}
            </div>

            <div className="rounded-3xl border border-white/10 bg-[#101419] p-6 sm:p-7">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Live from the vault</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Agent #{agentId?.toString()}</h2>
              <dl className="mt-5 space-y-2.5 text-xs">
                <Row label="Signing as" value={`${shortAddress(address)} (agent signer)`} />
                <Row label="Owner" value={shortAddress(agent?.owner)} />
                <Row label="Vault balance" value={vaultBalance === undefined ? "—" : `${formatEther(vaultBalance)} MON`} />
                <Row label="Per-payment limit" value={perPaymentLimit === undefined ? "—" : `${formatEther(perPaymentLimit)} MON`} />
                <Row label="Daily limit (UTC)" value={dailyLimit === undefined ? "—" : `${formatEther(dailyLimit)} MON`} />
                <Row label="Spent today" value={spentToday === undefined ? "—" : `${formatEther(spentToday)} MON`} />
                <Row label="Left today" value={policy === undefined ? "—" : `${formatEther(remainingToday)} MON`} />
                <Row label="Paused" value={paused === undefined ? "—" : paused ? "Yes" : "No"} />
                <Row label="Policy version" value={policyVersion === undefined ? "—" : policyVersion.toString()} />
                <Row label="Gas wallet" value={gasBalance ? `${Number(formatEther(gasBalance.value)).toFixed(4)} MON` : "—"} />
              </dl>
              <p className="mt-5 text-xs leading-5 text-zinc-500">
                The agent signer has no withdraw function. The only way it can move vault funds is a payment
                that passes every rule above.
              </p>
            </div>
          </section>
        )}

        {history.length > 0 && (
          <section className="pb-10">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Agent #{agentId?.toString()}</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">History</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Saved in this browser. Paid and blocked entries are onchain: open the receipt to verify one against
              the chain or share it. Requests refused before sending leave no onchain record.
            </p>
            <ul className="mt-4 space-y-3">
              {history.map((record) => (
                <AttemptRow key={`${record.at}-${record.requestId}`} record={record} />
              ))}
            </ul>
          </section>
        )}

        <footer className="border-t border-white/10 pt-5 text-xs text-zinc-600">
          Testnet only · Amounts are test MON with no real value · Vault {shortAddress(vaultAddress)}
        </footer>
      </div>
    </main>
  );
}

function AttemptRow({ record }: { record: HistoryRecord }) {
  const { envelope } = record;
  const amountWei = BigInt(envelope.amountWei);
  const source: Source | undefined = envelope.source && {
    providerLabel: envelope.source.provider,
    model: envelope.source.model,
    prompt: envelope.source.prompt,
    memo: envelope.source.memo,
    recipientName: envelope.source.recipientName,
    part: envelope.source.part,
  };
  const badge = {
    paid: { text: "Paid", style: "bg-lime-300/15 text-lime-200" },
    "reverted-onchain": { text: "Blocked onchain", style: "bg-rose-300/15 text-rose-200" },
    "refused-not-sent": { text: "Refused, not sent", style: "bg-amber-300/15 text-amber-200" },
    failed: { text: "Not completed", style: "bg-white/10 text-zinc-300" },
  }[record.outcome];

  return (
    <li className="rounded-2xl border border-white/10 bg-[#101419] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-sm text-white">
          {formatEther(amountWei)} MON → {source?.recipientName ?? shortAddress(envelope.recipient)}
        </p>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${badge.style}`}>{badge.text}</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-zinc-400">{record.note}</p>
      {source && <SourceLine source={source} />}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-zinc-500">
        <span>{new Date(record.at).toLocaleString()}</span>
        <span>request {shortAddress(record.requestId)}</span>
        {record.policyVersion !== undefined && <span>policy v{record.policyVersion}</span>}
        {record.dayIndex !== undefined && <span>UTC day {utcDate(BigInt(record.dayIndex))}</span>}
        {record.hash && (
          <Link
            className="text-lime-200 underline underline-offset-4"
            href={`/receipt/${record.hash}#e=${encodeEnvelope(envelope)}`}
          >
            receipt →
          </Link>
        )}
        {record.hash && (
          <a
            className="text-zinc-400 underline underline-offset-4"
            href={`${MONAD_TESTNET_EXPLORER_URL}/tx/${record.hash}`}
            rel="noreferrer"
            target="_blank"
          >
            tx {shortAddress(record.hash)} ↗
          </a>
        )}
      </div>
    </li>
  );
}

/** Names live only in this browser. Approval is still read from the vault. */
function AddressBookEditor({ agentId, book }: { agentId: bigint; book: BookEntry[] }) {
  return (
    <details className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3" open={book.every((entry) => !entry.name)}>
      <summary className="cursor-pointer text-xs font-semibold text-zinc-300">
        Address book ({book.filter((entry) => entry.name).length} of {book.length} named)
      </summary>
      <ul className="mt-3 space-y-2">
        {book.map((entry) => (
          <li className="flex flex-wrap items-center gap-2" key={entry.address}>
            <input
              aria-label={`Name for ${entry.address}`}
              className="w-32 rounded-lg border border-white/20 bg-black/30 px-2 py-1.5 text-xs text-white outline-none placeholder:text-zinc-500 focus:border-cyan-300/60"
              defaultValue={entry.name}
              key={entry.name}
              maxLength={40}
              onBlur={(event) => {
                if (event.target.value.trim() !== entry.name) setRecipientName(agentId, entry.address, event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              placeholder="Name, e.g. Shop"
            />
            <span className="font-mono text-[11px] text-zinc-400">{shortAddress(entry.address)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] leading-4 text-zinc-500">
        Type a name and press Enter. Naming does not approve anyone; only the owner can approve recipients onchain.
      </p>
    </details>
  );
}

function SourceLine({ source }: { source: Source }) {
  return (
    <p className="mt-2 text-[11px] leading-4 text-zinc-500">
      Requested in plain language via {source.providerLabel} ({source.model}, declared): &ldquo;{source.prompt}&rdquo;
      {source.memo ? ` · memo: ${source.memo}` : ""}
      {source.part ? ` · payment ${source.part}` : ""}
    </p>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="font-mono text-zinc-200">{value}</dd>
    </div>
  );
}

function Notice({ tone, children }: { tone: "info" | "warning" | "error"; children: React.ReactNode }) {
  const styles = {
    info: "border-cyan-300/20 bg-cyan-300/10 text-cyan-100",
    warning: "border-amber-300/20 bg-amber-300/10 text-amber-100",
    error: "border-rose-300/20 bg-rose-300/10 text-rose-100",
  }[tone];
  return <div className={`mt-5 rounded-2xl border p-4 text-sm leading-6 ${styles}`}>{children}</div>;
}

function BatchCard({
  items,
  busy,
  isSending,
  onSend,
  onDiscard,
}: {
  items: BatchItem[];
  busy: boolean;
  isSending: boolean;
  onSend: () => void;
  onDiscard: () => void;
}) {
  const sendable = items.filter((item) => item.state === "ready");
  const finished = items.every((item) => item.state !== "ready" && item.state !== "sending");
  const started = items.some((item) => ["sending", "paid", "blocked", "failed", "skipped"].includes(item.state));
  const label: Record<BatchState, { text: string; style: string }> = {
    ready: { text: "Vault would allow", style: "bg-lime-300/15 text-lime-200" },
    refused: { text: "Vault would refuse", style: "bg-rose-300/15 text-rose-200" },
    sending: { text: "Confirm in MetaMask…", style: "bg-cyan-300/15 text-cyan-100" },
    paid: { text: "Paid", style: "bg-lime-300/15 text-lime-200" },
    blocked: { text: "Blocked onchain", style: "bg-rose-300/15 text-rose-200" },
    failed: { text: "Not completed", style: "bg-white/10 text-zinc-300" },
    skipped: { text: "Not sent (stopped)", style: "bg-white/10 text-zinc-400" },
  };
  return (
    <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="text-sm font-semibold text-white">
        {items.length} payments from one request
      </p>
      <p className="mt-1 text-xs leading-5 text-zinc-400">
        Each payment is its own transaction, checked by the vault on its own. MetaMask asks once per payment.
        If one fails, the rest are not sent.
      </p>
      <ol className="mt-3 space-y-2">
        {items.map((item, index) => (
          <li className="rounded-xl border border-white/10 bg-[#0c1014] p-3 text-xs" key={item.requestId}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-white">
                {index + 1}. {formatEther(item.amountWei)} MON → {item.source?.recipientName ?? shortAddress(item.recipient)}
                {item.source?.memo ? <span className="font-sans text-zinc-400"> · {item.source.memo}</span> : null}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${label[item.state].style}`}>
                {label[item.state].text}
              </span>
            </div>
            {item.reason && item.state === "refused" && <p className="mt-1 text-rose-100/80">{item.reason}</p>}
          </li>
        ))}
      </ol>
      {!finished || !started ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button
            className="rounded-xl border border-white/15 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-40"
            disabled={busy}
            onClick={onDiscard}
          >
            Don&apos;t send
          </button>
          <button
            className="rounded-xl bg-lime-300 px-4 py-3 text-sm font-bold text-zinc-950 hover:bg-lime-200 disabled:opacity-40"
            disabled={busy || sendable.length === 0}
            onClick={onSend}
          >
            {isSending ? "Sending…" : `Send ${sendable.length} allowed payment${sendable.length === 1 ? "" : "s"}`}
          </button>
        </div>
      ) : (
        <button
          className="mt-4 w-full rounded-xl border border-white/15 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white hover:bg-white/10"
          onClick={onDiscard}
        >
          Done
        </button>
      )}
    </div>
  );
}
