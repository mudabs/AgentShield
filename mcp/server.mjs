#!/usr/bin/env node
/**
 * AgentShield MCP server: gives any MCP-capable AI app (Claude Desktop, Cursor, VS Code
 * agents, ...) a guarded wallet. The AI can check its limits, preview a payment, pay, and
 * pay x402 APIs. Every payment goes through the AgentShield vault on Monad, so the owner's
 * onchain rules apply no matter what the model is told.
 *
 * Transport: stdio, JSON-RPC 2.0, one message per line. No dependencies beyond viem.
 *
 * Environment:
 *   AGENTSHIELD_AGENT_PRIVATE_KEY  the agent's signer key (testnet). Required.
 *   AGENTSHIELD_AGENT_ID           the agent's id in the registry. Required.
 *   AGENTSHIELD_VAULT              vault address. Required.
 *   AGENTSHIELD_REGISTRY           registry address. Required.
 *   AGENTSHIELD_ADDRESS_BOOK       "Shop:0x...,Store:0x..." so the AI can pay by name.
 *   AGENTSHIELD_APP_URL            for receipt links, e.g. https://your-app.vercel.app
 *   MONAD_RPC_URL                  default https://testnet-rpc.monad.xyz
 */
import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";
import { createPublicClient, createWalletClient, defineChain, formatEther, getAddress, http, parseEventLogs, BaseError, ContractFunctionRevertedError } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { registryAbi, vaultAbi } from "./abi.mjs";
import { challengeRequestId, encodeEnvelope, envelopeRequestId, parseAddressBook, parseMon } from "./lib.mjs";

const PROTOCOL_VERSION = "2025-06-18";
const log = (...args) => process.stderr.write(`[agentshield-mcp] ${args.join(" ")}\n`);

function config() {
  const raw = (process.env.AGENTSHIELD_AGENT_PRIVATE_KEY ?? "").trim();
  const key = raw.startsWith("0x") ? raw : `0x${raw}`;
  const missing = [];
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) missing.push("AGENTSHIELD_AGENT_PRIVATE_KEY");
  if (!/^\d+$/.test(process.env.AGENTSHIELD_AGENT_ID ?? "")) missing.push("AGENTSHIELD_AGENT_ID");
  if (!/^0x[0-9a-fA-F]{40}$/.test(process.env.AGENTSHIELD_VAULT ?? "")) missing.push("AGENTSHIELD_VAULT");
  if (!/^0x[0-9a-fA-F]{40}$/.test(process.env.AGENTSHIELD_REGISTRY ?? "")) missing.push("AGENTSHIELD_REGISTRY");
  if (missing.length) throw new Error(`Missing or invalid: ${missing.join(", ")}`);
  const rpc = process.env.MONAD_RPC_URL || "https://testnet-rpc.monad.xyz";
  const chain = defineChain({ id: 10143, name: "Monad Testnet", nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  const account = privateKeyToAccount(key);
  return {
    account,
    agentId: BigInt(process.env.AGENTSHIELD_AGENT_ID),
    vault: getAddress(process.env.AGENTSHIELD_VAULT.toLowerCase()),
    registry: getAddress(process.env.AGENTSHIELD_REGISTRY.toLowerCase()),
    book: parseAddressBook(process.env.AGENTSHIELD_ADDRESS_BOOK),
    appUrl: (process.env.AGENTSHIELD_APP_URL ?? "").replace(/\/$/, ""),
    publicClient: createPublicClient({ chain, transport: http(rpc) }),
    walletClient: createWalletClient({ account, chain, transport: http(rpc) }),
    chain,
  };
}

let cfg;
const getConfig = () => (cfg ??= config());

function revertName(error) {
  if (!(error instanceof BaseError)) return undefined;
  const reverted = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
  return reverted instanceof ContractFunctionRevertedError ? reverted.data?.errorName : undefined;
}

const reasons = {
  RecipientNotApproved: "the recipient is not on the owner's approved list",
  PerPaymentLimitExceeded: "the amount is above the per-payment limit",
  DailyLimitExceeded: "it would go over today's limit (resets 00:00 UTC)",
  AgentPaused: "the owner has paused this agent",
  UnauthorizedSigner: "this key is not the agent's signer, or the agent is inactive",
  InsufficientVaultBalance: "the vault does not hold enough MON",
  DuplicateRequest: "this exact request was already paid",
};

function resolveRecipient(input) {
  const { book } = getConfig();
  const text = String(input ?? "").trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(text)) {
    const address = getAddress(text.toLowerCase());
    return { address, name: book.find((entry) => entry.address === address)?.name };
  }
  const match = book.find((entry) => entry.name.toLowerCase() === text.toLowerCase());
  if (!match) throw new Error(`"${text}" is not in the address book. Known names: ${book.map((entry) => entry.name).join(", ") || "none"}.`);
  return match;
}

