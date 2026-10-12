import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { keccak256, parseEther, stringToBytes, zeroHash } from "viem";

const MANDATE_TYPES = {
  Mandate: [
    { name: "agentId", type: "uint256" },
    { name: "agentKey", type: "address" },
    { name: "recipient", type: "address" },
    { name: "maxTotal", type: "uint256" },
    { name: "maxPerPayment", type: "uint256" },
    { name: "validAfter", type: "uint64" },
    { name: "validUntil", type: "uint64" },
    { name: "purposeHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

type Mandate = {
  agentId: bigint;
  agentKey: `0x${string}`;
  recipient: `0x${string}`;
  maxTotal: bigint;
  maxPerPayment: bigint;
  validAfter: bigint;
  validUntil: bigint;
  purposeHash: `0x${string}`;
  nonce: bigint;
};

let requestCounter = 0;
const nextRequestId = () => `0x${(++requestCounter).toString(16).padStart(64, "0")}` as `0x${string}`;

async function expectRevert(action: () => Promise<unknown>, name: string) {
  await assert.rejects(action, (error: Error) => {
    assert.match(error.message, new RegExp(name));
    return true;
  });
}

describe("MandateExecutor", async function () {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const wait = async (hash: Promise<`0x${string}`>) => publicClient.waitForTransactionReceipt({ hash: await hash });

  async function fixture() {
    const [owner, agentKey, recipient, stranger, unapproved] = await viem.getWalletClients();
    const registry = await viem.deployContract("AgentRegistry");
    const vault = await viem.deployContract("AgentGuardVault", [registry.address]);
    const executor = await viem.deployContract("MandateExecutor", [registry.address, vault.address]);
    // Agent 1 is wired to the executor: it can only pay through mandates.
    await wait(registry.write.createAgent([executor.address, zeroHash], { account: owner.account }));
    const agentId = BigInt(1);
    await wait(vault.write.configurePolicy([agentId, parseEther("1"), parseEther("2")], { account: owner.account }));
    await wait(vault.write.setRecipientApproval([agentId, recipient.account.address, true], { account: owner.account }));
    await wait(vault.write.deposit([agentId], { account: owner.account, value: parseEther("5") }));
    const now = (await publicClient.getBlock()).timestamp;
    const mandate: Mandate = {
      agentId,
      agentKey: agentKey.account.address,
      recipient: recipient.account.address,
      maxTotal: parseEther("0.5"),
      maxPerPayment: parseEther("0.3"),
      validAfter: now - BigInt(60),
      validUntil: now + BigInt(3600),
      purposeHash: keccak256(stringToBytes("weekly groceries")),
      nonce: BigInt(1),
    };
    const sign = (signer: typeof owner, value: Mandate) =>
      signer.signTypedData({
        account: signer.account,
        domain: { name: "AgentShield Mandates", version: "1", chainId: 31337, verifyingContract: executor.address },
        types: MANDATE_TYPES,
        primaryType: "Mandate",
        message: value,
      });
    return { owner, agentKey, recipient, stranger, unapproved, registry, vault, executor, agentId, mandate, sign };
  }

  it("pays under an owner-signed mandate, with the vault recording the executor as signer", async function () {
    const { owner, agentKey, recipient, vault, executor, mandate, sign } = await fixture();
    const signature = await sign(owner, mandate);
    const before = await publicClient.getBalance({ address: recipient.account.address });
    await wait(executor.write.execute([mandate, signature, nextRequestId(), parseEther("0.2")], { account: agentKey.account }));
    assert.equal((await publicClient.getBalance({ address: recipient.account.address })) - before, parseEther("0.2"));
    const digest = await executor.read.mandateHash([mandate]);
    assert.equal(await executor.read.spentUnder([digest]), parseEther("0.2"));
    assert.equal(await executor.read.remaining([mandate]), parseEther("0.3"));
    assert.equal(await vault.read.vaultBalance([BigInt(1)]), parseEther("4.8"));
  });

  it("only lets the named agent key use the mandate", async function () {
    const { owner, stranger, executor, mandate, sign } = await fixture();
    const signature = await sign(owner, mandate);
    await expectRevert(async () => executor.write.execute([mandate, signature, nextRequestId(), parseEther("0.1")], { account: stranger.account }), "NotMandateAgent");
  });

  it("rejects mandates not signed by the agent's owner, and mandates edited after signing", async function () {
    const { owner, stranger, agentKey, executor, mandate, sign } = await fixture();
    const forged = await sign(stranger, mandate);
    await expectRevert(async () => executor.write.execute([mandate, forged, nextRequestId(), parseEther("0.1")], { account: agentKey.account }), "NotSignedByOwner");
    const genuine = await sign(owner, mandate);
    const inflated = { ...mandate, maxTotal: parseEther("4") };
    await expectRevert(async () => executor.write.execute([inflated, genuine, nextRequestId(), parseEther("0.1")], { account: agentKey.account }), "NotSignedByOwner");
  });

  it("enforces the mandate's own per-payment cap and total budget", async function () {
    const { owner, agentKey, executor, mandate, sign } = await fixture();
    const signature = await sign(owner, mandate);
    await expectRevert(async () => executor.write.execute([mandate, signature, nextRequestId(), parseEther("0.31")], { account: agentKey.account }), "MandatePerPaymentExceeded");
    await wait(executor.write.execute([mandate, signature, nextRequestId(), parseEther("0.3")], { account: agentKey.account }));
    await expectRevert(async () => executor.write.execute([mandate, signature, nextRequestId(), parseEther("0.25")], { account: agentKey.account }), "MandateBudgetExceeded");
    await wait(executor.write.execute([mandate, signature, nextRequestId(), parseEther("0.2")], { account: agentKey.account }));
    assert.equal(await executor.read.remaining([mandate]), BigInt(0));
  });

  it("refuses expired, not-yet-valid and revoked mandates; only the owner can revoke", async function () {
    const { owner, agentKey, stranger, executor, mandate, sign } = await fixture();
    const now = (await publicClient.getBlock()).timestamp;
    const expired = { ...mandate, validUntil: now - BigInt(1) };
    await expectRevert(async () => executor.write.execute([expired, await sign(owner, expired), nextRequestId(), parseEther("0.1")], { account: agentKey.account }), "MandateExpired");
    const future = { ...mandate, validAfter: now + BigInt(3600), validUntil: now + BigInt(7200) };
    await expectRevert(async () => executor.write.execute([future, await sign(owner, future), nextRequestId(), parseEther("0.1")], { account: agentKey.account }), "MandateNotYetValid");

    const signature = await sign(owner, mandate);
    await expectRevert(async () => executor.write.revoke([mandate], { account: stranger.account }), "NotAgentOwner");
    await wait(executor.write.revoke([mandate], { account: owner.account }));
    await expectRevert(async () => executor.write.execute([mandate, signature, nextRequestId(), parseEther("0.1")], { account: agentKey.account }), "MandateRevoked");
    assert.equal(await executor.read.remaining([mandate]), BigInt(0));
  });

  it("still applies the vault's standing policy on top of the mandate", async function () {
    const { owner, agentKey, unapproved, vault, executor, mandate, sign, agentId } = await fixture();
    const toStranger = { ...mandate, recipient: unapproved.account.address, nonce: BigInt(2) };
    await expectRevert(async () => executor.write.execute([toStranger, await sign(owner, toStranger), nextRequestId(), parseEther("0.1")], { account: agentKey.account }), "RecipientNotApproved");

    await wait(vault.write.configurePolicy([agentId, parseEther("0.1"), parseEther("2")], { account: owner.account }));
    const signature = await sign(owner, mandate);
    await expectRevert(async () => executor.write.execute([mandate, signature, nextRequestId(), parseEther("0.2")], { account: agentKey.account }), "PerPaymentLimitExceeded");

    await wait(vault.write.setPaused([agentId, true], { account: owner.account }));
    await expectRevert(async () => executor.write.execute([mandate, signature, nextRequestId(), parseEther("0.05")], { account: agentKey.account }), "AgentPaused");
    // A refused payment leaves the mandate budget untouched.
    assert.equal(await executor.read.remaining([mandate]), parseEther("0.5"));
  });

  it("blocks replayed request IDs and direct vault calls by the agent key", async function () {
    const { owner, agentKey, recipient, vault, executor, mandate, sign, agentId } = await fixture();
    const signature = await sign(owner, mandate);
    const requestId = nextRequestId();
    await wait(executor.write.execute([mandate, signature, requestId, parseEther("0.1")], { account: agentKey.account }));
    await expectRevert(async () => executor.write.execute([mandate, signature, requestId, parseEther("0.1")], { account: agentKey.account }), "DuplicateRequest");
    await expectRevert(
      async () => vault.write.executePayment([agentId, nextRequestId(), recipient.account.address, parseEther("0.1")], { account: agentKey.account }),
      "UnauthorizedSigner",
    );
  });

  it("refuses agents that are not wired to the executor", async function () {
    const { owner, agentKey, registry, executor, mandate, sign } = await fixture();
    await wait(registry.write.createAgent([agentKey.account.address, zeroHash], { account: owner.account }));
    const other = { ...mandate, agentId: BigInt(2) };
    await expectRevert(async () => executor.write.execute([other, await sign(owner, other), nextRequestId(), parseEther("0.1")], { account: agentKey.account }), "AgentNotWiredToExecutor");
  });
});
