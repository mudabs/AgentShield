// Starts mcp/server.mjs with the demo agent from .env and exercises its tools over stdio.
import "dotenv/config";
import { spawn } from "node:child_process";

const env = {
  ...process.env,
  AGENTSHIELD_AGENT_PRIVATE_KEY: process.env.DEMO_AGENT_PRIVATE_KEY ?? "",
  AGENTSHIELD_AGENT_ID: process.env.DEMO_AGENT_ID ?? "",
  AGENTSHIELD_VAULT: process.env.NEXT_PUBLIC_VAULT_CONTRACT_ADDRESS ?? "",
  AGENTSHIELD_REGISTRY: process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ADDRESS ?? "",
  AGENTSHIELD_ADDRESS_BOOK: process.env.DEMO_ADDRESS_BOOK ?? "",
  AGENTSHIELD_APP_URL: process.env.AGENTSHIELD_APP_URL ?? "http://localhost:3000",
  MONAD_RPC_URL: process.env.MONAD_TESTNET_RPC_URL ?? "https://testnet-rpc.monad.xyz",
};
const child = spawn(process.execPath, ["mcp/server.mjs"], { env, stdio: ["pipe", "pipe", "inherit"] });
const pending = new Map();
let buffer = "";
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    pending.get(message.id)?.(message);
  }
});
let next = 1;
const request = (method, params) =>
  new Promise((resolve) => {
    const id = next++;
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
const call = async (name, args) => {
  const response = await request("tools/call", { name, arguments: args });
  console.log(`\n> ${name} ${JSON.stringify(args)}\n${response.result.content[0].text}`);
};

await request("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "mcp-smoke" }, capabilities: {} });
await call("agentshield_status", {});
await call("agentshield_preview_payment", { recipient: "Shop", amount_mon: "0.005" });
await call("agentshield_preview_payment", { recipient: "0x000000000000000000000000000000000000dEaD", amount_mon: "0.005" });
await call("agentshield_fetch_paid_url", { url: `${env.AGENTSHIELD_APP_URL}/api/x402/evil?attack=overcharge` });
await call("agentshield_fetch_paid_url", { url: `${env.AGENTSHIELD_APP_URL}/api/x402/data` });
child.kill();
