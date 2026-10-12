/**
 * One-time (and occasional top-up) setup for `npm run e2e` on a live network.
 *
 * Creates two persistent test wallets if they do not exist yet and stores their
 * keys in .env (git-ignored, testnet-only):
 *   E2E_AGENT_PRIVATE_KEY  signs payments as the test agent; needs a little MON for gas
 *   E2E_SHOP_PRIVATE_KEY   receives test payments
 * Then tops the agent up to 0.3 MON from the owner (PRIVATE_KEY) and sweeps the
 * shop's accumulated test payments back to the owner.
 *
 * Why: on Monad testnet a brand-new wallet could not send transactions until
 * roughly 25-40 seconds after its first funding, so tests reuse warmed-up wallets.
 *
 * Run: npm run e2e:setup   (then wait about a minute before the first npm run e2e)
 */
import "dotenv/config";
import { appendFileSync, readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, defineChain, formatEther, http, parseEther, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const RPC_URL = process.env.E2E_RPC_URL || process.env.MONAD_TESTNET_RPC_URL || "https://testnet-rpc.monad.xyz";
const TARGET_AGENT_GAS = parseEther("0.3");
const TOP_UP_BELOW = parseEther("0.15");
const SWEEP_SHOP_ABOVE = parseEther("0.05");

// MetaMask exports keys without the 0x prefix; accept both.
const rawOwnerKey = (process.env.PRIVATE_KEY ?? "").trim().replace(/^"|"$/g, "");
const ownerKey = (rawOwnerKey.startsWith("0x") ? rawOwnerKey : `0x${rawOwnerKey}`) as Hex;
if (!/^0x[0-9a-fA-F]{64}$/.test(ownerKey)) throw new Error("PRIVATE_KEY in .env must be 64 hex characters (with or without 0x).");

function ensureKey(name: string): Hex {
  const existing = process.env[name];
  if (existing && /^0x[0-9a-fA-F]{64}$/.test(existing)) return existing as Hex;
  const key = generatePrivateKey();
  const env = readFileSync(".env", "utf8");
  appendFileSync(".env", `${env.endsWith("\n") ? "" : "\n"}${name}=${key}\n`);
  console.log(`Created ${name} and saved it to .env (testnet-only test wallet).`);
  return key;
}

async function main() {
  const probe = createPublicClient({ transport: http(RPC_URL) });
  const chainId = await probe.getChainId();
  const chain = defineChain({
    id: chainId,
    name: `Chain ${chainId}`,
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

  const owner = privateKeyToAccount(ownerKey!);
  const agent = privateKeyToAccount(ensureKey("E2E_AGENT_PRIVATE_KEY"));
  const shop = privateKeyToAccount(ensureKey("E2E_SHOP_PRIVATE_KEY"));

  const agentBalance = await publicClient.getBalance({ address: agent.address });
  console.log(`Test agent ${agent.address}: ${formatEther(agentBalance)} MON`);
  if (agentBalance < TOP_UP_BELOW) {
    const amount = TARGET_AGENT_GAS - agentBalance;
    const hash = await createWalletClient({ account: owner, chain, transport: http(RPC_URL) }).sendTransaction({
      to: agent.address,
      value: amount,
      gas: BigInt(21_000),
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`Top-up reverted: ${hash}`);
    console.log(`  topped up with ${formatEther(amount)} MON · tx ${hash}`);
  }

  const shopBalance = await publicClient.getBalance({ address: shop.address });
  console.log(`Test shop  ${shop.address}: ${formatEther(shopBalance)} MON`);
  if (shopBalance > SWEEP_SHOP_ABOVE) {
    const fee = BigInt(21_000) * (await publicClient.getGasPrice()) * BigInt(3);
    try {
      const hash = await createWalletClient({ account: shop, chain, transport: http(RPC_URL) }).sendTransaction({
        to: owner.address,
        value: shopBalance - fee,
        gas: BigInt(21_000),
      });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`  returned ${formatEther(shopBalance - fee)} MON to the owner · tx ${hash}`);
    } catch (error) {
      console.log(`  could not sweep the shop yet (${error instanceof Error ? error.message.split("\n")[0] : error}); try again later.`);
    }
  }

  console.log("\nReady. If a wallet was just created or funded, wait about a minute, then run: npm run e2e");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
