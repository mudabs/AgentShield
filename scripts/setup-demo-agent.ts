/**
 * One-command setup for the public "Break the Agent" demo (testnet only).
 *
 *   npm run demo:setup
 *
 * Uses the owner key in PRIVATE_KEY. Safe to run again: it only does what is missing.
 *  1. Creates DEMO_AGENT_PRIVATE_KEY (the server-held agent key) in .env if absent.
 *  2. Registers a demo agent with that key as signer and saves DEMO_AGENT_ID.
 *  3. Sets tiny limits: 0.01 MON per payment, 0.05 MON per UTC day.
 *  4. Approves the recipients in DEMO_ADDRESS_BOOK (default: Shop and Store).
 *  5. Tops the vault up to 0.3 MON and the agent's gas wallet up to 0.5 MON.
 *
 * Afterwards copy DEMO_AGENT_PRIVATE_KEY, DEMO_AGENT_ID and DEMO_ADDRESS_BOOK into the
 * hosting provider's server environment variables. Never prefix them with NEXT_PUBLIC_.
 */
import "dotenv/config";
import { appendFileSync, readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  getAddress,
  http,
  isAddress,
  keccak256,
  parseEther,
  parseEventLogs,
  stringToBytes,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "../src/lib/monad";
import { registryAbi, registryAddress, vaultAbi, vaultAddress } from "../src/lib/guard";

const RPC_URL = process.env.MONAD_TESTNET_RPC_URL || "https://testnet-rpc.monad.xyz";
const PER_PAYMENT = parseEther("0.01");
const DAILY = parseEther("0.05");
const VAULT_TARGET = parseEther("0.3");
const GAS_TARGET = parseEther("0.5");
const GAS_TOP_UP_BELOW = parseEther("0.2");
const DEFAULT_BOOK = "Shop:0x1240E3e019384c673a1b6CFbA61823b6619C98Df,Store:0x9F3Bedf793c5bBDB4Cbc7477b83d64552a5bC93d";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function saveEnv(name: string, value: string) {
  const env = readFileSync(".env", "utf8");
  appendFileSync(".env", `${env.endsWith("\n") ? "" : "\n"}${name}=${value}\n`);
  process.env[name] = value;
  console.log(`  saved ${name} to .env`);
}

async function main() {
  // MetaMask exports keys without the 0x prefix; accept both.
  const rawKey = (process.env.PRIVATE_KEY ?? "").trim().replace(/^"|"$/g, "");
  const ownerKey = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(ownerKey)) throw new Error("PRIVATE_KEY in .env must be 64 hex characters (with or without 0x).");
  if (!registryAddress || !vaultAddress) throw new Error("Set NEXT_PUBLIC_REGISTRY_CONTRACT_ADDRESS and NEXT_PUBLIC_VAULT_CONTRACT_ADDRESS in .env.");

  const owner = privateKeyToAccount(ownerKey);
  const publicClient = createPublicClient({ chain: monadTestnet, transport: http(RPC_URL) });
  const wallet = createWalletClient({ account: owner, chain: monadTestnet, transport: http(RPC_URL) });
  console.log(`Owner ${owner.address} · ${formatEther(await publicClient.getBalance({ address: owner.address }))} MON`);

  // Monad reverts value transfers from accounts under 10 MON sent within 3 blocks of
  // their previous transaction, so pause before each one.
  const confirm = async (label: string, hash: Hash) => {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
    console.log(`  ${label} · tx ${hash}`);
    return receipt;
  };

  // 1. Agent key.
  let agentKey = process.env.DEMO_AGENT_PRIVATE_KEY as Hex | undefined;
  if (!agentKey || !/^0x[0-9a-fA-F]{64}$/.test(agentKey)) {
    agentKey = generatePrivateKey();
    console.log("Creating the demo agent key (testnet only)…");
    saveEnv("DEMO_AGENT_PRIVATE_KEY", agentKey);
  }
  const agent = privateKeyToAccount(agentKey);
  console.log(`Demo agent signer ${agent.address}`);

  // 2. Register.
  let agentId = process.env.DEMO_AGENT_ID && /^\d+$/.test(process.env.DEMO_AGENT_ID) ? BigInt(process.env.DEMO_AGENT_ID) : undefined;
  if (agentId !== undefined) {
    const existing = await publicClient.readContract({ address: registryAddress, abi: registryAbi, functionName: "getAgent", args: [agentId] });
    if (getAddress(existing.authorizedSigner) !== agent.address || getAddress(existing.owner) !== owner.address) {
      throw new Error(`DEMO_AGENT_ID=${agentId} does not belong to this owner and signer. Remove it from .env to register a new one.`);
    }
    console.log(`Agent #${agentId} already registered.`);
  } else {
    console.log("Registering the demo agent…");
    const hash = await wallet.writeContract({
      address: registryAddress,
      abi: registryAbi,
      functionName: "createAgent",
      args: [agent.address, keccak256(stringToBytes("AgentShield public demo agent"))],
    });
    const receipt = await confirm("registered", hash);
    const [created] = parseEventLogs({ abi: registryAbi, eventName: "AgentCreated", logs: receipt.logs });
    agentId = created.args.agentId;
    saveEnv("DEMO_AGENT_ID", agentId.toString());
  }

  // 3. Limits.
  const [perPayment, daily] = await publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "getPolicy", args: [agentId] });
  if (perPayment !== PER_PAYMENT || daily !== DAILY) {
    console.log("Setting limits: 0.01 MON per payment, 0.05 MON per day…");
    await confirm(
      "limits set",
      await wallet.writeContract({ address: vaultAddress, abi: vaultAbi, functionName: "configurePolicy", args: [agentId, PER_PAYMENT, DAILY] }),
    );
  }

  // 4. Recipients.
  if (!process.env.DEMO_ADDRESS_BOOK) saveEnv("DEMO_ADDRESS_BOOK", DEFAULT_BOOK);
  const book: { name: string; address: Address }[] = [];
  for (const pair of process.env.DEMO_ADDRESS_BOOK!.split(",")) {
    const [name, address] = pair.split(":").map((part) => part.trim());
    if (name && address && isAddress(address)) book.push({ name, address: getAddress(address) });
  }
  for (const entry of book) {
    const approved = await publicClient.readContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: "approvedRecipients",
      args: [agentId, entry.address],
    });
    if (!approved) {
      console.log(`Approving ${entry.name} ${entry.address}…`);
      await confirm(
        `${entry.name} approved`,
        await wallet.writeContract({ address: vaultAddress, abi: vaultAbi, functionName: "setRecipientApproval", args: [agentId, entry.address, true] }),
      );
    }
  }

  // 5. Funds.
  const vaultBalance = await publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "vaultBalance", args: [agentId] });
  if (vaultBalance < VAULT_TARGET) {
    const amount = VAULT_TARGET - vaultBalance;
    console.log(`Depositing ${formatEther(amount)} MON into the vault…`);
    await sleep(4_000);
    await confirm(
      "deposited",
      await wallet.writeContract({ address: vaultAddress, abi: vaultAbi, functionName: "deposit", args: [agentId], value: amount }),
    );
  }
  const gas = await publicClient.getBalance({ address: agent.address });
  if (gas < GAS_TOP_UP_BELOW) {
    const amount = GAS_TARGET - gas;
    console.log(`Sending ${formatEther(amount)} MON to the agent for gas…`);
    await sleep(4_000);
    await confirm("gas funded", await wallet.sendTransaction({ to: agent.address, value: amount }));
  }

  console.log(`
Done. Demo agent #${agentId} is ready.
Wait about a minute before the first attempt (new Monad accounts need a moment).
For the deployed site, add these server environment variables (no NEXT_PUBLIC_ prefix):
  DEMO_AGENT_PRIVATE_KEY, DEMO_AGENT_ID, DEMO_ADDRESS_BOOK  (copy the values from .env)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
