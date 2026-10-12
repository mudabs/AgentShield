/**
 * One-command setup for signed mandates (testnet).
 *
 *   npm run mandates:setup
 *
 * Uses the owner key in PRIVATE_KEY and the existing registry and vault. Safe to re-run.
 *  1. Deploys MandateExecutor (registry, vault) and saves NEXT_PUBLIC_MANDATE_EXECUTOR_ADDRESS.
 *  2. Registers a "mandate-only" agent whose registry signer is the executor; saves MANDATE_AGENT_ID.
 *  3. Standing caps 0.02 MON per payment and 0.1 MON per day; approves DEMO_ADDRESS_BOOK; deposits 0.2 MON.
 * The demo agent key (DEMO_AGENT_PRIVATE_KEY) is the key that spends under mandates.
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
  type Abi,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "../src/lib/monad";
import { registryAbi, registryAddress, vaultAbi, vaultAddress } from "../src/lib/guard";

const RPC_URL = process.env.MONAD_TESTNET_RPC_URL || "https://testnet-rpc.monad.xyz";
const PER_PAYMENT = parseEther("0.02");
const DAILY = parseEther("0.1");
const VAULT_TARGET = parseEther("0.2");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function saveEnv(name: string, value: string) {
  const env = readFileSync(".env", "utf8");
  appendFileSync(".env", `${env.endsWith("\n") ? "" : "\n"}${name}=${value}\n`);
  process.env[name] = value;
  console.log(`  saved ${name} to .env`);
}

async function main() {
  const rawKey = (process.env.PRIVATE_KEY ?? "").trim().replace(/^"|"$/g, "");
  const ownerKey = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(ownerKey)) throw new Error("PRIVATE_KEY in .env must be 64 hex characters (with or without 0x).");
  if (!registryAddress || !vaultAddress) throw new Error("Set the registry and vault addresses in .env.");
  if (!process.env.DEMO_AGENT_PRIVATE_KEY) throw new Error("Run npm run demo:setup first (it creates DEMO_AGENT_PRIVATE_KEY).");

  const owner = privateKeyToAccount(ownerKey);
  const publicClient = createPublicClient({ chain: monadTestnet, transport: http(RPC_URL) });
  const wallet = createWalletClient({ account: owner, chain: monadTestnet, transport: http(RPC_URL) });
  console.log(`Owner ${owner.address} · ${formatEther(await publicClient.getBalance({ address: owner.address }))} MON`);
  const confirm = async (label: string, hash: Hash) => {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
    console.log(`  ${label} · tx ${hash}`);
    return receipt;
  };

  // 1. Executor.
  let executor = process.env.NEXT_PUBLIC_MANDATE_EXECUTOR_ADDRESS as Address | undefined;
  if (!executor || !isAddress(executor)) {
    const artifact = JSON.parse(readFileSync("artifacts/contracts/MandateExecutor.sol/MandateExecutor.json", "utf8")) as { abi: Abi; bytecode: Hex };
    console.log("Deploying MandateExecutor…");
    const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args: [registryAddress, vaultAddress] });
    const receipt = await confirm("executor deployed", hash);
    executor = receipt.contractAddress!;
    saveEnv("NEXT_PUBLIC_MANDATE_EXECUTOR_ADDRESS", executor);
  }
  console.log(`MandateExecutor ${executor}`);

  // 2. Mandate-only agent.
  let agentId = process.env.MANDATE_AGENT_ID && /^\d+$/.test(process.env.MANDATE_AGENT_ID) ? BigInt(process.env.MANDATE_AGENT_ID) : undefined;
  if (agentId === undefined) {
    console.log("Registering the mandate-only agent (signer = executor)…");
    const receipt = await confirm(
      "registered",
      await wallet.writeContract({
        address: registryAddress,
        abi: registryAbi,
        functionName: "createAgent",
        args: [executor, keccak256(stringToBytes("AgentShield mandate demo agent"))],
      }),
    );
    agentId = parseEventLogs({ abi: registryAbi, eventName: "AgentCreated", logs: receipt.logs })[0].args.agentId;
    saveEnv("MANDATE_AGENT_ID", agentId.toString());
  }
  console.log(`Mandate agent #${agentId}`);

  // 3. Standing caps, recipients, funds.
  const [perPayment, daily] = await publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "getPolicy", args: [agentId] });
  if (perPayment !== PER_PAYMENT || daily !== DAILY) {
    await confirm("caps set", await wallet.writeContract({ address: vaultAddress, abi: vaultAbi, functionName: "configurePolicy", args: [agentId, PER_PAYMENT, DAILY] }));
  }
  for (const pair of (process.env.DEMO_ADDRESS_BOOK ?? "").split(",")) {
    const [name, address] = pair.split(":").map((part) => part.trim());
    if (!name || !address || !isAddress(address)) continue;
    const recipient = getAddress(address);
    const approved = await publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "approvedRecipients", args: [agentId, recipient] });
    if (!approved) {
      await confirm(`${name} approved`, await wallet.writeContract({ address: vaultAddress, abi: vaultAbi, functionName: "setRecipientApproval", args: [agentId, recipient, true] }));
    }
  }
  const balance = await publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "vaultBalance", args: [agentId] });
  if (balance < VAULT_TARGET) {
    await sleep(4_000);
    await confirm(
      `deposited ${formatEther(VAULT_TARGET - balance)} MON`,
      await wallet.writeContract({ address: vaultAddress, abi: vaultAbi, functionName: "deposit", args: [agentId], value: VAULT_TARGET - balance }),
    );
  }

  console.log(`
Done. Restart npm run dev, then open /mandates and sign a mandate as the owner.
For the deployed site, add: NEXT_PUBLIC_MANDATE_EXECUTOR_ADDRESS=${executor} and MANDATE_AGENT_ID=${agentId}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
