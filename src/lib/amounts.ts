import { parseEther } from "viem";

const decimalMonPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/;

export type MonAmountResult = { ok: true; wei: bigint } | { ok: false; message: string };

/**
 * Converts a user-typed MON amount (for example "0.25") into wei, the integer
 * base unit the contracts use. 1 MON = 10^18 wei. No floating-point math is
 * involved: parseEther works on the decimal string directly.
 */
export function parseMonAmount(input: string): MonAmountResult {
  const value = input.trim();
  if (!value) return { ok: false, message: "Enter an amount in MON." };
  const normalized = value.startsWith(".") ? `0${value}` : value;
  if (!decimalMonPattern.test(normalized)) {
    return { ok: false, message: "Use a plain number like 0.25 (up to 18 decimal places)." };
  }
  const wei = parseEther(normalized);
  if (wei <= BigInt(0)) return { ok: false, message: "The amount must be greater than zero." };
  return { ok: true, wei };
}
