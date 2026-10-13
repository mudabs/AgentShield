"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAccount, useConnect, usePublicClient, useSignTypedData, useSwitchChain, useWriteContract } from "wagmi";
import { getAddress, type Address } from "viem";
import { MONAD_TESTNET_CHAIN_ID, MONAD_TESTNET_EXPLORER_URL } from "@/lib/monad";
import { mandateExecutorAbi } from "@/lib/mandate-abi";
import { MANDATE_TYPES, mandateDomain, parseMandate, purposeHashOf, serializeMandate, type Mandate, type StoredMandate } from "@/lib/mandates";
import { parseMonAmount } from "@/lib/amounts";
import { describeError } from "@/lib/errors";
import { SiteNav } from "../site-nav";
import { BrandMark } from "../brand-mark";

type MandateView = StoredMandate & { spentMon: string; remainingMon: string; maxTotalMon: string; maxPerPaymentMon: string; status: string };
type Overview =
  | { configured: false }
  | {
      configured: true;
      executor: Address;
      agentId: string;
      owner: Address;
      agentKey: Address;
      wired: boolean;
      vaultBalance: string;
      perPaymentLimit: string;
      dailyLimit: string;
      spentToday: string;
      paused: boolean;
      recipients: { name: string; address: Address; approved: boolean }[];
      mandates: MandateView[];
    };
type ActionResult = { tone: "good" | "bad" | "info"; text: string; hash?: string };

