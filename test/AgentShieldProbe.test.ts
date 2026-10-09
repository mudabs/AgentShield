import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";

describe("AgentShieldProbe", async function () {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();

  it("stores and emits a marker update", async function () {
    const probe = await viem.deployContract("AgentShieldProbe");

    const before = await publicClient.readContract({
      address: probe.address,
      abi: probe.abi,
      functionName: "marker",
    });
    assert.equal(before, BigInt(0));

    const transactionHash = await probe.write.setMarker([BigInt(42)]);
    await publicClient.waitForTransactionReceipt({ hash: transactionHash });

    const events = await publicClient.getContractEvents({
      address: probe.address,
      abi: probe.abi,
      eventName: "MarkerUpdated",
      strict: true,
    });
    const lastEvent = events[events.length - 1] as unknown as {
      args: { value: bigint };
    };
    assert.equal(lastEvent.args.value, BigInt(42));

    const after = await publicClient.readContract({
      address: probe.address,
      abi: probe.abi,
      functionName: "marker",
    });
    assert.equal(after, BigInt(42));
  });
});
