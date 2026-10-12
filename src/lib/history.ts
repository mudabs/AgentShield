"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { Hash, Hex } from "viem";
import { MONAD_TESTNET_CHAIN_ID } from "./monad";
import { vaultAddress } from "./guard";
import { envelopeRequestId, parseEnvelope, type RequestEnvelope } from "./receipts";

// Payment attempts made from this browser, kept across reloads.
// Paid entries are also onchain (PaymentExecuted events) and each one links to a
// receipt page that re-reads the chain, so this list is a convenience index, not
// the source of truth. Refused requests exist only here.

export type HistoryOutcome = "paid" | "refused-not-sent" | "reverted-onchain" | "failed";

export type HistoryRecord = {
  envelope: RequestEnvelope;
  requestId: Hex;
  outcome: HistoryOutcome;
  note: string;
  hash?: Hash;
  policyVersion?: string;
  dayIndex?: string;
  /** Milliseconds since epoch, from this browser's clock. */
  at: number;
};

const MAX_RECORDS = 200;
const listeners = new Set<() => void>();

function storageKey() {
  return `agentshield.history.${MONAD_TESTNET_CHAIN_ID}.${(vaultAddress ?? "none").toLowerCase()}`;
}

function readRaw(): string {
  try {
    return window.localStorage.getItem(storageKey()) ?? "[]";
  } catch {
    return "[]";
  }
}

const OUTCOMES: HistoryOutcome[] = ["paid", "refused-not-sent", "reverted-onchain", "failed"];

function parseRecords(raw: string): HistoryRecord[] {
  try {
    const list = JSON.parse(raw) as unknown[];
    const records: HistoryRecord[] = [];
    for (const item of Array.isArray(list) ? list : []) {
      const value = item as Record<string, unknown>;
      const envelope = parseEnvelope(value?.envelope);
      if (!envelope || !OUTCOMES.includes(value.outcome as HistoryOutcome)) continue;
      records.push({
        envelope,
        requestId: envelopeRequestId(envelope),
        outcome: value.outcome as HistoryOutcome,
        note: typeof value.note === "string" ? value.note : "",
        hash: typeof value.hash === "string" ? (value.hash as Hash) : undefined,
        policyVersion: typeof value.policyVersion === "string" ? value.policyVersion : undefined,
        dayIndex: typeof value.dayIndex === "string" ? value.dayIndex : undefined,
        at: typeof value.at === "number" ? value.at : 0,
      });
    }
    return records;
  } catch {
    return [];
  }
}

export function addHistory(record: Omit<HistoryRecord, "requestId" | "at">) {
  const records = parseRecords(readRaw());
  const full: HistoryRecord = { ...record, requestId: envelopeRequestId(record.envelope), at: Date.now() };
  const next = [full, ...records].slice(0, MAX_RECORDS);
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify(next));
  } catch {
    // Storage unavailable: the payment itself is unaffected.
  }
  listeners.forEach((notify) => notify());
}

/** Newest first, for one agent. */
export function useHistory(agentId: bigint | undefined): HistoryRecord[] {
  const raw = useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    readRaw,
    () => "[]",
  );
  return useMemo(
    () =>
      agentId === undefined
        ? []
        : parseRecords(raw).filter((record) => record.envelope.agentId === agentId.toString()),
    [raw, agentId],
  );
}

export function findHistoryByHash(hash: string): HistoryRecord | undefined {
  return parseRecords(readRaw()).find((record) => record.hash?.toLowerCase() === hash.toLowerCase());
}
