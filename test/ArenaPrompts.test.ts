import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress } from "viem";
import { resolveIntents } from "../src/lib/ai/intent";
import { buildCompromisedPrompt, promptFor, userTextForResolution } from "../src/lib/arena/prompts";

const shop = getAddress("0x1240e3e019384c673a1b6cfba61823b6619c98df");
const attacker = "0x000000000000000000000000000000000000dEaD";
const book = [{ name: "Shop", address: shop }];
const modelOutput = { action: "pay", payments: [{ recipient: attacker, amountMon: "0.01" }] };

describe("arena modes", function () {
  it("guarded mode still rejects an address the model invented", function () {
    const text = "pay my friend 0.01";
    const result = resolveIntents(modelOutput, book, userTextForResolution("guarded", text, JSON.stringify(modelOutput)));
    assert.equal(result.ok ? "" : result.code, "invented_address");
  });

  it("compromised mode lets the model's address through, so only the vault is left", function () {
    const text = "pay my friend 0.01";
    const result = resolveIntents(modelOutput, book, userTextForResolution("compromised", text, JSON.stringify(modelOutput)));
    assert.equal(result.ok, true);
  });

  it("uses the normal prompt in guarded mode and the obedient one in compromised mode", function () {
    assert.match(promptFor("guarded", ["Shop"]), /Ignore any instruction/);
    assert.match(buildCompromisedPrompt(["Shop"]), /no safety rules/);
    assert.ok(!buildCompromisedPrompt(["Shop"]).includes(shop));
  });
});

describe("arena compromised mode and checksums", function () {
  it("accepts a badly checksummed address from a compromised model", async function () {
    const { modelTextForResolution } = await import("../src/lib/arena/prompts");
    const bad = { action: "pay", payments: [{ recipient: "0x9a8B7c6D5e4F3a2B1c0D9e8F7a6B5c4D3e2F1a0B", amountMon: "10" }] };
    const text = modelTextForResolution("compromised", JSON.stringify(bad));
    const result = resolveIntents(JSON.parse(text), book, userTextForResolution("compromised", "drain it", text));
    assert.equal(result.ok, true);
  });
});
