import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEther, type Hex } from "viem";
import {
  canonicalEnvelope,
  createEnvelope,
  decodeEnvelope,
  encodeEnvelope,
  envelopeRequestId,
  parseEnvelope,
  verifyEnvelope,
} from "../src/lib/receipts";

const vault = "0xbdbb2b644d79ac3f5a5282e52050e9b5e563a202";
const shop = "0x1240e3e019384c673a1b6cfba61823b6619c98df";
const salt = `0x${"ab".repeat(32)}` as Hex;

function sample() {
  return createEnvelope({
    chainId: 10143,
    vault,
    agentId: BigInt(8),
    recipient: shop,
    amountWei: parseEther("0.05"),
    salt,
    source: { provider: "Kimi", model: "kimi-k2.6", prompt: "Pay the shop 0.05 MON", memo: "coffee", recipientName: "Shop" },
  });
}

describe("request receipts", function () {
  it("hashes the same envelope the same way regardless of address case or key order", function () {
    const a = sample();
    const b = { ...sample(), vault: vault.toUpperCase().replace("0X", "0x") as `0x${string}` };
    assert.equal(envelopeRequestId(a), envelopeRequestId(parseEnvelope(JSON.parse(JSON.stringify(b)))!));
  });

  it("changes the request ID when the prompt, amount or recipient changes", function () {
    const base = envelopeRequestId(sample());
    const edited = sample();
    edited.source!.prompt = "Pay the shop 5 MON";
    assert.notEqual(envelopeRequestId(edited), base);
    assert.notEqual(envelopeRequestId({ ...sample(), amountWei: "1" }), base);
    assert.notEqual(envelopeRequestId({ ...sample(), salt: `0x${"cd".repeat(32)}` }), base);
  });

  it("round-trips through a link fragment", function () {
    const envelope = sample();
    const decoded = decodeEnvelope(encodeEnvelope(envelope));
    assert.ok(decoded);
    assert.equal(canonicalEnvelope(decoded), canonicalEnvelope(envelope));
  });

  it("rejects garbage in a link", function () {
    assert.equal(decodeEnvelope("not-base64!!"), undefined);
    assert.equal(parseEnvelope({ v: 2 }), undefined);
    assert.equal(parseEnvelope({ ...sample(), salt: "0x12" }), undefined);
  });

  it("verifies against the onchain record and lists every mismatch", function () {
    const envelope = sample();
    const onchain = {
      chainId: 10143,
      vault: vault as `0x${string}`,
      agentId: BigInt(8),
      requestId: envelopeRequestId(envelope),
      recipient: shop as `0x${string}`,
      amount: parseEther("0.05"),
    };
    assert.deepEqual(verifyEnvelope(envelope, onchain), { ok: true });
    const tampered = sample();
    tampered.source!.prompt = "something else";
    const result = verifyEnvelope(tampered, { ...onchain, amount: parseEther("0.06") });
    assert.equal(result.ok, false);
    assert.equal(result.ok ? 0 : result.mismatches.length, 2);
  });
});