async function preview(recipient, amountWei, requestId) {
  const c = getConfig();
  try {
    await c.publicClient.simulateContract({
      account: c.account,
      address: c.vault,
      abi: vaultAbi,
      functionName: "executePayment",
      args: [c.agentId, requestId, recipient, amountWei],
    });
    return { allowed: true };
  } catch (error) {
    const name = revertName(error);
    return { allowed: false, error: name ?? "unknown", reason: reasons[name] ?? (error.shortMessage ?? error.message) };
  }
}

async function send(recipient, amountWei, requestId) {
  const c = getConfig();
  const args = [c.agentId, requestId, recipient, amountWei];
  const gas = await c.publicClient.estimateContractGas({ account: c.account, address: c.vault, abi: vaultAbi, functionName: "executePayment", args });
  const hash = await c.walletClient.writeContract({ address: c.vault, abi: vaultAbi, functionName: "executePayment", args, gas: (gas * 125n) / 100n, chain: c.chain });
  const receipt = await c.publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  const paid = receipt.status === "success" && parseEventLogs({ abi: vaultAbi, eventName: "PaymentExecuted", logs: receipt.logs }).length > 0;
  return { hash, paid };
}

function envelopeFor(recipient, amountWei, memo, clientName) {
  const c = getConfig();
  return {
    v: 1,
    chainId: 10143,
    vault: c.vault,
    agentId: c.agentId.toString(),
    recipient,
    amountWei: amountWei.toString(),
    salt: `0x${randomBytes(32).toString("hex")}`,
    source: { provider: "MCP", model: clientName || "mcp-client", prompt: memo || "(no memo)", ...(memo ? { memo } : {}) },
  };
}

const tools = [
  {
    name: "agentshield_status",
    description: "Show this agent's guarded wallet: vault balance, per-payment and daily limits, what is left today, pause state, and the approved recipients it can pay by name. Call this before planning payments.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "agentshield_preview_payment",
    description: "Ask the AgentShield vault, without sending anything, whether a payment would be allowed. Returns allowed or the exact rule that would refuse it.",
    inputSchema: {
      type: "object",
      properties: {
        recipient: { type: "string", description: "An address-book name such as Shop, or a 0x address" },
        amount_mon: { type: "string", description: 'Amount in MON as a plain decimal, e.g. "0.01"' },
      },
      required: ["recipient", "amount_mon"],
      additionalProperties: false,
    },
  },
  {
    name: "agentshield_pay",
    description: "Pay MON from this agent's AgentShield vault. The vault enforces the owner's recipient list, per-payment limit, daily limit and pause switch onchain; refused payments move nothing. Returns the transaction and a verifiable receipt link.",
    inputSchema: {
      type: "object",
      properties: {
        recipient: { type: "string", description: "An address-book name such as Shop, or a 0x address" },
        amount_mon: { type: "string", description: 'Amount in MON as a plain decimal, e.g. "0.01"' },
        memo: { type: "string", description: "Short reason, recorded in the receipt" },
      },
      required: ["recipient", "amount_mon"],
      additionalProperties: false,
    },
  },
  {
    name: "agentshield_fetch_paid_url",
    description: "Fetch a URL that may require payment (HTTP 402, AgentShield x402 scheme). If the server asks for payment, pay it once through the vault, retry with proof, and return the response. The vault refuses overpriced, redirected or repeated payment requests.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "Full https URL of the paid resource" } },
      required: ["url"],
      additionalProperties: false,
    },
  },
];

