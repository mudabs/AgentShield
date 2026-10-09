import { network } from "hardhat";

const { viem } = await network.connect();
const probe = await viem.deployContract("AgentShieldProbe");
const publicClient = await viem.getPublicClient();

console.log(`AgentShieldProbe: ${probe.address}`);
console.log(`Network chain ID: ${await publicClient.getChainId()}`);