const short = (value?: string) => (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—");

export default function MandatesPage() {
  const [overview, setOverview] = useState<Overview>();
  const [loadError, setLoadError] = useState<string>();
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/mandates", { cache: "no-store" });
      const data = (await response.json()) as Overview & { message?: string };
      if (!response.ok) throw new Error(data.message ?? `HTTP ${response.status}`);
      setOverview(data);
      setLoadError(undefined);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load mandates.");
    }
  }, []);
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 12_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refresh]);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#080a0d] text-zinc-100">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-60" />
      <div className="pointer-events-none absolute -left-32 top-24 h-96 w-96 rounded-full bg-violet-400/10 blur-3xl" />
      <div className="relative mx-auto w-full max-w-6xl px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-6">
          <Link className="flex items-center gap-3" href="/">
            <BrandMark />
            <div>
              <p className="text-sm font-semibold tracking-wide text-white">AgentShield</p>
              <p className="text-xs text-zinc-500">Signed mandates</p>
            </div>
          </Link>
          <SiteNav />
        </header>

        <section className="py-10">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-200/80">Signed mandates · onchain</p>
          <h1 className="mt-3 max-w-4xl text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
            Give your agent a permission slip, not a credit line.
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-zinc-400">
            Standing limits say how much an agent may spend in general. A mandate says what it may spend <em>for this one job</em>:
            one recipient, one budget, one time window, one stated purpose. The owner signs it in MetaMask for free; the agent can
            spend under it and nothing else. Google&apos;s AP2 protocol describes this idea for card payments; here it is enforced
            by a contract on Monad, and the vault&apos;s standing policy still applies on top.
          </p>
        </section>

        {loadError && <Note tone="bad">Could not load mandates: {loadError}</Note>}
        {overview && !overview.configured && <Note tone="info">Mandates are not configured on this server yet (npm run mandates:setup).</Note>}

        {overview?.configured && (
          <section className="grid gap-5 pb-10 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-5">
              <AgentCard overview={overview} />
              <SignForm onSigned={() => void refresh()} overview={overview} />
            </div>
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Mandates ({overview.mandates.length})</p>
              {overview.mandates.length === 0 && (
                <Note tone="info">No mandates yet. The owner signs one on the left, then anyone can watch the agent use it and try to abuse it.</Note>
              )}
              {overview.mandates.map((entry) => (
                <MandateCard entry={entry} executor={overview.executor} key={entry.id} onChange={() => void refresh()} owner={overview.owner} />
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function AgentCard({ overview }: { overview: Extract<Overview, { configured: true }> }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-[#101419] p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Mandate-only agent</p>
      <h2 className="mt-2 text-xl font-semibold text-white">Agent #{overview.agentId}</h2>
      <p className="mt-2 text-xs leading-5 text-zinc-400">
        Its registry signer is the MandateExecutor contract, so its key cannot pay anything directly. Every payment needs a
        mandate the owner signed.
      </p>
      <dl className="mt-4 space-y-2 text-xs">
        <Row label="Wired to executor" value={overview.wired ? "yes" : "NO"} />
        <Row label="Executor contract" value={short(overview.executor)} />
        <Row label="Owner" value={short(overview.owner)} />
        <Row label="Agent key (server)" value={short(overview.agentKey)} />
        <Row label="Vault balance" value={`${overview.vaultBalance} MON`} />
        <Row label="Standing caps" value={`${overview.perPaymentLimit} per payment · ${overview.dailyLimit} per day`} />
        <Row label="Spent today" value={`${overview.spentToday} MON`} />
      </dl>
      <a className="mt-4 inline-block text-xs text-lime-200 underline underline-offset-4" href={`${MONAD_TESTNET_EXPLORER_URL}/address/${overview.executor}`} rel="noreferrer" target="_blank">
        Executor in the explorer ↗
      </a>
    </div>
  );
}

function SignForm({ overview, onSigned }: { overview: Extract<Overview, { configured: true }>; onSigned: () => void }) {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { switchChain } = useSwitchChain();
  const { signTypedDataAsync, isPending: signing } = useSignTypedData();
  const approved = overview.recipients.filter((entry) => entry.approved);
  const [recipient, setRecipient] = useState<string>("");
  const [purpose, setPurpose] = useState("Coffee beans for the office this week");
  const [total, setTotal] = useState("0.03");
  const [perPayment, setPerPayment] = useState("0.01");
  const [hours, setHours] = useState("24");
  const [result, setResult] = useState<ActionResult>();

  const isOwner = address && getAddress(address) === getAddress(overview.owner);
  const chosen = approved.find((entry) => entry.address === recipient) ?? approved[0];
  const totalAmount = parseMonAmount(total);
  const perAmount = parseMonAmount(perPayment);
  const valid = chosen && purpose.trim() && totalAmount.ok && perAmount.ok && Number(hours) > 0 && Number(hours) <= 720;

  const sign = async () => {
    if (!valid || !chosen || !totalAmount.ok || !perAmount.ok) return;
    setResult(undefined);
    const now = BigInt(Math.floor(Date.now() / 1000));
    const mandate: Mandate = {
      agentId: BigInt(overview.agentId),
      agentKey: overview.agentKey,
      recipient: chosen.address,
      maxTotal: totalAmount.wei,
      maxPerPayment: perAmount.wei,
      validAfter: now - BigInt(60),
      validUntil: now + BigInt(Math.round(Number(hours) * 3600)),
      purposeHash: purposeHashOf(purpose),
      nonce: BigInt(Date.now()),
    };
    try {
      const signature = await signTypedDataAsync({ domain: mandateDomain(overview.executor), types: MANDATE_TYPES, primaryType: "Mandate", message: mandate });
      const response = await fetch("/api/mandates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mandate: serializeMandate(mandate), signature, purpose: purpose.trim(), recipientName: chosen.name }),
      });
      const data = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(data.message ?? `HTTP ${response.status}`);
      setResult({ tone: "good", text: "Mandate signed and handed to the agent. It cost no gas." });
      onSigned();
    } catch (error) {
      setResult({ tone: "bad", text: error instanceof Error ? describeError(error) : "Signing failed." });
    }
  };

  return (
    <div className="rounded-3xl border border-violet-300/20 bg-[#100f17] p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-200/80">Owner · sign a mandate</p>
      {!isConnected ? (
        <button
          className="mt-4 w-full rounded-xl bg-violet-300 px-4 py-3 text-sm font-bold text-zinc-950 hover:bg-violet-200 disabled:opacity-50"
          disabled={connecting || !connectors[0]}
          onClick={() => connectors[0] && connect({ connector: connectors[0] })}
        >
          {connecting ? "Connecting…" : "Connect the owner wallet"}
        </button>
      ) : !isOwner ? (
        <Note tone="info">
          Connected as {short(address)}. Only the agent&apos;s owner ({short(overview.owner)}) can sign its mandates. You can still use
          and attack the mandates on the right.
        </Note>
      ) : chainId !== MONAD_TESTNET_CHAIN_ID ? (
        <button className="mt-4 w-full rounded-xl bg-cyan-300 px-4 py-3 text-sm font-bold text-zinc-950" onClick={() => switchChain({ chainId: MONAD_TESTNET_CHAIN_ID })}>
          Switch to Monad Testnet
        </button>
      ) : (
        <div className="mt-4 space-y-3 text-xs">
          <label className="block">
            <span className="text-zinc-400">Pay only</span>
            <select
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white"
              onChange={(event) => setRecipient(event.target.value)}
              value={chosen?.address ?? ""}
            >
              {approved.map((entry) => (
                <option key={entry.address} value={entry.address}>
                  {entry.name} · {short(entry.address)}
                </option>
              ))}
            </select>
          </label>
          <Field label="For (purpose, stored as a hash in the mandate)" onChange={setPurpose} value={purpose} />
          <div className="grid grid-cols-3 gap-2">
            <Field label="Total budget (MON)" onChange={setTotal} value={total} />
            <Field label="Max per payment" onChange={setPerPayment} value={perPayment} />
            <Field label="Valid for (hours)" onChange={setHours} value={hours} />
          </div>
          <button
            className="w-full rounded-xl bg-violet-300 px-4 py-3 text-sm font-bold text-zinc-950 hover:bg-violet-200 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!valid || signing}
            onClick={() => void sign()}
          >
            {signing ? "Confirm the signature in MetaMask…" : "Sign mandate (free, no gas)"}
          </button>
        </div>
      )}
      {result && <Note tone={result.tone}>{result.text}</Note>}
    </div>
  );
}

function MandateCard({ entry, executor, owner, onChange }: { entry: MandateView; executor: Address; owner: Address; onChange: () => void }) {
  const mandate = parseMandate(entry.mandate)!;
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: MONAD_TESTNET_CHAIN_ID });
  const { writeContractAsync, isPending: revoking } = useWriteContract();
  const [amount, setAmount] = useState(entry.maxPerPaymentMon);
  const [busy, setBusy] = useState<string>();
  const [result, setResult] = useState<ActionResult>();
  const spentFraction = Number(entry.maxTotalMon) > 0 ? Math.min(1, Number(entry.spentMon) / Number(entry.maxTotalMon)) : 0;
  const active = entry.status === "active";
  const isOwner = address && getAddress(address) === getAddress(owner);

  const run = async (label: string, body: { amountMon: string; attack?: string }) => {
    setBusy(label);
    setResult(undefined);
    try {
      const response = await fetch("/api/mandates/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry.id, ...body }),
      });
      const data = (await response.json()) as { message?: string; allowed?: boolean; paid?: boolean; hash?: string; reason?: string; simulatedOnly?: boolean };
      if (!response.ok) throw new Error(data.message ?? `HTTP ${response.status}`);
      if (!data.allowed) setResult({ tone: body.attack || label !== "pay" ? "good" : "bad", text: `Refused by the contract: ${data.reason}` });
      else if (data.simulatedOnly) setResult({ tone: "bad", text: "The contract would have accepted this. That should not happen." });
      else setResult({ tone: data.paid ? "good" : "bad", text: data.paid ? `Paid ${body.amountMon} MON under the mandate.` : "Reverted onchain.", hash: data.hash });
      onChange();
    } catch (error) {
      setResult({ tone: "bad", text: error instanceof Error ? error.message : "Request failed." });
    } finally {
      setBusy(undefined);
    }
  };

  const revoke = async () => {
    try {
      const hash = await writeContractAsync({ address: executor, abi: mandateExecutorAbi, functionName: "revoke", args: [mandate], chainId: MONAD_TESTNET_CHAIN_ID });
      setResult({ tone: "info", text: "Revocation sent…", hash });
      await publicClient?.waitForTransactionReceipt({ hash });
      setResult({ tone: "good", text: "Mandate revoked. The agent can no longer use it.", hash });
      onChange();
    } catch (error) {
      setResult({ tone: "bad", text: describeError(error as Error) });
    }
  };

  const overspend = (() => {
    const remaining = Number(entry.remainingMon);
    const per = Number(entry.maxPerPaymentMon);
    return (remaining < per ? remaining + 0.001 : per + 0.001).toFixed(3);
  })();

  return (
    <div className="rounded-3xl border border-white/10 bg-[#101419] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">&ldquo;{entry.purpose}&rdquo;</p>
          <p className="mt-1 text-xs text-zinc-400">
            Pay only <span className="text-zinc-200">{entry.recipientName ?? short(mandate.recipient)}</span> · up to {entry.maxPerPaymentMon} MON per
            payment · until {new Date(Number(mandate.validUntil) * 1000).toLocaleString()}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
            active ? "bg-lime-300/15 text-lime-200" : entry.status === "revoked" ? "bg-rose-300/15 text-rose-200" : "bg-white/10 text-zinc-300"
          }`}
        >
          {entry.status}
        </span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-violet-300" style={{ width: `${spentFraction * 100}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">
        {entry.spentMon} of {entry.maxTotalMon} MON used · {entry.remainingMon} left
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="w-28">
          <span className="text-[11px] text-zinc-500">Amount (MON)</span>
          <input
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-xs text-white"
            onChange={(event) => setAmount(event.target.value)}
            value={amount}
          />
        </label>
        <Action busy={busy === "pay"} disabled={Boolean(busy)} label="Agent pays" onClick={() => void run("pay", { amountMon: amount })} tone="lime" />
        <Action busy={busy === "over"} disabled={Boolean(busy)} label={`Overspend (${overspend})`} onClick={() => void run("over", { amountMon: overspend })} tone="rose" />
        <Action busy={busy === "forge"} disabled={Boolean(busy)} label="Forge signature" onClick={() => void run("forge", { amountMon: "0.001", attack: "forge" })} tone="rose" />
        <Action
          busy={busy === "tamper"}
          disabled={Boolean(busy)}
          label="Raise budget ×100"
          onClick={() => void run("tamper", { amountMon: (Number(entry.maxPerPaymentMon) * 2).toFixed(3), attack: "tamper" })}
          tone="rose"
        />
        {isOwner && active && <Action busy={revoking} disabled={revoking} label="Revoke (owner)" onClick={() => void revoke()} tone="zinc" />}
      </div>
      {result && (
        <Note tone={result.tone}>
          {result.text}
          {result.hash && (
            <a className="ml-2 underline underline-offset-4" href={`${MONAD_TESTNET_EXPLORER_URL}/tx/${result.hash}`} rel="noreferrer" target="_blank">
              tx ↗
            </a>
          )}
        </Note>
      )}
    </div>
  );
}

function Action({ label, onClick, disabled, busy, tone }: { label: string; onClick: () => void; disabled: boolean; busy: boolean; tone: "lime" | "rose" | "zinc" }) {
  const style = {
    lime: "bg-lime-300 text-zinc-950 hover:bg-lime-200",
    rose: "border border-rose-300/40 bg-rose-300/10 text-rose-100 hover:bg-rose-300/20",
    zinc: "border border-white/15 bg-white/[0.06] text-white hover:bg-white/10",
  }[tone];
  return (
    <button className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${style}`} disabled={disabled} onClick={onClick}>
      {busy ? "…" : label}
    </button>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-zinc-400">{label}</span>
      <input
        className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-300/50"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
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

function Note({ tone, children }: { tone: "good" | "bad" | "info"; children: React.ReactNode }) {
  const styles = {
    good: "border-lime-300/25 bg-lime-300/10 text-lime-100",
    bad: "border-rose-300/25 bg-rose-300/10 text-rose-100",
    info: "border-cyan-300/20 bg-cyan-300/10 text-cyan-100",
  }[tone];
  return <div className={`mt-3 rounded-2xl border p-3 text-xs leading-5 ${styles}`}>{children}</div>;
}

