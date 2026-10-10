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
  toHex,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { MONAD_TESTNET_CHAIN_ID, MONAD_TESTNET_EXPLORER_URL } from "@/lib/monad";
import { registryAddress, vaultAbi, vaultAddress } from "@/lib/guard";
import { loadAgents, sameAddress } from "@/lib/agents";
import { parseMonAmount } from "@/lib/amounts";
import { describeError } from "@/lib/errors";
import { useAddressBook } from "@/lib/recipients";

// A payment that the vault refuses reverts very early, so a fixed gas limit is
// plenty. It lets the "submit anyway" path reach the chain even though the
// wallet's own gas estimate would fail. (Monad charges by gas limit.)
const FORCED_SUBMIT_GAS = BigInt(150_000);
const LOW_GAS_WARNING = parseEther("0.02");

/** Declared AI context for a request: what was typed and which model interpreted it. */
type Source = { providerLabel: string; model: string; prompt: string; memo?: string; recipientName?: string };
type Request = { requestId: Hex; recipient: Address; amountWei: bigint; source?: Source };

type ProviderInfo = { id: string; label: string; model: string; configured: boolean };
type Interpretation =
  | {
      ok: true;
      intent: { recipient: Address; amountWei: string; memo?: string };
      recipientName?: string;
      providerLabel: string;
      model: string;
      latencyMs: number;
      prompt: string;
    }
  | { ok: false; message: string; providerLabel?: string; model?: string; rawOutput?: string };
type Preview = Request & ({ verdict: "allowed" } | { verdict: "refused"; reason: string });

type Attempt = Request & {
  outcome: "paid" | "refused-not-sent" | "reverted-onchain" | "failed";
  hash?: Hash;
  note: string;
  policyVersion?: bigint;
  dayIndex?: bigint;
};

function shortAddress(value?: string) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—";
}

