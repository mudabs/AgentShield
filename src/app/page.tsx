import Link from "next/link";
import { MONAD_TESTNET_EXPLORER_URL } from "@/lib/monad";
import { registryAddress, vaultAddress } from "@/lib/guard";
import { SiteNav } from "./site-nav";

const steps = [
  {
    label: "1 · Owner",
    title: "Set the rules",
    body: "Register an agent with its own signing key, set a per-payment and daily limit, approve who it may pay, and deposit MON into the vault.",
    href: "/agent",
    cta: "Owner setup",
  },
  {
    label: "2 · Agent",
    title: "Ask in plain language",
    body: "Kimi, OpenAI or Claude turns “pay Shop 0.05 MON for coffee” into a structured request. The model only sees contact names, never addresses or keys.",
    href: "/pay",
    cta: "Agent console",
  },
  {
    label: "3 · Vault",
    title: "The contract decides",
    body: "The vault checks the signer, recipient, limits, pause switch and replay protection onchain. It pays, or it reverts and nothing moves.",
    href: "/book",
    cta: "Address book",
  },
];

const guarantees = [
  ["Only approved recipients", "Any other address is refused, even if the AI is tricked into naming it."],
  ["Per-payment and daily caps", "Limits are checked by the contract on every payment, per UTC day."],
  ["Agent cannot withdraw", "Its key can only call executePayment. Withdrawals go to the owner only."],
  ["Emergency stop", "Pause blocks every payment instantly. Deactivate retires an agent."],
  ["Key rotation", "If an agent key leaks, the owner swaps it in one transaction."],
  ["Verifiable receipts", "Each request ID is a hash of the prompt, model, recipient and amount."],
];

const flow = ["Your sentence", "AI model", "AgentShield checks", "Vault contract", "Paid or blocked"];

function short(value?: string) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "not configured";
}

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#080a0d] text-zinc-100">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-60" />
      <div className="pointer-events-none absolute -left-32 top-20 h-96 w-96 rounded-full bg-lime-400/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-40 bottom-0 h-[32rem] w-[32rem] rounded-full bg-cyan-400/10 blur-3xl" />

      <div className="relative mx-auto w-full max-w-6xl px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-lime-300 text-lg font-black text-zinc-950">
              A
            </div>
            <div>
              <p className="text-sm font-semibold tracking-wide text-white">AgentShield</p>
              <p className="text-xs text-zinc-500">Trust layer for agent payments</p>
            </div>
          </div>
          <SiteNav />
        </header>

        <section className="py-14 lg:py-20">
          <p className="inline-flex items-center gap-2 rounded-full border border-lime-300/20 bg-lime-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-lime-200">
            <span className="h-1.5 w-1.5 rounded-full bg-lime-300" /> Live on Monad Testnet
          </p>
          <h1 className="mt-6 max-w-4xl text-5xl font-semibold tracking-[-0.05em] text-white sm:text-6xl lg:text-7xl">
            Give your AI agent a wallet, not a blank cheque.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-400">
            AgentShield is a vault contract that holds an agent&apos;s funds and enforces the owner&apos;s rules on
            every payment. The AI can propose a payment. Only the vault decides whether it happens.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link className="rounded-xl bg-lime-300 px-5 py-3 text-sm font-bold text-zinc-950 hover:bg-lime-200" href="/agent">
              Set up an agent
            </Link>
            <Link
              className="rounded-xl border border-white/15 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-white hover:bg-white/10"
              href="/pay"
            >
              Open the agent console
            </Link>
          </div>
        </section>

        <section className="pb-14">
          <ol className="flex flex-wrap items-center gap-2 text-xs">
            {flow.map((item, index) => (
              <li className="flex items-center gap-2" key={item}>
                <span
                  className={`rounded-full border px-3 py-1.5 font-semibold ${
                    index === 3 ? "border-lime-300/40 bg-lime-300/15 text-lime-100" : "border-white/10 bg-white/[0.04] text-zinc-300"
                  }`}
                >
                  {item}
                </span>
                {index < flow.length - 1 && <span className="text-zinc-600">→</span>}
              </li>
            ))}
          </ol>
          <div className="mt-6 grid gap-5 md:grid-cols-3">
            {steps.map((step) => (
              <div className="flex flex-col rounded-3xl border border-white/10 bg-[#101419] p-6" key={step.title}>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">{step.label}</p>
                <h2 className="mt-2 text-xl font-semibold text-white">{step.title}</h2>
                <p className="mt-3 flex-1 text-sm leading-6 text-zinc-400">{step.body}</p>
                <Link className="mt-5 text-sm font-semibold text-lime-200 hover:text-lime-100" href={step.href}>
                  {step.cta} →
                </Link>
              </div>
            ))}
          </div>
        </section>

        <section className="pb-14">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-lime-200/70">Enforced by the contract, not the app</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-white">What the vault guarantees</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {guarantees.map(([title, body]) => (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5" key={title}>
                <p className="text-sm font-semibold text-white">{title}</p>
                <p className="mt-2 text-sm leading-6 text-zinc-400">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-5 pb-14 md:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-[#101419] p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Deployed contracts</p>
            <dl className="mt-4 space-y-3 text-sm">
              {[
                ["AgentRegistry", registryAddress],
                ["AgentGuardVault", vaultAddress],
              ].map(([name, address]) => (
                <div className="flex items-center justify-between gap-4" key={name}>
                  <dt className="text-zinc-400">{name}</dt>
                  <dd>
                    {address ? (
                      <a
                        className="font-mono text-lime-200 underline underline-offset-4"
                        href={`${MONAD_TESTNET_EXPLORER_URL}/address/${address}`}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {short(address)} ↗
                      </a>
                    ) : (
                      <span className="font-mono text-zinc-500">not configured</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="rounded-3xl border border-white/10 bg-[#101419] p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Honest limits</p>
            <ul className="mt-4 space-y-2 text-sm leading-6 text-zinc-400">
              <li>Testnet only. Amounts are test MON with no real value.</li>
              <li>In this demo a person clicks Send as the agent. A production agent signs with its own key automatically, under the same vault rules.</li>
              <li>The model name on a receipt is declared by the server, not signed by the model provider.</li>
            </ul>
          </div>
        </section>

        <footer className="border-t border-white/10 pt-5 text-xs text-zinc-600">
          AgentShield · Built on Monad Testnet
        </footer>
      </div>
    </main>
  );
}