async function callTool(name, args, clientName) {
  const c = getConfig();
  if (name === "agentshield_status") {
    const [agent, policy, balance, gas] = await Promise.all([
      c.publicClient.readContract({ address: c.registry, abi: registryAbi, functionName: "getAgent", args: [c.agentId] }),
      c.publicClient.readContract({ address: c.vault, abi: vaultAbi, functionName: "getPolicy", args: [c.agentId] }),
      c.publicClient.readContract({ address: c.vault, abi: vaultAbi, functionName: "vaultBalance", args: [c.agentId] }),
      c.publicClient.getBalance({ address: c.account.address }),
    ]);
    const [perPayment, daily, spent, , version, paused] = policy;
    const approvals = await Promise.all(
      c.book.map((entry) => c.publicClient.readContract({ address: c.vault, abi: vaultAbi, functionName: "approvedRecipients", args: [c.agentId, entry.address] })),
    );
    return {
      agentId: c.agentId.toString(),
      active: agent.active,
      paused,
      signerIsThisKey: getAddress(agent.authorizedSigner) === c.account.address,
      vaultBalanceMon: formatEther(balance),
      perPaymentLimitMon: formatEther(perPayment),
      dailyLimitMon: formatEther(daily),
      spentTodayMon: formatEther(spent),
      leftTodayMon: formatEther(daily > spent ? daily - spent : 0n),
      policyVersion: version.toString(),
      gasWalletMon: formatEther(gas),
      recipients: c.book.map((entry, index) => ({ name: entry.name, address: entry.address, approved: approvals[index] })),
    };
  }
  if (name === "agentshield_preview_payment" || name === "agentshield_pay") {
    const { address, name: recipientName } = resolveRecipient(args.recipient);
    const amountWei = parseMon(args.amount_mon);
    const envelope = envelopeFor(address, amountWei, args.memo, clientName);
    if (recipientName) envelope.source.recipientName = recipientName;
    const requestId = envelopeRequestId(envelope);
    const verdict = await preview(address, amountWei, requestId);
    if (name === "agentshield_preview_payment" || !verdict.allowed) {
      return { recipient: recipientName ?? address, amountMon: args.amount_mon, ...verdict, sent: false };
    }
    const result = await send(address, amountWei, requestId);
    const receipt = c.appUrl ? `${c.appUrl}/receipt/${result.hash}#e=${encodeEnvelope(envelope)}` : undefined;
    return { recipient: recipientName ?? address, amountMon: args.amount_mon, paid: result.paid, txHash: result.hash, receipt };
  }
  if (name === "agentshield_fetch_paid_url") {
    const url = String(args.url ?? "");
    if (!/^https?:\/\//.test(url)) throw new Error("url must start with http:// or https://");
    const first = await fetch(url, { cache: "no-store" });
    if (first.status !== 402) return { status: first.status, paid: false, body: await first.text().then((text) => text.slice(0, 4000)) };
    const body = await first.json();
    const challenge = body?.accepts?.[0];
    if (!challenge || challenge.scheme !== "agentshield-vault") return { status: 402, paid: false, error: "Unsupported payment scheme", body };
    const recipient = getAddress(challenge.payTo.toLowerCase());
    const amountWei = BigInt(challenge.amountWei);
    const requestId = challengeRequestId(challenge);
    const verdict = await preview(recipient, amountWei, requestId);
    if (!verdict.allowed) {
      return { status: 402, paid: false, asked: { amountMon: formatEther(amountWei), payTo: recipient, description: challenge.description }, refusedBy: "AgentShield vault", ...verdict };
    }
    const result = await send(recipient, amountWei, requestId);
    const proof = Buffer.from(JSON.stringify({ challenge, signature: body.signature, txHash: result.hash }), "utf8").toString("base64");
    const second = await fetch(url, { headers: { "x-payment": proof }, cache: "no-store" });
    return { status: second.status, paid: result.paid, paidMon: formatEther(amountWei), txHash: result.hash, body: await second.text().then((text) => text.slice(0, 4000)) };
  }
  throw new Error(`Unknown tool ${name}`);
}

// JSON-RPC over stdio.
let clientName = "";
const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

async function handle(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    clientName = params?.clientInfo?.name ?? "";
    return write({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "agentshield", version: "0.1.0" },
        instructions: "Guarded wallet for this AI agent. Payments go through the AgentShield vault on Monad Testnet, which enforces the owner's limits and approved recipients onchain.",
      },
    });
  }
  if (method === "notifications/initialized" || method?.startsWith("notifications/")) return;
  if (method === "ping") return write({ jsonrpc: "2.0", id, result: {} });
  if (method === "tools/list") return write({ jsonrpc: "2.0", id, result: { tools } });
  if (method === "tools/call") {
    try {
      const result = await callTool(params?.name, params?.arguments ?? {}, clientName);
      return write({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result } });
    } catch (error) {
      return write({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true } });
    }
  }
  if (id !== undefined) write({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
}

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }
  handle(message).catch((error) => log("handler error:", error.message));
});
log("ready");
