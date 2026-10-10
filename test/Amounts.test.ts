import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEther } from "viem";
import { parseMonAmount } from "../src/lib/amounts";

describe("parseMonAmount", function () {
  it("converts decimal MON strings to exact integer wei", function () {
    assert.deepEqual(parseMonAmount("0.1"), { ok: true, wei: parseEther("0.1") });
    assert.deepEqual(parseMonAmount(" 2 "), { ok: true, wei: parseEther("2") });
    assert.deepEqual(parseMonAmount(".5"), { ok: true, wei: parseEther("0.5") });
    assert.deepEqual(parseMonAmount("0.000000000000000001"), { ok: true, wei: BigInt(1) });
  });

  it("rejects empty, zero, negative, and malformed amounts", function () {
    for (const input of ["", "0", "0.0", "-1", "1e3", "1,5", "abc", "01", "0.0000000000000000001"]) {
      assert.equal(parseMonAmount(input).ok, false, `expected "${input}" to be rejected`);
    }
  });
});
