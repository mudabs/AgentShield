"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { decodeFunctionData, formatEther, getAddress, isHash, parseEventLogs, type Address, type Hash, type Hex } from "viem";
import { MONAD_TESTNET_CHAIN_ID, MONAD_TESTNET_EXPLORER_URL } from "@/lib/monad";
import { vaultAbi, vaultAddress } from "@/lib/guard";
import { describeError } from "@/lib/errors";
import { findHistoryByHash } from "@/lib/history";
import { decodeEnvelope, verifyEnvelope, type RequestEnvelope } from "@/lib/receipts";
import { SiteNav } from "../../site-nav";
import { BrandMark } from "../../brand-mark";

type Facts = {
  status: "paid" | "reverted";
  agentId: bigint;
  requestId: Hex;
  recipient: Address;
  amount: bigint;
  signer: Address;
  blockNumber: bigint;
  timestamp: bigint;
  policyVersion?: bigint;
  dayIndex?: bigint;
  revertReason?: string;
};

/**
 * Public receipt. Everything under "Onchain record" is read from Monad by this page;
 * nothing comes from the person who shared the link. The request details travel in
 * the link fragment (#e=…), which browsers never send to a server, and are only shown
 * as verified if they hash to the request ID the vault recorded.
 */
export function ReceiptView() {
  const params = useParams<{ hash: string }>();
  const hash = params.hash;
  const publicClient = usePublicClient({ chainId: MONAD_TESTNET_CHAIN_ID });
  const [envelope, setEnvelope] = useState<RequestEnvelope>();
  const [copied, setCopied] = useState(false);

  // The fragment is only readable in the browser, after mount.
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1)).get("e");
    const fromLink = fragment ? decodeEnvelope(fragment) : undefined;
    setEnvelope(fromLink ?? (isHash(hash) ? findHistoryByHash(hash)?.envelope : undefined));
  }, [hash]);

  const factsQuery = useQuery({
    queryKey: ["receipt", hash],
    enabled: Boolean(publicClient && isHash(hash) && vaultAddress),
    retry: 1,
    queryFn: async (): Promise<Facts | "not-agentshield"> => {
      const client = publicClient!;
      const [transaction, receipt] = await Promise.all([
        client.getTransaction({ hash: hash as Hash }),
        client.getTransactionReceipt({ hash: hash as Hash }),
      ]);
      if (!transaction.to || getAddress(transaction.to) !== getAddress(vaultAddress!)) return "not-agentshield";
      let call;
      try {
        call = decodeFunctionData({ abi: vaultAbi, data: transaction.input });
      } catch {
        return "not-agentshield";
      }
      if (call.functionName !== "executePayment") return "not-agentshield";
      const [agentId, requestId, recipient, amount] = call.args as readonly [bigint, Hex, Address, bigint];
      const block = await client.getBlock({ blockNumber: receipt.blockNumber });
      const base = {
        agentId,
        requestId,
        recipient: getAddress(recipient),
        amount,
        signer: getAddress(transaction.from),
        blockNumber: receipt.blockNumber,
        timestamp: block.timestamp,
      };
      if (receipt.status === "success") {
        const [executed] = parseEventLogs({
          abi: vaultAbi,
          eventName: "PaymentExecuted",
          logs: receipt.logs.filter((log) => getAddress(log.address) === getAddress(vaultAddress!)),
        });
        return {
          ...base,
          status: "paid",
          ...(executed
            ? {
                agentId: executed.args.agentId,
                requestId: executed.args.requestId,
                recipient: getAddress(executed.args.recipient),
                amount: executed.args.amount,
                signer: getAddress(executed.args.signer),
                policyVersion: executed.args.policyVersion,
                dayIndex: executed.args.dayIndex,
              }
            : {}),
        };
      }
      // Reverted: replay at that block to recover the vault's reason.
      let revertReason: string | undefined;
      try {
        await client.simulateContract({
          account: transaction.from,
          address: vaultAddress!,
          abi: vaultAbi,
          functionName: "executePayment",
          args: [agentId, requestId, recipient, amount],
          blockNumber: receipt.blockNumber,
        });
      } catch (error) {
        revertReason = describeError(error as Error);
      }
      return { ...base, status: "reverted", revertReason };
    },
  });

  const facts = factsQuery.data && factsQuery.data !== "not-agentshield" ? factsQuery.data : undefined;
  const check =
    envelope && facts
      ? verifyEnvelope(envelope, {
          chainId: MONAD_TESTNET_CHAIN_ID,
          vault: vaultAddress!,
          agentId: facts.agentId,
          requestId: facts.requestId,
          recipient: facts.recipient,
          amount: facts.amount,
        })
      : undefined;

  const [envelopeParam, setEnvelopeParam] = useState("");
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1)).get("e");
    setEnvelopeParam(fragment ? `&e=${fragment}` : "");
  }, []);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked; the address bar still has the link.
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#080a0d] text-zinc-100">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-60" />
      <div className="relative mx-auto w-full max-w-3xl px-5 py-6 sm:px-8 lg:py-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-6">
          <Link className="flex items-center gap-3" href="/">
            <BrandMark />
            <div>
              <p className="text-sm font-semibold tracking-wide text-white">AgentShield</p>
              <p className="text-xs text-zinc-500">Payment receipt</p>
            </div>
          </Link>
          <SiteNav />
        </header>

        <section className="py-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-lime-200/70">Verifiable receipt</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
            {facts?.status === "paid"
              ? `${formatEther(facts.amount)} MON paid by Agent #${facts.agentId}`
              : facts?.status === "reverted"
                ? `Payment blocked by the vault`
                : "Agent payment receipt"}
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-400">
            Read directly from Monad Testnet by this page. Nothing below the request details depends on who sent
            you the link.
          </p>
        </section>

        {!isHash(hash) ? (
          <Notice tone="error">That is not a transaction hash.</Notice>
        ) : factsQuery.isLoading ? (
          <Notice tone="info">Reading the transaction from Monad…</Notice>
        ) : factsQuery.error ? (
          <Notice tone="error">Could not read this transaction: {describeError(factsQuery.error as Error)}</Notice>
        ) : factsQuery.data === "not-agentshield" ? (
          <Notice tone="warning">This transaction is not an AgentShield payment from vault {vaultAddress}.</Notice>
        ) : facts ? (
          <>
            <Card title="Onchain record">
              <Badge status={facts.status} />
              {facts.status === "reverted" && (
                <p className="mt-3 text-xs leading-5 text-rose-100/80">
                  The agent asked the vault to pay and the contract refused. No funds moved.
                  {facts.revertReason ? ` Reason: ${facts.revertReason}` : ""}
                </p>
              )}
              <dl className="mt-4 space-y-2.5 text-xs">
                <Row label="Agent" value={`#${facts.agentId}`} />
                <Row label="Amount" value={`${formatEther(facts.amount)} MON`} />
                <Row label="Recipient" value={facts.recipient} />
                <Row label="Signed by (agent key)" value={facts.signer} />
                <Row label="Vault" value={vaultAddress!} />
                <Row label="Time (UTC)" value={new Date(Number(facts.timestamp) * 1000).toISOString().replace("T", " ").slice(0, 19)} />
                <Row label="Block" value={facts.blockNumber.toString()} />
                {facts.policyVersion !== undefined && <Row label="Policy version" value={facts.policyVersion.toString()} />}
                <Row label="Request ID" value={facts.requestId} />
              </dl>
              <a
                className="mt-4 inline-block text-xs text-lime-200 underline underline-offset-4"
                href={`${MONAD_TESTNET_EXPLORER_URL}/tx/${hash}`}
                rel="noreferrer"
                target="_blank"
              >
                Open in the Monad explorer ↗
              </a>
              <a
                className="ml-4 mt-4 inline-block text-xs text-zinc-400 underline underline-offset-4"
                href={`/api/verify?tx=${hash}${envelopeParam}`}
                rel="noreferrer"
                target="_blank"
              >
                Machine-readable proof (JSON) ↗
              </a>
            </Card>

            <Card title="Request details">
              {!envelope ? (
                <p className="text-xs leading-5 text-zinc-400">
                  No request details came with this link. The payment above is still verified from the chain; the
                  prompt and model only travel in the share link from the browser that made the payment.
                </p>
              ) : check?.ok ? (
                <>
                  <p className="rounded-xl border border-lime-300/25 bg-lime-300/[0.07] p-3 text-xs leading-5 text-lime-100">
                    Verified: these details hash to the request ID the vault recorded. They cannot have been edited
                    after the payment was signed.
                  </p>
                  <dl className="mt-4 space-y-2.5 text-xs">
                    {envelope.source ? (
                      <>
                        <Row label="Typed request" value={`“${envelope.source.prompt}”`} wrap />
                        <Row label="Interpreted by" value={`${envelope.source.provider} (${envelope.source.model})`} />
                        {envelope.source.recipientName && <Row label="Recipient name" value={envelope.source.recipientName} />}
                        {envelope.source.memo && <Row label="Memo" value={envelope.source.memo} />}
                        {envelope.source.part && <Row label="Part of request" value={`Payment ${envelope.source.part}`} />}
                      </>
                    ) : (
                      <Row label="Source" value="Filled in by hand, no AI" />
                    )}
                  </dl>
                  {envelope.source && (
                    <p className="mt-3 text-[11px] leading-4 text-zinc-500">
                      The model name is declared by the AgentShield server, not signed by the model provider.
                    </p>
                  )}
                </>
              ) : (
                <div className="rounded-xl border border-rose-300/25 bg-rose-300/[0.07] p-3 text-xs leading-5 text-rose-100">
                  <p className="font-semibold">These request details do not match the onchain record.</p>
                  <ul className="mt-1 list-disc pl-4">
                    {check && !check.ok && check.mismatches.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              )}
              <button
                className="mt-4 rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2 text-xs font-semibold text-white hover:bg-white/10"
                onClick={() => void copyLink()}
              >
                {copied ? "Link copied" : "Copy share link"}
              </button>
            </Card>
          </>
        ) : null}

        <footer className="mt-8 border-t border-white/10 pt-5 text-xs text-zinc-600">
          Testnet only · Amounts are test MON with no real value
        </footer>
      </div>
    </main>
  );
}

