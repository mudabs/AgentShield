"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useAccount,
  useConnect,
  useDisconnect,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import {
  formatEther,
  getAddress,
  isAddress,
  keccak256,
  parseEventLogs,
  stringToHex,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { MONAD_TESTNET_CHAIN_ID, MONAD_TESTNET_EXPLORER_URL } from "@/lib/monad";
import { registryAbi, registryAddress, vaultAbi, vaultAddress } from "@/lib/guard";
import { describeError } from "@/lib/errors";
import { OwnerControls } from "./owner-controls";

// The registry has no "list agents by owner" function, so the page scans the most
// recent agent IDs and keeps the ones owned by the connected wallet. This is fine
// at hackathon scale; an event indexer replaces it later.
const MAX_AGENTS_SCANNED = 200;
const LABELS_STORAGE_KEY = "agentshield.agentLabels";

type OwnedAgent = {
  id: bigint;
  owner: Address;
  authorizedSigner: Address;
  active: boolean;
  metadataHash: Hex;
};

function shortAddress(value?: string) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—";
}

/** Checks the agent signer address before anything is sent to the wallet. */
function validateSigner(input: string, owner?: Address): string | undefined {
  const value = input.trim();
  if (!value) return "Enter the address of the account the agent will sign with.";
  if (!isAddress(value)) {
    return "That is not a valid address. Copy it again from MetaMask and check for typos.";
  }
  if (getAddress(value) === zeroAddress) return "The zero address cannot sign transactions.";
  if (owner && getAddress(value) === getAddress(owner)) {
    return "Use a different account for the agent. If the owner and the agent are the same account, the agent could change its own limits.";
  }
  return undefined;
}

async function loadOwnedAgents(
  client: PublicClient,
  registry: Address,
  owner: Address,
): Promise<OwnedAgent[]> {
  const nextAgentId = await client.readContract({
    address: registry,
    abi: registryAbi,
    functionName: "nextAgentId",
  });
  const lastId = nextAgentId - BigInt(1);
  const firstId = lastId > BigInt(MAX_AGENTS_SCANNED) ? lastId - BigInt(MAX_AGENTS_SCANNED - 1) : BigInt(1);

  const ids: bigint[] = [];
  for (let id = lastId; id >= firstId; id -= BigInt(1)) ids.push(id);

  const agents = await Promise.all(
    ids.map(async (id) => {
      const agent = await client.readContract({
        address: registry,
        abi: registryAbi,
        functionName: "getAgent",
        args: [id],
      });
      return { id, ...agent };
    }),
  );
  return agents.filter((agent) => agent.owner.toLowerCase() === owner.toLowerCase());
}

// Agent labels are a convenience for this browser only. Onchain, the registry
// stores just a hash of the label, so the label itself never becomes public.
const labelListeners = new Set<() => void>();

function readLabelsRaw(): string {
  try {
    return window.localStorage.getItem(LABELS_STORAGE_KEY) ?? "{}";
  } catch {
    return "{}";
  }
}

function saveLabel(agentId: bigint, label: string) {
  try {
    const labels = JSON.parse(readLabelsRaw()) as Record<string, string>;
    labels[agentId.toString()] = label;
    window.localStorage.setItem(LABELS_STORAGE_KEY, JSON.stringify(labels));
  } catch {
    // Storage can be unavailable (private windows, blocked site data). Labels are optional.
  }
  labelListeners.forEach((notify) => notify());
}

function useAgentLabels(): Record<string, string> {
  const raw = useSyncExternalStore(
    (notify) => {
      labelListeners.add(notify);
      return () => labelListeners.delete(notify);
    },
    readLabelsRaw,
    () => "{}",
  );
  return useMemo(() => {
    try {
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      return {};
    }
  }, [raw]);
}

