import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, it } from "node:test";
import { parseEther, type Hex } from "viem";
import { createEnvelope, encodeEnvelope, envelopeRequestId } from "../src/lib/receipts";
import { challengeRequestId, type PaymentChallenge } from "../src/lib/x402/challenge";
import * as mcp from "../mcp/lib.mjs";

const envelope = createEnvelope({
  chainId: 10143,
  vault: "0xbdbb2b644d79ac3f5a5282e52050e9b5e563a202",
  agentId: BigInt(9),
  recipient: "0x1240e3e019384c673a1b6cfba61823b6619c98df",
  amountWei: parseEther("0.01"),
  salt: `0x${"ab".repeat(32)}` as Hex,
  source: { provider: "MCP", model: "test-client", prompt: "coffee", memo: "coffee", recipientName: "Shop" },
});
const challenge: PaymentChallenge = {
  scheme: "agentshield-vault",
  network: "monad-testnet",
  chainId: 10143,
  asset: "MON",
  amountWei: "2000000000000000",
  payTo: "0x1240E3e019384c673a1b6CFbA61823b6619C98Df",
  resource: "/api/x402/data",
  description: "snapshot",
  nonce: "0x1bc69d90cd5239cc56a2ab0c7d068dea",
  expiresAt: 1791833154,
};

describe("MCP server helpers match the app", function () {
  it("hashes request envelopes identically, so MCP receipts verify on the receipt page", function () {
    assert.equal(mcp.envelopeRequestId(envelope), envelopeRequestId(envelope));
    assert.equal(mcp.encodeEnvelope(envelope), encodeEnvelope(envelope));
  });

  it("hashes x402 challenges identically", function () {
    assert.equal(mcp.challengeRequestId(challenge), challengeRequestId(challenge));
  });

  it("parses MON amounts strictly", function () {
    assert.equal(mcp.parseMon("0.05"), parseEther("0.05"));
    assert.throws(() => mcp.parseMon("1e-7"));
  });

  it("speaks MCP over stdio: initialize, tools/list, and a clear error without configuration", async function () {
    const child = spawn(process.execPath, ["mcp/server.mjs"], {
      env: { ...process.env, AGENTSHIELD_AGENT_PRIVATE_KEY: "", AGENTSHIELD_AGENT_ID: "" },
    }) as unknown as ChildProcessWithoutNullStreams;
    const lines: unknown[] = [];
    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) if (part.trim()) lines.push(JSON.parse(part));
    });
    const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "test" }, capabilities: {} } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "agentshield_status", arguments: {} } });
    const deadline = Date.now() + 5000;
    while (lines.length < 3 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    child.kill();
    const [init, list, call] = lines as { result: Record<string, unknown> }[];
    assert.equal((init.result.serverInfo as { name: string }).name, "agentshield");
    assert.equal((list.result.tools as unknown[]).length, 4);
    assert.equal(call.result.isError, true);
    assert.match(JSON.stringify(call.result.content), /AGENTSHIELD_AGENT_PRIVATE_KEY/);
  });
});
