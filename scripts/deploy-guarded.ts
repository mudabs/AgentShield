import { network } from "hardhat";
import { getAddress, type Address } from "viem";

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const [deployer] = await viem.getWalletClients();

const registry = await viem.deployContract("AgentRegistry");
const vault = await viem.deployContract("AgentGuardVault", [registry.address]);
const linkedRegistry = getAddress((await vault.read.registry()) as Address);

if (linkedRegistry.toLowerCase() !== registry.address.toLowerCase()) {
  throw new Error(`Vault registry mismatch: expected ${registry.address}, got ${linkedRegistry}`);
}

console.log(`Deployer: ${deployer.account.address}`);
console.log(`Network chain ID: ${await publicClient.getChainId()}`);
console.log(`AgentRegistry: ${registry.address}`);
console.log(`AgentGuardVault: ${vault.address}`);
console.log(`Vault registry link verified: ${linkedRegistry}`);
console.log("Next: copy the two contract addresses into the browser environment configuration.");
