"use client";

import { useMemo, useSyncExternalStore } from "react";
import { getAddress, isAddress, type Address } from "viem";

// The owner's address book for each agent, remembered in this browser: the
// recipients they approved or checked, with an optional name for the AI to use.
// Approval itself always lives onchain in the vault; any UI that shows
// "approved" must read it from the chain, not from this list.

export type BookEntry = { address: Address; name: string };

const listeners = new Set<() => void>();
const storageKey = (agentId: bigint) => `agentshield.recipients.${agentId.toString()}`;

function readRaw(agentId: bigint): string {
  try {
    return window.localStorage.getItem(storageKey(agentId)) ?? "[]";
  } catch {
    return "[]";
  }
}

/** Accepts both the old format (list of addresses) and the new one (list of {address, name}). */
function parseBook(raw: string): BookEntry[] {
  try {
    const list = JSON.parse(raw) as unknown[];
    const entries: BookEntry[] = [];
    for (const item of list) {
      const address = typeof item === "string" ? item : (item as { address?: unknown })?.address;
      const name = typeof item === "object" && item !== null ? (item as { name?: unknown }).name : "";
      if (typeof address === "string" && isAddress(address)) {
        entries.push({ address: getAddress(address), name: typeof name === "string" ? name : "" });
      }
    }
    return entries;
  } catch {
    return [];
  }
}

function writeBook(agentId: bigint, entries: BookEntry[]) {
  try {
    window.localStorage.setItem(storageKey(agentId), JSON.stringify(entries));
  } catch {
    // Storage unavailable: onchain approvals still happen, they just are not listed here.
  }
  listeners.forEach((notify) => notify());
}

/** Adds a recipient if new. Updates the name only when one is given. */
export function rememberRecipient(agentId: bigint, recipient: Address, name?: string) {
  const entries = parseBook(readRaw(agentId));
  const existing = entries.find((entry) => entry.address === getAddress(recipient));
  if (existing) {
    if (name !== undefined) existing.name = name.trim();
  } else {
    entries.push({ address: getAddress(recipient), name: name?.trim() ?? "" });
  }
  writeBook(agentId, entries);
}

export function setRecipientName(agentId: bigint, recipient: Address, name: string) {
  rememberRecipient(agentId, recipient, name);
}

export function useAddressBook(agentId: bigint | undefined): BookEntry[] {
  const raw = useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    () => (agentId === undefined ? "[]" : readRaw(agentId)),
    () => "[]",
  );
  return useMemo(() => parseBook(raw), [raw]);
}

export function useRememberedRecipients(agentId: bigint | undefined): Address[] {
  const book = useAddressBook(agentId);
  return useMemo(() => book.map((entry) => entry.address), [book]);
}
