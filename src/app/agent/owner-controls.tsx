"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAccount,
  useBalance,
  usePublicClient,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { formatEther, getAddress, isAddress, zeroAddress, type Abi, type Address } from "viem";
import { MONAD_TESTNET_CHAIN_ID, MONAD_TESTNET_EXPLORER_URL } from "@/lib/monad";
import { registryAbi, registryAddress, vaultAbi, vaultAddress } from "@/lib/guard";
import { parseMonAmount } from "@/lib/amounts";
import { describeError } from "@/lib/errors";
import { rememberRecipient, setRecipientName, useAddressBook } from "@/lib/recipients";

type Tone = "info" | "success" | "warning" | "error";
type Status = { tone: Tone; text: string };

type VaultCall = {
  functionName: "configurePolicy" | "setRecipientApproval" | "setPaused" | "deposit";
  args: readonly unknown[];
  value?: bigint;
};

/**
 * One owner transaction against the vault, with honest status:
 * checking -> waiting for wallet -> submitted -> confirmed / reverted / failed.
 *
 * Before asking the wallet to sign, the call is simulated against current chain
 * state. The simulation is only a preview: the contract re-checks everything
 * when the real transaction executes, and that result is the one that counts.
 */
export function useVaultWrite(successText: string) {
  const queryClient = useQueryClient();
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: MONAD_TESTNET_CHAIN_ID });
  const [isChecking, setIsChecking] = useState(false);
  const [preflightError, setPreflightError] = useState<string>();
  const { data: hash, error: walletError, isPending: isAwaitingWallet, writeContract, reset } =
    useWriteContract();
  const { data: receipt, error: receiptError, isLoading: isConfirming } =
    useWaitForTransactionReceipt({
      chainId: MONAD_TESTNET_CHAIN_ID,
      hash,
      query: { enabled: Boolean(hash) },
    });

  // Once a transaction is confirmed, re-read balances and policy everywhere on the page.
  useEffect(() => {
    if (receipt?.status === "success") void queryClient.invalidateQueries();
  }, [receipt, queryClient]);

  const send = async (call: VaultCall) => {
    if (!vaultAddress || !publicClient || !address) return;
    reset();
    setPreflightError(undefined);
    setIsChecking(true);
    try {
      await publicClient.simulateContract({
        account: address,
        address: vaultAddress,
        abi: vaultAbi as Abi,
        functionName: call.functionName,
        args: call.args,
        value: call.value,
      });
    } catch (error) {
      setPreflightError(describeError(error as Error));
      setIsChecking(false);
      return;
    }
    setIsChecking(false);
    writeContract({
      address: vaultAddress,
      abi: vaultAbi as Abi,
      functionName: call.functionName,
      args: call.args,
      value: call.value,
      chainId: MONAD_TESTNET_CHAIN_ID,
    });
  };

  let status: Status | undefined;
  if (preflightError) status = { tone: "error", text: `The vault would reject this: ${preflightError}` };
  else if (walletError) status = { tone: "error", text: describeError(walletError) };
  else if (receiptError) status = { tone: "error", text: `Could not confirm: ${describeError(receiptError)}` };
  else if (isChecking) status = { tone: "info", text: "Checking the request against the vault…" };
  else if (isAwaitingWallet) status = { tone: "info", text: "Confirm the transaction in MetaMask…" };
  else if (isConfirming) status = { tone: "info", text: "Submitted. Waiting for Monad to confirm…" };
  else if (receipt?.status === "reverted") status = { tone: "error", text: "Mined but reverted. Nothing changed." };
  else if (receipt?.status === "success") status = { tone: "success", text: successText };

  return { send, status, hash, busy: isChecking || isAwaitingWallet || isConfirming };
}