/** A fresh, random 32-byte ID for each request so the vault can reject duplicates. */
function newRequestId(): Hex {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
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

  const [chosenAgentId, setChosenAgentId] = useState<bigint>();
  const [recipientInput, setRecipientInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [isConfirming, setIsConfirming] = useState(false);
  const [attempts, setAttempts] = useState<Attempt[]>([]);

  // Agents whose authorized signer is the connected account.
  const agentsQuery = useQuery({
    queryKey: ["signer-agents", registryAddress, address],
    enabled: Boolean(publicClient && registryAddress && address),
    queryFn: () =>
      loadAgents(publicClient!, registryAddress!, (agent) => sameAddress(agent.authorizedSigner, address)),
  });
  const agents = agentsQuery.data ?? [];
  const agentId = chosenAgentId ?? agents[0]?.id;
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

  const recordAttempt = (attempt: Attempt) => setAttempts((previous) => [attempt, ...previous]);

  const amount = parseMonAmount(amountInput);
  const recipientValid = isAddress(recipientInput.trim());
  const busy = isChecking || isAwaitingWallet || isConfirming;
  const canPreview = isConnected && isOnMonadTestnet && agentId !== undefined && !busy;
  const canCheck = canPreview && recipientValid && amount.ok;

  const clearPreview = () => setPreview(undefined);

  /** Step 1: ask the vault, without sending anything, whether it would allow this payment. */
  const runCheck = async (recipient: Address, amountWei: bigint, source?: Source) => {
    if (!canPreview || !publicClient || !vaultAddress || !address || agentId === undefined) return;
    const request: Request = { requestId: newRequestId(), recipient, amountWei, source };
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
        setInterpretation({ ...(result as Omit<Extract<Interpretation, { ok: true }>, "prompt">), ok: true, prompt });
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

  /** Hands the validated AI proposal to the exact same vault check as a manual request. */
  const applyInterpretation = () => {
    if (!interpretation?.ok) return;
    const { intent } = interpretation;
    const amountWei = BigInt(intent.amountWei);
    setRecipientInput(intent.recipient);
    setAmountInput(formatEther(amountWei));
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
  const submit = async (forceOnchain: boolean) => {
    if (!preview || !vaultAddress || !publicClient || !address || agentId === undefined) return;
    const request = preview;
    const args = [agentId, request.requestId, request.recipient, request.amountWei] as const;

    let hash: Hash;
    try {
      hash = await writeContractAsync({
        address: vaultAddress,
        abi: vaultAbi,
        functionName: "executePayment",
        args,
        chainId: MONAD_TESTNET_CHAIN_ID,
        ...(forceOnchain ? { gas: FORCED_SUBMIT_GAS } : {}),
      });
    } catch (error) {
      recordAttempt({ ...request, outcome: "failed", note: `Nothing was sent. ${describeError(error as Error)}` });
      setPreview(undefined);
      return;
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
        reason ??= request.verdict === "refused" ? `${request.reason} (from the preview)` : "reason unavailable";
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
      setPreview(undefined);
      void refetchPolicy();
      void refetchVaultBalance();
      void refetchGasBalance();
    }
  };

  const declineToSend = () => {
    if (preview?.verdict !== "refused") return;
    recordAttempt({ ...preview, outcome: "refused-not-sent", note: `Not sent. ${preview.reason}` });
    setPreview(undefined);
  };

  const [perPaymentLimit, dailyLimit, spentToday, , policyVersion, paused] = policy ?? [];
  const remainingToday =
    dailyLimit !== undefined && spentToday !== undefined && dailyLimit > spentToday
      ? dailyLimit - spentToday
      : BigInt(0);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#080a0d] text-zinc-100">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-60" />
      <div className="relative mx-auto w-full max-w-6xl px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-6">
          <Link className="flex items-center gap-3" href="/">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-lime-300 text-lg font-black text-zinc-950">
              A
            </div>
            <div>
              <p className="text-sm font-semibold tracking-wide text-white">AgentShield</p>
              <p className="text-xs text-zinc-500">Agent console</p>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <Link className="text-xs text-zinc-400 underline-offset-4 hover:underline" href="/agent">
              Owner setup
            </Link>
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
          <Notice tone="info">Connect MetaMask using the agent&apos;s signer account (AgentShield Agent).</Notice>
        ) : agentsQuery.isLoading ? (
          <Notice tone="info">Looking up agents that this account signs for…</Notice>
        ) : agentsQuery.error ? (
          <Notice tone="error">Could not read the registry: {describeError(agentsQuery.error)}</Notice>
        ) : agents.length === 0 ? (
          <Notice tone="warning">
            {shortAddress(address)} is not the signer for any agent. In MetaMask, switch to the AgentShield
            Agent account for this site. If you are the owner, that is expected: the owner cannot use the
            agent&apos;s payment path.
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
                        setChosenAgentId(candidate.id);
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
                    : "Name your recipients on the Owner setup page so the AI can refer to them."}
                </p>
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
                    <p className="text-zinc-300">
                      <span className="font-semibold text-white">
                        {interpretation.providerLabel} ({interpretation.model})
                      </span>{" "}
                      understood: pay <span className="font-mono text-white">{formatEther(BigInt(interpretation.intent.amountWei))} MON</span> to{" "}
                      <span className="text-white">{interpretation.recipientName ?? "an address you typed"}</span>{" "}
                      <span className="font-mono text-zinc-400">({shortAddress(interpretation.intent.recipient)})</span>
                      {interpretation.intent.memo ? ` for "${interpretation.intent.memo}"` : ""}.
                    </p>
                    <p className="mt-1 text-zinc-500">
                      Checked by AgentShield: valid address from your address book or your own text, valid amount.
                      The vault still decides. ({interpretation.latencyMs} ms)
                    </p>
                    <button
                      className="mt-3 w-full rounded-lg bg-lime-300 px-3 py-2 text-xs font-bold text-zinc-950 hover:bg-lime-200 disabled:opacity-40"
                      disabled={!canPreview}
                      onClick={applyInterpretation}
                    >
                      Check this request with the vault
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

        {attempts.length > 0 && (
          <section className="pb-10">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">This session</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Attempts</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Kept in this page only. Successful payments are also recorded onchain as PaymentExecuted events;
              refused requests leave no onchain record.
            </p>
            <ul className="mt-4 space-y-3">
              {attempts.map((attempt, index) => (
                <AttemptRow attempt={attempt} key={`${attempts.length - index}-${attempt.requestId}`} />
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

function AttemptRow({ attempt }: { attempt: Attempt }) {
  const badge = {
    paid: { text: "Paid", style: "bg-lime-300/15 text-lime-200" },
    "reverted-onchain": { text: "Blocked onchain", style: "bg-rose-300/15 text-rose-200" },
    "refused-not-sent": { text: "Refused, not sent", style: "bg-amber-300/15 text-amber-200" },
    failed: { text: "Not completed", style: "bg-white/10 text-zinc-300" },
  }[attempt.outcome];

  return (
    <li className="rounded-2xl border border-white/10 bg-[#101419] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-sm text-white">
          {formatEther(attempt.amountWei)} MON → {shortAddress(attempt.recipient)}
        </p>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${badge.style}`}>{badge.text}</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-zinc-400">{attempt.note}</p>
      {attempt.source && <SourceLine source={attempt.source} />}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-zinc-500">
        <span>request {shortAddress(attempt.requestId)}</span>
        {attempt.policyVersion !== undefined && <span>policy v{attempt.policyVersion.toString()}</span>}
        {attempt.dayIndex !== undefined && <span>UTC day {utcDate(attempt.dayIndex)}</span>}
        {attempt.hash && (
          <a
            className="text-lime-200 underline underline-offset-4"
            href={`${MONAD_TESTNET_EXPLORER_URL}/tx/${attempt.hash}`}
            rel="noreferrer"
            target="_blank"
          >
            tx {shortAddress(attempt.hash)} ↗
          </a>
        )}
      </div>
    </li>
  );
}

function SourceLine({ source }: { source: Source }) {
  return (
    <p className="mt-2 text-[11px] leading-4 text-zinc-500">
      Requested in plain language via {source.providerLabel} ({source.model}, declared): &ldquo;{source.prompt}&rdquo;
      {source.memo ? ` · memo: ${source.memo}` : ""}
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
