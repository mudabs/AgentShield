import { isAddress, parseEther, type Address } from "viem";

export const MAX_PAYMENT_MEMO_LENGTH = 256;

export type PaymentIntent = {
  action: "native_mon_payment";
  recipient: Address;
  amountWei: string;
  memo?: string;
};

export type PaymentIntentValidationCode =
  | "not_object"
  | "unsupported_action"
  | "invalid_recipient"
  | "missing_amount"
  | "invalid_amount"
  | "zero_amount"
  | "invalid_memo";

export type PaymentIntentValidationResult =
  | { ok: true; value: PaymentIntent }
  | { ok: false; code: PaymentIntentValidationCode; message: string };

const decimalMonPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/;
const integerWeiPattern = /^(?:0|[1-9]\d*)$/;

/**
 * Converts untrusted model output into the only payment shape allowed to reach
 * deterministic preview and contract execution code.
 */
export function normalizePaymentIntent(input: unknown): PaymentIntentValidationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return failure("not_object", "The model output must be a structured object.");
  }

  const candidate = input as Record<string, unknown>;
  if (candidate.action !== "pay" && candidate.action !== "native_mon_payment") {
    return failure("unsupported_action", "Only native MON payments are supported.");
  }

  if (typeof candidate.recipient !== "string" || !isAddress(candidate.recipient)) {
    return failure("invalid_recipient", "Recipient must be a valid EVM address.");
  }

  const hasWei = candidate.amountWei !== undefined;
  const hasMon = candidate.amountMon !== undefined;
  if (hasWei === hasMon) {
    return failure("missing_amount", "Provide exactly one amount in MON or wei.");
  }

  let amountWei: bigint;
  try {
    if (hasWei) {
      if (typeof candidate.amountWei !== "string" || !integerWeiPattern.test(candidate.amountWei)) {
        return failure("invalid_amount", "Wei amount must be a non-negative integer string.");
      }
      amountWei = BigInt(candidate.amountWei);
    } else {
      if (typeof candidate.amountMon !== "string" || !decimalMonPattern.test(candidate.amountMon)) {
        return failure("invalid_amount", "MON amount must be a decimal string with at most 18 places.");
      }
      amountWei = parseEther(candidate.amountMon);
    }
  } catch {
    return failure("invalid_amount", "Amount could not be converted to native MON base units.");
  }

  if (amountWei <= BigInt(0)) {
    return failure("zero_amount", "Payment amount must be greater than zero.");
  }

  if (candidate.memo !== undefined &&
      (typeof candidate.memo !== "string" || candidate.memo.length > MAX_PAYMENT_MEMO_LENGTH)) {
    return failure("invalid_memo", `Memo must be a string of at most ${MAX_PAYMENT_MEMO_LENGTH} characters.`);
  }

  return {
    ok: true,
    value: {
      action: "native_mon_payment",
      recipient: candidate.recipient as Address,
      amountWei: amountWei.toString(),
      ...(candidate.memo === undefined ? {} : { memo: candidate.memo as string }),
    },
  };
}

function failure(
  code: PaymentIntentValidationCode,
  message: string,
): { ok: false; code: PaymentIntentValidationCode; message: string } {
  return { ok: false, code, message };
}