export function OwnerControls({ agentId, canWrite }: { agentId: bigint; canWrite: boolean }) {
  const { address } = useAccount();
  const { data: agent } = useReadContract({
    address: registryAddress,
    abi: registryAbi,
    functionName: "getAgent",
    args: [agentId],
    chainId: MONAD_TESTNET_CHAIN_ID,
    query: { enabled: Boolean(registryAddress) },
  });
  const { data: policy } = useReadContract({
    address: vaultAddress,
    abi: vaultAbi,
    functionName: "getPolicy",
    args: [agentId],
    chainId: MONAD_TESTNET_CHAIN_ID,
    query: { enabled: Boolean(vaultAddress) },
  });

  if (!agent || !address) return null;
  if (agent.owner.toLowerCase() !== address.toLowerCase()) {
    return (
      <section className="pb-10">
        <Notice tone="warning">
          You are connected as {address}, which does not own agent #{agentId.toString()}. Only the owner
          can change its rules or fund it.
        </Notice>
      </section>
    );
  }

  const [perPaymentLimit, dailyLimit, , , , paused] = policy ?? [];

  return (
    <section className="pb-10">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-lime-200/70">
          Step 2 · Owner controls for agent #{agentId.toString()}
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-white">Set the rules, then fund the vault</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
          Each action is a transaction from your owner wallet. The vault checks onchain that you are the
          owner, so nobody else, including the agent, can make these changes.
        </p>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <PolicyCard
          agentId={agentId}
          canWrite={canWrite}
          currentDaily={dailyLimit}
          currentPerPayment={perPaymentLimit}
        />
        <RecipientsCard agentId={agentId} agentSigner={agent.authorizedSigner} canWrite={canWrite} />
        <DepositCard agentId={agentId} canWrite={canWrite} owner={address} />
        <PauseCard agentId={agentId} canWrite={canWrite} paused={paused} />
      </div>
    </section>
  );
}

function PolicyCard({
  agentId,
  canWrite,
  currentPerPayment,
  currentDaily,
}: {
  agentId: bigint;
  canWrite: boolean;
  currentPerPayment?: bigint;
  currentDaily?: bigint;
}) {
  const [perPaymentInput, setPerPaymentInput] = useState("");
  const [dailyInput, setDailyInput] = useState("");
  const [touched, setTouched] = useState(false);
  const write = useVaultWrite("Limits saved onchain. The policy version went up by one.");

  const perPayment = parseMonAmount(perPaymentInput);
  const daily = parseMonAmount(dailyInput);
  let validation: string | undefined;
  if (!perPayment.ok) validation = `Per-payment limit: ${perPayment.message}`;
  else if (!daily.ok) validation = `Daily limit: ${daily.message}`;
  else if (perPayment.wei > daily.wei) validation = "The per-payment limit cannot be larger than the daily limit.";

  const hasPolicy = currentPerPayment !== undefined && currentPerPayment > BigInt(0);

  return (
    <Card eyebrow="Spending limits" title="How much, and how often">
      <p className="text-xs leading-5 text-zinc-500">
        These limits apply to payments the agent makes out of the vault. Your own deposits are not
        limited.
      </p>
      <p className="mt-2 text-xs leading-5 text-zinc-500">
        Current:{" "}
        {hasPolicy && currentDaily !== undefined
          ? `${formatEther(currentPerPayment)} MON per payment, ${formatEther(currentDaily)} MON per UTC day`
          : "not set, so every payment is refused"}
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <AmountField label="Max per payment (MON)" onChange={setPerPaymentInput} placeholder="0.1" value={perPaymentInput} />
        <AmountField label="Max per day (MON)" onChange={setDailyInput} placeholder="0.3" value={dailyInput} />
      </div>
      {touched && validation && <p className="mt-2 text-xs text-rose-300">{validation}</p>}
      <StatusLine hash={write.hash} status={write.status} />
      <ActionButton
        disabled={!canWrite || write.busy || Boolean(validation)}
        label={write.busy ? "Working…" : "Save limits"}
        onClick={() => {
          setTouched(true);
          if (validation || !perPayment.ok || !daily.ok) return;
          void write.send({ functionName: "configurePolicy", args: [agentId, perPayment.wei, daily.wei] });
        }}
      />
    </Card>
  );
}

/** Rules that the contract does not enforce but that would undermine the guard. */
function validateRecipient(input: string, agentSigner: Address): string | undefined {
  const value = input.trim();
  if (!value) return "Enter the address the agent should be allowed to pay.";
  if (!isAddress(value)) return "That is not a valid address. Copy it again and check for typos.";
  const recipient = getAddress(value);
  if (recipient === zeroAddress) return "The zero address cannot receive payments.";
  if (vaultAddress && recipient === getAddress(vaultAddress)) return "The vault itself cannot be a recipient.";
  if (recipient === getAddress(agentSigner)) {
    return "Do not approve the agent's own signer. Paying itself would move funds out of the vault's protection.";
  }
  return undefined;
}

