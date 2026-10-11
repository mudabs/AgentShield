"use client";

import { useMemo, useSyncExternalStore } from "react";
import { getAddress, isAddress, type Address } from "viem";

// One address book of named contacts for this browser, shared by every agent.
// A contact is only a label for an address. Whether a given agent may pay it is
// decided per agent by the vault's onchain approval list; any UI that shows
// "approved" must read that from the chain, not from this list.
//
// The `agentId` parameters below are kept for call-site compatibility; contacts
// no longer depend on which agent is selected.

export type BookEntry = { address: Address; name: string };

const listeners = new Set<() => void>();
const STORAGE_KEY = "agentshield.contacts";
const LEGACY_PREFIX = "agentshield.recipients.";

/** Reads the shared book, merging any older per-agent lists into it once. */
function readRaw(_agentId?: bigint): string {
  void _agentId;
  try {
    const current = window.localStorage.getItem(STORAGE_KEY);
    if (current !== null) return current;
    const merged: BookEntry[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(LEGACY_PREFIX)) continue;
      for (const entry of parseBook(window.localStorage.getItem(key) ?? "[]")) {
        const existing = merged.find((item) => item.address === entry.address);
        if (!existing) merged.push(entry);
        else if (!existing.name && entry.name) existing.name = entry.name;
      }
    }
    const raw = JSON.stringify(merged);
    window.localStorage.setItem(STORAGE_KEY, raw);
    return raw;
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

function writeBook(_agentId: bigint, entries: BookEntry[]) {
  void _agentId;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
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

/** Removes a contact from this browser's address book. It does not change onchain approval. */
export function forgetRecipient(agentId: bigint, recipient: Address) {
  const entries = parseBook(readRaw(agentId)).filter((entry) => entry.address !== getAddress(recipient));
  writeBook(agentId, entries);
}