export default function AgentSetupPage() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: MONAD_TESTNET_CHAIN_ID });
  const labels = useAgentLabels();

  const isOnMonadTestnet = chainId === MONAD_TESTNET_CHAIN_ID;
  const contractsConfigured = Boolean(registryAddress && vaultAddress);
  const activeConnector = connectors[0];

  const [label, setLabel] = useState("");
  const [signerInput, setSignerInput] = useState("");
  const [signerTouched, setSignerTouched] = useState(false);
  const [chosenAgentId, setChosenAgentId] = useState<bigint>();
  const [pendingLabel, setPendingLabel] = useState("");

  const signerError = validateSigner(signerInput, address);

  const {
    data: createHash,
    error: createError,
    isPending: isAwaitingWallet,
    writeContract,
  } = useWriteContract();
  const {
    data: createReceipt,
    error: receiptError,
    isLoading: isConfirming,
  } = useWaitForTransactionReceipt({
    chainId: MONAD_TESTNET_CHAIN_ID,
    hash: createHash,
    query: { enabled: Boolean(createHash) },
  });

  const createdAgentId = useMemo(() => {
    if (!createReceipt || createReceipt.status !== "success" || !registryAddress) return undefined;
    const [created] = parseEventLogs({
      abi: registryAbi,
      eventName: "AgentCreated",
      logs: createReceipt.logs.filter(
        (log) => log.address.toLowerCase() === registryAddress!.toLowerCase(),
      ),
    });
    return created?.args.agentId;
  }, [createReceipt]);

  // Persist the label once the chain has confirmed which ID the agent received.
  useEffect(() => {
    if (createdAgentId !== undefined && pendingLabel) saveLabel(createdAgentId, pendingLabel);
  }, [createdAgentId, pendingLabel]);

  const agentsQuery = useQuery({
    // Including the receipt hash refetches the list as soon as a new agent is confirmed.
    queryKey: ["owned-agents", registryAddress, address, createReceipt?.transactionHash],
    enabled: Boolean(publicClient && registryAddress && address),
    queryFn: () => loadOwnedAgents(publicClient!, registryAddress!, address!),
  });

  const agents = agentsQuery.data ?? [];
  const selectedAgentId = chosenAgentId ?? createdAgentId ?? agents[0]?.id;

  const canSubmit =
    isConnected &&
    isOnMonadTestnet &&
    contractsConfigured &&
    !signerError &&
    !isAwaitingWallet &&
    !isConfirming;

  const handleCreate = () => {
    setSignerTouched(true);
    if (!canSubmit || !registryAddress) return;
    const trimmedLabel = label.trim();
    setChosenAgentId(undefined);
    setPendingLabel(trimmedLabel);
    writeContract({
      address: registryAddress,
      abi: registryAbi,
      functionName: "createAgent",
      args: [
        getAddress(signerInput.trim()),
        trimmedLabel ? keccak256(stringToHex(trimmedLabel)) : zeroHash,
      ],
      chainId: MONAD_TESTNET_CHAIN_ID,
    });
  };

  const createStatus = createError
    ? { tone: "error" as const, text: describeError(createError) }
    : receiptError
      ? { tone: "error" as const, text: `Could not confirm the transaction: ${describeError(receiptError)}` }
      : isAwaitingWallet
        ? { tone: "info" as const, text: "Confirm the transaction in MetaMask…" }
        : isConfirming
          ? { tone: "info" as const, text: "Submitted. Waiting for Monad to confirm it…" }
          : createReceipt?.status === "reverted"
            ? { tone: "error" as const, text: "The transaction was mined but reverted. No agent was created." }
            : createdAgentId !== undefined
              ? { tone: "success" as const, text: `Confirmed. Agent #${createdAgentId.toString()} now exists onchain.` }
              : undefined;

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
              <p className="text-xs text-zinc-500">Agent setup</p>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-zinc-300 sm:inline">
              {isConnected ? (isOnMonadTestnet ? "Monad Testnet" : `Wrong network (chain ${chainId})`) : "Not connected"}
            </span>
            {isConnected ? (
              <button
                className="rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/10"
                onClick={() => disconnect()}
              >
                {shortAddress(address)}
              </button>
            ) : (
              <button
                className="rounded-full bg-lime-300 px-4 py-2 text-xs font-bold text-zinc-950 transition hover:bg-lime-200 disabled:cursor-wait disabled:opacity-60"
                disabled={isConnecting || !activeConnector}
                onClick={() => activeConnector && connect({ connector: activeConnector })}
              >
                {isConnecting ? "Connecting…" : "Connect wallet"}
              </button>
            )}
          </div>
        </header>

        <section className="py-10 lg:py-14">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-lime-200/70">Step 1 of the guarded flow</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
            Register an agent you control.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-400">
            You are the owner: only you can set the agent&apos;s limits, fund it, or pause it. The agent
            gets its own signer account, which can only request payments that the vault allows.
          </p>
        </section>

        {!contractsConfigured && (
          <Notice tone="warning">
            Registry and vault addresses are missing. Set <code>NEXT_PUBLIC_REGISTRY_CONTRACT_ADDRESS</code> and{" "}
            <code>NEXT_PUBLIC_VAULT_CONTRACT_ADDRESS</code> in <code>.env</code>, then restart <code>npm run dev</code>.
          </Notice>
        )}
        {isConnected && !isOnMonadTestnet && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4 text-sm text-cyan-100">
            <span>Your wallet is on chain {chainId}. AgentShield runs on Monad Testnet (chain {MONAD_TESTNET_CHAIN_ID}).</span>
            <button
              className="rounded-xl bg-cyan-300 px-4 py-2 text-xs font-bold text-zinc-950 hover:bg-cyan-200 disabled:opacity-60"
              disabled={isSwitching}
              onClick={() => switchChain({ chainId: MONAD_TESTNET_CHAIN_ID })}
            >
              {isSwitching ? "Requesting switch…" : "Switch to Monad Testnet"}
            </button>
          </div>
        )}

        <section className="grid gap-5 pb-10 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-3xl border border-white/10 bg-[#101419] p-6 sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Create agent</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">New agent</h2>

            <label className="mt-6 block">
              <span className="text-xs text-zinc-400">Owner (you)</span>
              <p className="mt-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 font-mono text-sm text-zinc-300">
                {address ?? "Connect your wallet"}
              </p>
            </label>

            <label className="mt-4 block">
              <span className="text-xs text-zinc-400">Agent signer address</span>
              <input
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 font-mono text-sm text-white outline-none placeholder:text-zinc-600 focus:border-lime-300/50"
                onBlur={() => setSignerTouched(true)}
                onChange={(event) => setSignerInput(event.target.value)}
                placeholder="0x… (your AgentShield Agent account)"
                spellCheck={false}
                value={signerInput}
              />
              {signerTouched && signerError && <p className="mt-2 text-xs leading-5 text-rose-300">{signerError}</p>}
            </label>

            <label className="mt-4 block">
              <span className="text-xs text-zinc-400">Label (optional, kept in this browser)</span>
              <input
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-lime-300/50"
                maxLength={60}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="e.g. Shopping assistant"
                value={label}
              />
              <p className="mt-2 text-xs leading-5 text-zinc-500">
                Onchain data is public, so only a hash of the label is recorded.
              </p>
            </label>

            {createStatus && (
              <Notice tone={createStatus.tone}>
                {createStatus.text}
                {createHash && (
                  <a
                    className="ml-2 underline underline-offset-4"
                    href={`${MONAD_TESTNET_EXPLORER_URL}/tx/${createHash}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    View transaction ↗
                  </a>
                )}
              </Notice>
            )}

            <button
              className="mt-5 w-full rounded-xl bg-lime-300 px-4 py-3 text-sm font-bold text-zinc-950 transition hover:bg-lime-200 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canSubmit}
              onClick={handleCreate}
            >
              {isAwaitingWallet ? "Waiting for wallet…" : isConfirming ? "Confirming onchain…" : "Create agent onchain"}
            </button>
          </div>

          <div className="rounded-3xl border border-white/10 bg-[#101419] p-6 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Your agents</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">Registered onchain</h2>
              </div>
              {agentsQuery.isFetching && <span className="text-xs text-zinc-500">Loading…</span>}
            </div>

            {!isConnected ? (
              <p className="mt-6 text-sm text-zinc-500">Connect your wallet to see the agents you own.</p>
            ) : agentsQuery.error ? (
              <Notice tone="error">Could not read the registry: {describeError(agentsQuery.error)}</Notice>
            ) : agentsQuery.isSuccess && agents.length === 0 ? (
              <p className="mt-6 text-sm leading-6 text-zinc-500">
                No agents yet. Create one on the left; it will appear here once Monad confirms it.
              </p>
            ) : (
              <div className="mt-6 flex flex-wrap gap-2">
                {agents.map((agent) => (
                  <button
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      agent.id === selectedAgentId
                        ? "border-lime-300 bg-lime-300 text-zinc-950"
                        : "border-white/15 bg-white/[0.04] text-zinc-300 hover:bg-white/10"
                    }`}
                    key={agent.id.toString()}
                    onClick={() => setChosenAgentId(agent.id)}
                  >
                    #{agent.id.toString()}
                    {labels[agent.id.toString()] ? ` · ${labels[agent.id.toString()]}` : ""}
                  </button>
                ))}
              </div>
            )}

            {selectedAgentId !== undefined && isConnected && (
              <AgentDetails agentId={selectedAgentId} label={labels[selectedAgentId.toString()]} owner={address} />
            )}
          </div>
        </section>

        {selectedAgentId !== undefined && isConnected && contractsConfigured && (
          <OwnerControls agentId={selectedAgentId} canWrite={isOnMonadTestnet} />
        )}

        <footer className="border-t border-white/10 pt-5 text-xs text-zinc-600">
          Testnet only · Amounts are test MON with no real value · Registry {shortAddress(registryAddress)} · Vault{" "}
          {shortAddress(vaultAddress)}
        </footer>
      </div>
    </main>
  );
}