function RecipientsCard({
  agentId,
  agentSigner,
  canWrite,
}: {
  agentId: bigint;
  agentSigner: Address;
  canWrite: boolean;
}) {
  const [input, setInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [touched, setTouched] = useState(false);
  const book = useAddressBook(agentId);
  const write = useVaultWrite("Recipient list updated onchain.");
  const validation = validateRecipient(input, agentSigner);

  const submit = (approved: boolean, target?: Address) => {
    setTouched(true);
    const recipient = target ?? (validation ? undefined : getAddress(input.trim()));
    if (!recipient) return;
    rememberRecipient(agentId, recipient, target ? undefined : nameInput.trim() || undefined);
    void write.send({ functionName: "setRecipientApproval", args: [agentId, recipient, approved] });
  };

  return (
    <Card eyebrow="Approved recipients" title="Who the agent may pay">
      <p className="text-xs leading-5 text-zinc-500">
        Payments to any address not on this list are refused. Give each recipient a name so the AI can
        refer to it (&ldquo;pay Shop 0.05 MON&rdquo;). Names stay in this browser; approvals are onchain.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-[0.35fr_0.65fr]">
        <input
          className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-lime-300/50"
          maxLength={40}
          onChange={(event) => setNameInput(event.target.value)}
          placeholder="Name, e.g. Shop"
          value={nameInput}
        />
        <input
          className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 font-mono text-sm text-white outline-none placeholder:text-zinc-600 focus:border-lime-300/50"
          onChange={(event) => setInput(event.target.value)}
          placeholder="0x… recipient address"
          spellCheck={false}
          value={input}
        />
      </div>
      {touched && validation && <p className="mt-2 text-xs text-rose-300">{validation}</p>}
      <StatusLine hash={write.hash} status={write.status} />
      <ActionButton
        disabled={!canWrite || write.busy || Boolean(validation)}
        label={write.busy ? "Working…" : "Approve recipient"}
        onClick={() => submit(true)}
      />
      {book.length > 0 && (
        <ul className="mt-4 space-y-2">
          {book.map((entry) => (
            <RecipientRow
              agentId={agentId}
              busy={write.busy || !canWrite}
              key={entry.address}
              name={entry.name}
              onRename={(name) => setRecipientName(agentId, entry.address, name)}
              onRevoke={() => submit(false, entry.address)}
              recipient={entry.address}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function RecipientRow({
  agentId,
  recipient,
  name,
  busy,
  onRevoke,
  onRename,
}: {
  agentId: bigint;
  recipient: Address;
  name: string;
  busy: boolean;
  onRevoke: () => void;
  onRename: (name: string) => void;
}) {
  const { data: approved } = useReadContract({
    address: vaultAddress,
    abi: vaultAbi,
    functionName: "approvedRecipients",
    args: [agentId, recipient],
    chainId: MONAD_TESTNET_CHAIN_ID,
    query: { enabled: Boolean(vaultAddress) },
  });
  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs">
      <span className="flex min-w-0 items-center gap-2">
        <input
          aria-label="Recipient name"
          className="w-28 rounded-md border border-white/20 bg-black/30 px-2 py-1 text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-lime-300/60"
          defaultValue={name}
          key={name}
          maxLength={40}
          onBlur={(event) => {
            if (event.target.value.trim() !== name) onRename(event.target.value);
          }}
          placeholder="Name, e.g. Shop"
        />
        <span className="font-mono text-zinc-400">
          {recipient.slice(0, 8)}…{recipient.slice(-6)}
        </span>
      </span>
      <span className="flex items-center gap-3">
        <span className={approved ? "text-lime-200" : "text-zinc-500"}>
          {approved === undefined ? "Checking…" : approved ? "Approved" : "Not approved"}
        </span>
        {approved && (
          <button className="text-rose-300 underline-offset-4 hover:underline disabled:opacity-40" disabled={busy} onClick={onRevoke}>
            Remove
          </button>
        )}
      </span>
    </li>
  );
}

function DepositCard({ agentId, owner, canWrite }: { agentId: bigint; owner: Address; canWrite: boolean }) {
  const [input, setInput] = useState("");
  const [touched, setTouched] = useState(false);
  const { data: walletBalance } = useBalance({ address: owner, chainId: MONAD_TESTNET_CHAIN_ID });
  const write = useVaultWrite("Deposit confirmed. The vault now holds these funds for this agent.");

  const amount = parseMonAmount(input);
  let validation: string | undefined = amount.ok ? undefined : amount.message;
  if (amount.ok && walletBalance && amount.wei >= walletBalance.value) {
    validation = "That is more than your wallet holds. Keep a little MON back for gas fees.";
  }

  return (
    <Card eyebrow="Fund the vault" title="Move test MON into the vault">
      <p className="text-xs leading-5 text-zinc-500">
        Your wallet: {walletBalance ? `${formatEther(walletBalance.value)} MON` : "—"}. After depositing, the
        funds sit in the vault under agent #{agentId.toString()}. The agent can only move them by making a
        payment the rules allow.
      </p>
      <div className="mt-4">
        <AmountField label="Amount (MON)" onChange={setInput} placeholder="0.5" value={input} />
      </div>
      {touched && validation && <p className="mt-2 text-xs text-rose-300">{validation}</p>}
      <StatusLine hash={write.hash} status={write.status} />
      <ActionButton
        disabled={!canWrite || write.busy || Boolean(validation)}
        label={write.busy ? "Working…" : "Deposit"}
        onClick={() => {
          setTouched(true);
          if (validation || !amount.ok) return;
          void write.send({ functionName: "deposit", args: [agentId], value: amount.wei });
        }}
      />
    </Card>
  );
}

function PauseCard({ agentId, paused, canWrite }: { agentId: bigint; paused?: boolean; canWrite: boolean }) {
  const write = useVaultWrite(paused ? "Agent paused." : "Agent resumed.");
  return (
    <Card eyebrow="Emergency stop" title={paused ? "Agent is paused" : "Agent is running"}>
      <p className="text-xs leading-5 text-zinc-500">
        Pausing makes the vault refuse every payment from this agent, regardless of limits, until you
        resume it. Use it if the agent behaves unexpectedly.
      </p>
      <StatusLine hash={write.hash} status={write.status} />
      <ActionButton
        danger={!paused}
        disabled={!canWrite || write.busy || paused === undefined}
        label={write.busy ? "Working…" : paused ? "Resume agent" : "Pause agent"}
        onClick={() => void write.send({ functionName: "setPaused", args: [agentId, !paused] })}
      />
    </Card>
  );
}

function Card({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-3xl border border-white/10 bg-[#101419] p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">{eyebrow}</p>
      <h3 className="mt-2 text-lg font-semibold text-white">{title}</h3>
      <div className="mt-3 flex flex-1 flex-col">{children}</div>
    </div>
  );
}

function AmountField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-zinc-400">{label}</span>
      <input
        className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 font-mono text-sm text-white outline-none placeholder:text-zinc-600 focus:border-lime-300/50"
        inputMode="decimal"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  danger?: boolean;
}) {
  return (
    <div className="mt-auto pt-4">
      <button
        className={`w-full rounded-xl px-4 py-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
          danger ? "bg-rose-300 text-zinc-950 hover:bg-rose-200" : "bg-lime-300 text-zinc-950 hover:bg-lime-200"
        }`}
        disabled={disabled}
        onClick={onClick}
      >
        {label}
      </button>
    </div>
  );
}

export function StatusLine({ status, hash }: { status?: Status; hash?: string }) {
  if (!status) return null;
  return (
    <Notice tone={status.tone}>
      {status.text}
      {hash && (
        <a
          className="ml-2 underline underline-offset-4"
          href={`${MONAD_TESTNET_EXPLORER_URL}/tx/${hash}`}
          rel="noreferrer"
          target="_blank"
        >
          View ↗
        </a>
      )}
    </Notice>
  );
}

function Notice({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const styles = {
    info: "border-cyan-300/20 bg-cyan-300/10 text-cyan-100",
    success: "border-lime-300/20 bg-lime-300/10 text-lime-100",
    warning: "border-amber-300/20 bg-amber-300/10 text-amber-100",
    error: "border-rose-300/20 bg-rose-300/10 text-rose-100",
  }[tone];
  return <div className={`mt-4 rounded-2xl border p-3 text-xs leading-5 ${styles}`}>{children}</div>;
}
