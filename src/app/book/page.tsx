"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useConnect, useDisconnect, usePublicClient, useReadContract } from "wagmi";
import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import { MONAD_TESTNET_CHAIN_ID, MONAD_TESTNET_EXPLORER_URL } from "@/lib/monad";
import { registryAddress, vaultAbi, vaultAddress } from "@/lib/guard";
import { loadAgents, sameAddress, type RegisteredAgent } from "@/lib/agents";
import { describeError } from "@/lib/errors";
import { forgetRecipient, rememberRecipient, setRecipientName, useAddressBook } from "@/lib/recipients";
import { SiteNav } from "../site-nav";
import { StatusLine, useVaultWrite } from "../agent/owner-controls";
import { setSelectedAgentId, useSelectedAgentId } from "@/lib/selected-agent";

function shortAddress(value?: string) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—";
}

export default function AddressBookPage() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const publicClient = usePublicClient({ chainId: MONAD_TESTNET_CHAIN_ID });
  const activeConnector = connectors[0];

  // Agents this wallet owns or signs for.
  const agentsQuery = useQuery({
    queryKey: ["related-agents", registryAddress, address],
    enabled: Boolean(publicClient && registryAddress && address),
    queryFn: () =>
      loadAgents(
        publicClient!,
        registryAddress!,
        (agent) => sameAddress(agent.owner, address) || sameAddress(agent.authorizedSigner, address),
      ),
  });
  const agents = agentsQuery.data ?? [];
  const agentId = useSelectedAgentId(agents.map((candidate) => candidate.id));
  const agent = agents.find((candidate) => candidate.id === agentId);
  const isOwner = sameAddress(agent?.owner, address);
  const canWrite = isOwner && chainId === MONAD_TESTNET_CHAIN_ID;
  const book = useAddressBook(agentId);

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
              <p className="text-xs text-zinc-500">Address book</p>
            </div>
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <SiteNav />
            {isConnected ? (
              <button
                className="rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 text-xs font-semibold text-white hover:bg-white/10"
                onClick={() => disconnect()}
              >
                {shortAddress(address)}
              </button>
            ) : (
              <button
                className="rounded-full bg-lime-300 px-4 py-2 text-xs font-bold text-zinc-950 hover:bg-lime-200 disabled:opacity-60"
                disabled={isConnecting || !activeConnector}
                onClick={() => activeConnector && connect({ connector: activeConnector })}
              >
                {isConnecting ? "Connecting…" : "Connect wallet"}
              </button>
            )}
          </div>
        </header>

        <section className="py-10 lg:py-12">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-lime-200/70">Contacts and approvals</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">Address book</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-400">
            Names let you and the AI say &ldquo;pay Shop&rdquo; instead of an address. A name is only a label in this
            browser. Whether the agent may actually pay someone is decided by the vault&apos;s approved list onchain,
            shown live in the Status column.
          </p>
        </section>

        {!isConnected ? (
          <Notice>Connect MetaMask as the owner or the agent to see that agent&apos;s address book.</Notice>
        ) : agentsQuery.isLoading ? (
          <Notice>Looking up your agents…</Notice>
        ) : agentsQuery.error ? (
          <Notice>Could not read the registry: {describeError(agentsQuery.error)}</Notice>
        ) : agents.length === 0 || agentId === undefined || !agent ? (
          <Notice>This account neither owns nor signs for any agent.</Notice>
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-center gap-2">
              {agents.map((candidate) => (
                <button
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    candidate.id === agentId
                      ? "border-lime-300 bg-lime-300 text-zinc-950"
                      : "border-white/15 bg-white/[0.04] text-zinc-300 hover:bg-white/10"
                  }`}
                  key={candidate.id.toString()}
                  onClick={() => setSelectedAgentId(candidate.id)}
                >
                  Agent #{candidate.id.toString()}
                  <span className="ml-1 font-mono font-normal opacity-70">· signer {shortAddress(candidate.authorizedSigner)}</span>
                </button>
              ))}
              <span className="text-xs text-zinc-500">
                Approvals below are for Agent #{agentId.toString()}. You are its {isOwner ? "owner" : "signer"}.
              </span>
            </div>

            <section className="grid gap-5 pb-6 lg:grid-cols-2">
              <LookupCard agent={agent} agentId={agentId} book={book} />
              <AddContactCard agent={agent} agentId={agentId} canWrite={canWrite} isOwner={isOwner} />
            </section>

            <section className="pb-10">
              <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#101419]">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-6 py-4">
                  <h2 className="text-lg font-semibold text-white">
                    Your contacts <span className="text-zinc-500">({book.length})</span>
                  </h2>
                  {isOwner && (
                    <Link className="text-xs text-lime-200 underline-offset-4 hover:underline" href="/agent">
                      Approve or revoke recipients on Owner setup →
                    </Link>
                  )}
                </div>
                {book.length === 0 ? (
                  <p className="px-6 py-8 text-sm text-zinc-500">
                    No contacts yet. Add one above, or approve a recipient on Owner setup.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-left text-sm">
                      <thead className="text-xs uppercase tracking-[0.12em] text-zinc-500">
                        <tr>
                          <th className="px-6 py-3 font-medium">Name</th>
                          <th className="px-6 py-3 font-medium">Address</th>
                          <th className="px-6 py-3 font-medium">Agent #{agentId.toString()} may pay (onchain)</th>
                          <th className="px-6 py-3 font-medium" />
                        </tr>
                      </thead>
                      <tbody>
                        {book.map((entry) => (
                          <ContactRow agentId={agentId} canWrite={canWrite} entry={entry} isOwner={isOwner} key={entry.address} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <p className="mt-3 text-xs leading-5 text-zinc-500">
                One contact list is shared by all your agents and stored in this browser only. Approval is per agent and
                lives onchain: switch agents above to see each one&apos;s approvals. Removing a contact does not revoke
                its approval.
              </p>
            </section>
          </>
        )}

        <footer className="border-t border-white/10 pt-5 text-xs text-zinc-600">
          Testnet only · Vault {shortAddress(vaultAddress)}
        </footer>
      </div>
    </main>
  );
}

function useApproval(agentId: bigint, recipient?: Address) {
  return useReadContract({
    address: vaultAddress,
    abi: vaultAbi,
    functionName: "approvedRecipients",
    args: recipient ? [agentId, recipient] : undefined,
    chainId: MONAD_TESTNET_CHAIN_ID,
    query: { enabled: Boolean(vaultAddress && recipient) },
  });
}

function StatusBadge({ approved }: { approved?: boolean }) {
  if (approved === undefined) return <span className="text-xs text-zinc-500">Checking…</span>;
  return approved ? (
    <span className="rounded-full bg-lime-300/15 px-2.5 py-1 text-[11px] font-semibold text-lime-200">Approved</span>
  ) : (
    <span className="rounded-full bg-rose-300/15 px-2.5 py-1 text-[11px] font-semibold text-rose-200">
      Not approved: vault will refuse
    </span>
  );
}

function ContactRow({
  agentId,
  entry,
  isOwner,
  canWrite,
}: {
  agentId: bigint;
  entry: { address: Address; name: string };
  isOwner: boolean;
  canWrite: boolean;
}) {
  const { data: approved } = useApproval(agentId, entry.address);
  const write = useVaultWrite("Approval updated onchain.");
  return (
    <tr className="border-t border-white/5">
      <td className="px-6 py-3">
        <input
          aria-label={`Name for ${entry.address}`}
          className="w-40 rounded-lg border border-white/20 bg-black/30 px-2 py-1.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-lime-300/60"
          defaultValue={entry.name}
          key={entry.name}
          maxLength={40}
          onBlur={(event) => {
            if (event.target.value.trim() !== entry.name) setRecipientName(agentId, entry.address, event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          placeholder="Add a name"
        />
      </td>
      <td className="px-6 py-3 font-mono text-xs text-zinc-300">
        <a
          className="hover:text-white hover:underline"
          href={`${MONAD_TESTNET_EXPLORER_URL}/address/${entry.address}`}
          rel="noreferrer"
          target="_blank"
          title="View on explorer"
        >
          {entry.address}
        </a>
      </td>
      <td className="px-6 py-3">
        <StatusBadge approved={approved} />
        {write.status && write.status.tone !== "success" && <StatusLine hash={write.hash} status={write.status} />}
      </td>
      <td className="whitespace-nowrap px-6 py-3 text-right">
        {isOwner && approved !== undefined && (
          <button
            className={`mr-4 text-xs font-semibold disabled:opacity-40 ${approved ? "text-rose-200 hover:text-rose-100" : "text-lime-200 hover:text-lime-100"}`}
            disabled={!canWrite || write.busy}
            onClick={() => void write.send({ functionName: "setRecipientApproval", args: [agentId, entry.address, !approved] })}
          >
            {write.busy ? "Working…" : approved ? "Revoke" : "Approve"}
          </button>
        )}
        <button
          className="text-xs text-zinc-500 hover:text-rose-200"
          onClick={() => forgetRecipient(agentId, entry.address)}
        >
          Remove
        </button>
      </td>
    </tr>
  );
}

/** Answers "is this address in my book, and may the agent pay it?" for any pasted address. */
function LookupCard({
  agentId,
  agent,
  book,
}: {
  agentId: bigint;
  agent: RegisteredAgent;
  book: { address: Address; name: string }[];
}) {
  const [input, setInput] = useState("");
  const value = input.trim();
  const valid = isAddress(value);
  const address = valid ? getAddress(value) : undefined;
  const { data: approved } = useApproval(agentId, address);
  const contact = address ? book.find((entry) => entry.address === address) : undefined;

  let role: string | undefined;
  if (address && sameAddress(address, agent.owner)) role = "This is the agent's owner.";
  if (address && sameAddress(address, agent.authorizedSigner)) role = "This is the agent's own signer.";

  return (
    <div className="rounded-3xl border border-white/10 bg-[#101419] p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Look up an address</p>
      <input
        className="mt-4 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 font-mono text-sm text-white outline-none placeholder:text-zinc-600 focus:border-lime-300/50"
        onChange={(event) => setInput(event.target.value)}
        placeholder="Paste any 0x… address"
        spellCheck={false}
        value={input}
      />
      {value && !valid && <p className="mt-2 text-xs text-rose-300">That is not a valid address.</p>}
      {address && (
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-zinc-500">In address book</dt>
            <dd className="text-white">{contact ? `Yes, as "${contact.name || "unnamed"}"` : "No"}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-zinc-500">Agent #{agentId.toString()} may pay it</dt>
            <dd>
              <StatusBadge approved={approved} />
            </dd>
          </div>
          {role && <p className="text-xs text-amber-200">{role}</p>}
        </dl>
      )}
    </div>
  );
}

function AddContactCard({
  agentId,
  agent,
  isOwner,
  canWrite,
}: {
  agentId: bigint;
  agent: RegisteredAgent;
  isOwner: boolean;
  canWrite: boolean;
}) {
  const write = useVaultWrite("Saved and approved onchain. The agent may now pay this contact within its limits.");
  const [name, setName] = useState("");
  const [input, setInput] = useState("");
  const [saved, setSaved] = useState<string>();
  const value = input.trim();
  let error: string | undefined;
  if (!name.trim()) error = "Give the contact a name.";
  else if (!isAddress(value)) error = "Enter a valid address.";
  else if (getAddress(value) === zeroAddress) error = "The zero address cannot be a contact.";
  else if (sameAddress(value, agent.authorizedSigner)) error = "That is the agent's own signer. It cannot be a recipient.";
  else if (vaultAddress && sameAddress(value, vaultAddress)) error = "The vault itself cannot be a recipient.";

  const save = (approve: boolean) => {
    if (error) return;
    const recipient = getAddress(value);
    rememberRecipient(agentId, recipient, name.trim());
    setSaved(name.trim());
    setName("");
    setInput("");
    if (approve) void write.send({ functionName: "setRecipientApproval", args: [agentId, recipient, true] });
  };

  return (
    <div className="rounded-3xl border border-white/10 bg-[#101419] p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Add a contact</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-[0.4fr_0.6fr]">
        <input
          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-lime-300/50"
          maxLength={40}
          onChange={(event) => {
            setName(event.target.value);
            setSaved(undefined);
          }}
          placeholder="Name"
          value={name}
        />
        <input
          className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 font-mono text-sm text-white outline-none placeholder:text-zinc-600 focus:border-lime-300/50"
          onChange={(event) => {
            setInput(event.target.value);
            setSaved(undefined);
          }}
          placeholder="0x… address"
          spellCheck={false}
          value={input}
        />
      </div>
      <div className={`mt-3 grid gap-2 ${isOwner ? "sm:grid-cols-2" : ""}`}>
        {isOwner && (
          <button
            className="rounded-xl bg-lime-300 px-4 py-2.5 text-sm font-bold text-zinc-950 hover:bg-lime-200 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={Boolean(error) || !canWrite || write.busy}
            onClick={() => save(true)}
          >
            {write.busy ? "Working…" : "Save and approve onchain"}
          </button>
        )}
        <button
          className={`rounded-xl px-4 py-2.5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40 ${
            isOwner ? "border border-white/15 bg-white/[0.06] text-white hover:bg-white/10" : "bg-lime-300 text-zinc-950 hover:bg-lime-200"
          }`}
          disabled={Boolean(error) || write.busy}
          onClick={() => save(false)}
        >
          Save contact only
        </button>
      </div>
      <StatusLine hash={write.hash} status={write.status} />
      <p className="mt-2 text-xs leading-5 text-zinc-500">
        {(name || input) && error
          ? error
          : write.status
            ? ""
            : saved
              ? `Saved "${saved}" as a contact. It is not approved, so the vault will refuse payments to it.`
              : isOwner
                ? "Approving is an onchain transaction from your owner wallet. A saved-only contact cannot be paid."
                : "Only the owner can approve contacts. A saved-only contact cannot be paid."}
      </p>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-10 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4 text-sm leading-6 text-cyan-100">
      {children}
    </div>
  );
}
