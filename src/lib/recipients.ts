"use client";

import { useMemo, useSyncExternalStore } from "react";
import { isAddress, type Address } from "viem";

// Recipients the owner has approved or checked, remembered in this browser so
// they can be listed. Approval itself always lives onchain in the vault; any UI
// that shows "approved" must read it from the chain, not from this list.
const listeners = new Set<() => void>();
const storageKey = (agentId: bigint) => `agentshield.recipients.${agentId.toString()}`;

function readRaw(agentId: bigint): string {
  try {
    return window.localStorage.getItem(storageKey(agentId)) ?? "[]";
  } catch {
    return "[]";
  }
}

export function rememberRecipient(agentId: bigint, recipient: Address) {
  try {
    const list = JSON.parse(readRaw(agentId)) as string[];
    if (!list.some((entry) => entry.toLowerCase() === recipient.toLowerCase())) {
      list.push(recipient);
      window.localStorage.setItem(storageKey(agentId), JSON.stringify(list));
    }
  } catch {
    // Storage unavailable: the onchain approval still happens, it just is not listed here.
  }
  listeners.forEach((notify) => notify());
}

export function useRememberedRecipients(agentId: bigint | undefined): Address[] {
  const raw = useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    () => (agentId === undefined ? "[]" : readRaw(agentId)),
    () => "[]",
  );
  return useMemo(() => {
    try {
      return (JSON.parse(raw) as string[]).filter((entry) => isAddress(entry)) as Address[];
    } catch {
      return [];
    }
  }, [raw]);
}
