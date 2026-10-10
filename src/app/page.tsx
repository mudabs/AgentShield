"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  useAccount,
  useBalance,
  useConnect,
  useDisconnect,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { formatEther } from "viem";
import {
  MONAD_TESTNET_CHAIN_ID,
  MONAD_TESTNET_EXPLORER_URL,
} from "@/lib/monad";
import { probeAbi, probeContractAddress } from "@/lib/probe";

function shortAddress(address?: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Not connected";
}

function parseMarker(value: string) {
  if (!/^\d+$/.test(value.trim())) return undefined;
  return BigInt(value);
}

export default function Home() {
  const [nextMarker, setNextMarker] = useState("1");
  // Read the chain from the connected wallet itself. useChainId() only reports
  // chains listed in the wagmi config, so it can claim Monad Testnet while the
  // wallet is actually on another network such as Ethereum Mainnet.
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, error: connectError, isPending: isConnecting } =
    useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { data: balance } = useBalance({
    address,
    chainId: MONAD_TESTNET_CHAIN_ID,
    query: { enabled: Boolean(address) },
  });
  const isOnMonadTestnet = chainId === MONAD_TESTNET_CHAIN_ID;
  const isProbeConfigured = Boolean(probeContractAddress);
  const { data: marker, refetch: refetchMarker } = useReadContract({
    address: probeContractAddress,
    abi: probeAbi,
    functionName: "marker",
    chainId: MONAD_TESTNET_CHAIN_ID,
    query: { enabled: isProbeConfigured },
  });
  const {
    data: transactionHash,
    error: writeError,
    isPending: isWriting,
    writeContract,
  } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({
      chainId: MONAD_TESTNET_CHAIN_ID,
      hash: transactionHash,
      query: { enabled: Boolean(transactionHash) },
    });
  const parsedMarker = useMemo(() => parseMarker(nextMarker), [nextMarker]);
  const activeConnector = connectors[0];

  const handleProbeWrite = () => {
    if (!probeContractAddress || parsedMarker === undefined || !isOnMonadTestnet) {
      return;
    }

    writeContract(
      {
        address: probeContractAddress,
        abi: probeAbi,
        functionName: "setMarker",
        args: [parsedMarker],
        chainId: MONAD_TESTNET_CHAIN_ID,
      },
      {
        onSuccess: () => {
          window.setTimeout(() => void refetchMarker(), 1500);
        },
      },
    );
  };

  const connectionLabel = isConnected
    ? shortAddress(address)
    : isConnecting
      ? "Connecting…"
      : "Connect wallet";

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#080a0d] text-zinc-100">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-60" />
      <div className="pointer-events-none absolute -left-32 top-20 h-96 w-96 rounded-full bg-lime-400/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-40 bottom-0 h-[32rem] w-[32rem] rounded-full bg-cyan-400/10 blur-3xl" />

      <div className="relative mx-auto w-full max-w-7xl px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
        <header className="flex items-center justify-between border-b border-white/10 pb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-lime-300 text-lg font-black text-zinc-950">
              A
            </div>
            <div>
              <p className="text-sm font-semibold tracking-wide text-white">AgentShield</p>
              <p className="text-xs text-zinc-500">Trust layer for agent payments</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-zinc-300 sm:flex">
              <span className="h-2 w-2 rounded-full bg-lime-300" />
              Monad Testnet
            </div>
            {isConnected ? (
              <button
                className="rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/10"
                onClick={() => disconnect()}
              >
                {connectionLabel}
              </button>
            ) : (
              <button
                className="rounded-full bg-lime-300 px-4 py-2 text-xs font-bold text-zinc-950 transition hover:bg-lime-200 disabled:cursor-wait disabled:opacity-60"
                disabled={isConnecting || !activeConnector}
                onClick={() => activeConnector && connect({ connector: activeConnector })}
              >
                {connectionLabel}
              </button>
            )}
          </div>
        </header>

        <section className="grid gap-12 py-16 lg:grid-cols-[1.1fr_0.9fr] lg:items-end lg:py-24">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-lime-200">
              <span className="h-1.5 w-1.5 rounded-full bg-lime-300" />
              First working slice
            </div>
            <h1 className="max-w-3xl text-5xl font-semibold leading-[0.98] tracking-[-0.06em] text-white sm:text-7xl">
              Agents should not get a blank cheque.
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-zinc-400">
              AgentShield is building the policy boundary between an AI agent&apos;s
              intent and a real onchain payment. Today we prove the wallet and
              Monad connection with a tiny live contract probe.
            </p>
          </div>

          <div className="panel-shadow rounded-3xl border border-white/10 bg-white/[0.055] p-6 backdrop-blur-xl sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  Execution path
                </p>
                <h2 className="mt-2 text-xl font-semibold text-white">Trust boundary status</h2>
              </div>
              <div className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-[11px] font-semibold text-amber-200">
                Probe mode
              </div>
            </div>
            <div className="mt-7 space-y-4">
              <StatusRow
                label="Wallet signer"
                value={isConnected ? shortAddress(address) : "Waiting for connection"}
                complete={isConnected}
              />
              <StatusRow
                label="Required network"
                value={isOnMonadTestnet ? "Monad Testnet selected" : "Switch required"}
                complete={isConnected && isOnMonadTestnet}
              />
              <StatusRow
                label="Contract authority"
                value={isProbeConfigured ? "Probe address configured" : "Deploy a probe first"}
                complete={isProbeConfigured}
                last
              />
            </div>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-3xl border border-white/10 bg-[#101419] p-6 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  01 / network
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-white">Wallet &amp; chain</h2>
              </div>
              <span className="rounded-full bg-cyan-300/10 px-3 py-1 text-xs font-medium text-cyan-200">
                {chainId ? `Chain ${chainId}` : "No chain"}
              </span>
            </div>
            <p className="mt-4 text-sm leading-6 text-zinc-400">
              Connect an injected wallet such as MetaMask. The app never receives
              the private key; it asks the wallet to sign a transaction.
            </p>
            <div className="mt-7 rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-zinc-500">Connected account</span>
                <span className="font-mono text-xs text-zinc-200">{shortAddress(address)}</span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-xs text-zinc-500">Testnet balance</span>
                <span className="font-mono text-xs text-zinc-200">
                  {balance ? `${Number(formatEther(balance.value)).toFixed(4)} MON` : "—"}
                </span>
              </div>
            </div>
            {!isOnMonadTestnet && isConnected && (
              <button
                className="mt-5 w-full rounded-xl bg-cyan-300 px-4 py-3 text-sm font-bold text-zinc-950 transition hover:bg-cyan-200 disabled:cursor-wait disabled:opacity-60"
                disabled={isSwitching}
                onClick={() => switchChain({ chainId: MONAD_TESTNET_CHAIN_ID })}
              >
                {isSwitching ? "Requesting network switch…" : "Switch to Monad Testnet"}
              </button>
            )}
            {connectError && (
              <p className="mt-4 rounded-xl border border-rose-300/20 bg-rose-300/10 p-3 text-xs leading-5 text-rose-200">
                Wallet connection failed: {connectError.message}
              </p>
            )}
          </div>

          <div className="rounded-3xl border border-lime-300/20 bg-lime-300/[0.06] p-6 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-lime-200/70">
                  02 / contract
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-white">Live probe interaction</h2>
              </div>
              <span className="rounded-full border border-lime-300/20 bg-lime-300/10 px-3 py-1 text-xs font-medium text-lime-200">
                {isConfirmed ? "Confirmed" : isConfirming ? "Confirming…" : "Ready"}
              </span>
            </div>
            <p className="mt-4 max-w-xl text-sm leading-6 text-zinc-400">
              Read the current marker, then submit a write that updates it. This
              is the smallest useful proof that the UI, wallet, chain, ABI, and
              receipt path are wired together.
            </p>

            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <span className="text-xs text-zinc-500">Current marker</span>
                <p className="mt-2 font-mono text-3xl text-white">
                  {marker === undefined ? "—" : marker.toString()}
                </p>
              </div>
              <label className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <span className="text-xs text-zinc-500">New marker</span>
                <input
                  className="mt-1 w-full bg-transparent font-mono text-3xl text-white outline-none placeholder:text-zinc-700"
                  inputMode="numeric"
                  min="0"
                  onChange={(event) => setNextMarker(event.target.value)}
                  placeholder="1"
                  type="number"
                  value={nextMarker}
                />
              </label>
            </div>

            {!isProbeConfigured && (
              <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm leading-6 text-amber-100">
                No probe address is configured yet. Run the local deploy command
                from the README, then add its address to <code>NEXT_PUBLIC_PROBE_CONTRACT_ADDRESS</code>.
              </div>
            )}
            {isProbeConfigured && !isOnMonadTestnet && (
              <div className="mt-5 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4 text-sm leading-6 text-cyan-100">
                Switch the connected wallet to Monad Testnet before writing.
              </div>
            )}
            {writeError && (
              <div className="mt-5 rounded-2xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm leading-6 text-rose-100">
                Transaction failed: {writeError.message}
              </div>
            )}
            <button
              className="mt-5 w-full rounded-xl bg-lime-300 px-4 py-3 text-sm font-bold text-zinc-950 transition hover:bg-lime-200 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={
                !isConnected ||
                !isOnMonadTestnet ||
                !isProbeConfigured ||
                parsedMarker === undefined ||
                isWriting ||
                isConfirming
              }
              onClick={handleProbeWrite}
            >
              {isWriting ? "Waiting for wallet…" : isConfirming ? "Confirming onchain…" : "Write marker onchain"}
            </button>
            {transactionHash && (
              <a
                className="mt-4 block text-center text-xs text-lime-200 underline decoration-lime-300/40 underline-offset-4 hover:text-lime-100"
                href={`${MONAD_TESTNET_EXPLORER_URL}/tx/${transactionHash}`}
                rel="noreferrer"
                target="_blank"
              >
                View transaction {shortAddress(transactionHash)} ↗
              </a>
            )}
          </div>
        </section>

        <section className="mt-5 grid gap-5 pb-10 md:grid-cols-3">
          <InfoCard
            eyebrow="Authority"
            title="Contract first"
            body="The probe proves the contract call path. The future vault, not the UI or model, will enforce payment policy."
          />
          <InfoCard
            eyebrow="Custody"
            title="Keys stay in wallets"
            body="An agent signer can pay gas, but guarded funds will live in a contract with no unrestricted withdrawal route."
          />
          <Link
            className="rounded-3xl border border-lime-300/30 bg-lime-300/[0.06] p-6 transition hover:bg-lime-300/[0.1]"
            href="/agent"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-lime-200/70">Live on testnet</p>
            <h3 className="mt-3 text-lg font-semibold text-white">Set up a guarded agent →</h3>
            <p className="mt-3 text-sm leading-6 text-zinc-400">
              The registry and vault are deployed. Register an agent you own and give it its own signer.
            </p>
          </Link>
        </section>

        <footer className="border-t border-white/10 pt-5 text-xs text-zinc-600">
          Testnet only · Probe mode is not the payment vault · Never send real funds
        </footer>
      </div>
    </main>
  );
}

function StatusRow({
  label,
  value,
  complete,
  last = false,
}: {
  label: string;
  value: string;
  complete: boolean;
  last?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span
          className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold ${
            complete
              ? "border-lime-300 bg-lime-300 text-zinc-950"
              : "border-white/20 text-zinc-500"
          }`}
        >
          {complete ? "✓" : "·"}
        </span>
        {!last && <span className="mt-1 h-full w-px bg-white/10" />}
      </div>
      <div className="pb-4">
        <p className="text-sm font-medium text-white">{label}</p>
        <p className="mt-1 text-xs text-zinc-500">{value}</p>
      </div>
    </div>
  );
}

function InfoCard({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">{eyebrow}</p>
      <h3 className="mt-3 text-lg font-semibold text-white">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-zinc-500">{body}</p>
    </div>
  );
}
