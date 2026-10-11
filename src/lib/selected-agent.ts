"use client";

import { useSyncExternalStore } from "react";

// The agent the person last picked, shared by every page in this browser, so
// switching between Owner setup, Agent console and Address book keeps the same
// agent instead of jumping to the newest one.
const KEY = "agentshield.selectedAgent";
const listeners = new Set<() => void>();

function read(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function setSelectedAgentId(agentId: bigint) {
  try {
    window.localStorage.setItem(KEY, agentId.toString());
  } catch {
    // Storage unavailable: selection just won't persist across pages.
  }
  listeners.forEach((notify) => notify());
}

/**
 * Returns the remembered agent if it is in `available`, otherwise the oldest
 * available agent (usually the one already set up), or undefined if none.
 */
export function useSelectedAgentId(available: bigint[]): bigint | undefined {
  const raw = useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    read,
    () => "",
  );
  if (available.length === 0) return undefined;
  if (/^\d+$/.test(raw)) {
    const remembered = BigInt(raw);
    if (available.includes(remembered)) return remembered;
  }
  return available.reduce((oldest, id) => (id < oldest ? id : oldest));
}
