import { network } from "hardhat";
import { formatEther, getAddress, isAddress, type Address } from "viem";

/**
 * Withdraws every agent balance the deployer owns from a vault back to the deployer.
 * Use before switching the app to a freshly deployed vault.
 *
 *   WITHDRAW_VAULT=0x... npm run contracts:withdraw:testnet
 * Without WITHDRAW_VAULT it uses NEXT_PUBLIC_VAULT_CONTRACT_ADDRESS from .env.
 */
const target = process.env.WITHDRAW_VAULT || process.env.NEXT_PUBLIC_VAULT_CONTRACT_ADDRESS;
if (!target || !isAddress(target)) throw new Error("Set WITHDRAW_VAULT or NEXT_PUBLIC_VAULT_CONTRACT_ADDRESS to the vault address.");

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const [owner] = await viem.getWalletClients();
const vault = await viem.getContractAt("AgentGuardVault", getAddress(target));
const registryAddress = getAddress((await vault.read.registry()) as Address);
const registry = await viem.getContractAt("AgentRegistry", registryAddress);

const nextAgentId = (await registry.read.nextAgentId()) as bigint;
console.log(`Vault ${vault.address} · registry ${registry.address} · owner ${owner.account.address}`);

let total = BigInt(0);
for (let id = BigInt(1); id < nextAgentId; id += BigInt(1)) {
  const agentOwner = getAddress((await registry.read.ownerOf([id])) as Address);
  const balance = (await vault.read.vaultBalance([id])) as bigint;
  if (agentOwner.toLowerCase() !== owner.account.address.toLowerCase()) {
    console.log(`Agent #${id}: owned by someone else, skipped.`);
    continue;
  }
  if (balance === BigInt(0)) {
    console.log(`Agent #${id}: empty.`);
    continue;
  }
  const hash = await vault.write.withdraw([id, owner.account.address, balance], { account: owner.account });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Withdraw for agent #${id} reverted: ${hash}`);
  total += balance;
  console.log(`Agent #${id}: withdrew ${formatEther(balance)} MON · tx ${hash}`);
}
console.log(`Done. Returned ${formatEther(total)} MON to ${owner.account.address}.`);