function Badge({ status }: { status: "paid" | "reverted" }) {
  return status === "paid" ? (
    <span className="rounded-full bg-lime-300/15 px-2.5 py-1 text-[11px] font-semibold text-lime-200">Paid · every rule passed onchain</span>
  ) : (
    <span className="rounded-full bg-rose-300/15 px-2.5 py-1 text-[11px] font-semibold text-rose-200">Blocked onchain</span>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 rounded-3xl border border-white/10 bg-[#101419] p-6">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">{title}</p>
      {children}
    </section>
  );
}

function Row({ label, value, wrap = false }: { label: string; value: string; wrap?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <dt className="shrink-0 text-zinc-500">{label}</dt>
      <dd className={`font-mono text-zinc-200 ${wrap ? "whitespace-pre-wrap" : "break-all"} sm:text-right`}>{value}</dd>
    </div>
  );
}

function Notice({ tone, children }: { tone: "info" | "warning" | "error"; children: React.ReactNode }) {
  const styles = {
    info: "border-cyan-300/20 bg-cyan-300/10 text-cyan-100",
    warning: "border-amber-300/20 bg-amber-300/10 text-amber-100",
    error: "border-rose-300/20 bg-rose-300/10 text-rose-100",
  }[tone];
  return <div className={`rounded-2xl border p-4 text-sm leading-6 ${styles}`}>{children}</div>;
}
