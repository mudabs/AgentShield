import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEther } from "viem";
import { normalizePaymentIntent } from "../src/lib/ai/payment-intent";

const recipient = "0x0000000000000000000000000000000000000001";

describe("normalizePaymentIntent", function () {
  it("normalizes decimal MON into integer wei", function () {
    const result = normalizePaymentIntent({
      action: "pay",
      recipient,
      amountMon: "0.25",
      memo: "model fee",
    });

    assert.deepEqual(result, {
      ok: true,
      value: {
        action: "native_mon_payment",
        recipient,
        amountWei: parseEther("0.25").toString(),
        memo: "model fee",
      },
    });
  });

  it("accepts wei as the canonical execution amount", function () {
    const result = normalizePaymentIntent({
      action: "native_mon_payment",
      recipient,
      amountWei: "1000000000000000000",
    });

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.amountWei, parseEther("1").toString());
  });

  it("rejects unsupported actions, invalid recipients, and zero amounts", function () {
    assert.equal(
      normalizePaymentIntent({ action: "swap", recipient, amountMon: "1" }).ok,
      false,
    );
    assert.equal(
      normalizePaymentIntent({ action: "pay", recipient: "alice", amountMon: "1" }).ok,
      false,
    );
    assert.equal(
      normalizePaymentIntent({ action: "pay", recipient, amountMon: "0" }).ok,
      false,
    );
  });

  it("rejects ambiguous or unsafe amount formats", function () {
    assert.equal(
      normalizePaymentIntent({ action: "pay", recipient, amountMon: "1e-3" }).ok,
      false,
    );
    assert.equal(
      normalizePaymentIntent({
        action: "pay",
        recipient,
        amountMon: "1",
        amountWei: "1",
      }).ok,
      false,
    );
  });
});