function AgentDetails({ agentId, label, owner }: { agentId: bigint; label?: string; owner?: Address }) {
  const { data: agent } = useReadContract({
    address: registryAddress,
    abi: registryAbi,
    functionName: "getAgent",
    args: [agentId],
    chainId: MONAD_TESTNET_CHAIN_ID,
    query: { enabled: Boolean(registryAddress) },
  });
  const { data: balance } = useReadContract({
    address: vaultAddress,
    abi: vaultAbi,
    functionName: "vaultBalance",
    args: [agentId],
    chainId: MONAD_TESTNET_CHAIN_ID,
    query: { enabled: Boolean(vaultAddress) },
  });
  const { data: policy } = useReadContract({
    address: vaultAddress,
    abi: vaultAbi,
    functionName: "getPolicy",
    args: [agentId],
    chainId: MONAD_TESTNET_CHAIN_ID,
    query: { enabled: Boolean(vaultAddress) },
  });

  const [perPaymentLimit, dailyLimit, spentToday, , policyVersion, paused] = policy ?? [];
  const hasPolicy = perPaymentLimit !== undefined && perPaymentLimit > BigInt(0);
  const isOwner = agent && owner && agent.owner.toLowerCase() === owner.toLowerCase();

  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-white">
          Agent #{agentId.toString()}
          {label ? ` · ${label}` : ""}
        </p>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
            agent?.active ? "bg-lime-300/15 text-lime-200" : "bg-white/10 text-zinc-400"
          }`}
        >
          {agent === undefined ? "Loading…" : agent.active ? "Active" : "Inactive"}
        </span>
      </div>

      <dl className="mt-4 space-y-2.5 text-xs">
        <Row label="Owner" value={agent ? `${shortAddress(agent.owner)}${isOwner ? " (you)" : ""}` : "—"} />
        <Row label="Agent signer" value={agent ? shortAddress(agent.authorizedSigner) : "—"} />
        <Row label="Vault balance" value={balance === undefined ? "—" : `${formatEther(balance)} test MON`} />
        <Row
          label="Per-payment limit"
          value={hasPolicy ? `${formatEther(perPaymentLimit)} MON` : "Not set"}
        />
        <Row label="Daily limit" value={hasPolicy && dailyLimit !== undefined ? `${formatEther(dailyLimit)} MON` : "Not set"} />
        <Row
          label="Spent today (UTC)"
          value={spentToday === undefined ? "—" : `${formatEther(spentToday)} MON`}
        />
        <Row label="Paused" value={paused === undefined ? "—" : paused ? "Yes" : "No"} />
        <Row label="Policy version" value={policyVersion === undefined ? "—" : policyVersion.toString()} />
      </dl>

      {policy !== undefined && !hasPolicy && (
        <p className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-xs leading-5 text-amber-100">
          No spending policy yet. Until you set limits and approve recipients, the vault refuses every payment
          from this agent. That is the safe default.
        </p>
      )}
    </div>
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

function Notice({ tone, children }: { tone: "info" | "success" | "warning" | "error"; children: React.ReactNode }) {
  const styles = {
    info: "border-cyan-300/20 bg-cyan-300/10 text-cyan-100",
    success: "border-lime-300/20 bg-lime-300/10 text-lime-100",
    warning: "border-amber-300/20 bg-amber-300/10 text-amber-100",
    error: "border-rose-300/20 bg-rose-300/10 text-rose-100",
  }[tone];
  return <div className={`mt-5 rounded-2xl border p-4 text-sm leading-6 ${styles}`}>{children}</div>;
}
