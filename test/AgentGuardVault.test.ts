import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { parseEther, zeroHash } from "viem";

async function waitForReceipt(publicClient: any, transaction: Promise<`0x${string}`>) {
  const hash = await transaction;
  return publicClient.waitForTransactionReceipt({ hash });
}

async function deployFixture(viem: any, publicClient: any) {
  const [owner, agentSigner, recipient, other] = await viem.getWalletClients();
  const registry = await viem.deployContract("AgentRegistry");
  const vault = await viem.deployContract("AgentGuardVault", [registry.address]);
  const agentId = BigInt(1);

  await waitForReceipt(
    publicClient,
    registry.write.createAgent([agentSigner.account.address, zeroHash], {
      account: owner.account,
    }),
  );
  await waitForReceipt(
    publicClient,
    vault.write.configurePolicy([agentId, parseEther("1"), parseEther("2")], {
      account: owner.account,
    }),
  );
  await waitForReceipt(
    publicClient,
    vault.write.setRecipientApproval([agentId, recipient.account.address, true], {
      account: owner.account,
    }),
  );
  await waitForReceipt(
    publicClient,
    vault.write.deposit([agentId], {
      account: owner.account,
      value: parseEther("5"),
    }),
  );

  return { owner, agentSigner, recipient, other, registry, vault, agentId };
}

describe("AgentGuardVault", async function () {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();

  it("executes an allowed payment and emits a reconstructable receipt", async function () {
    const { agentSigner, recipient, vault, agentId } = await deployFixture(viem, publicClient);
    const amount = parseEther("0.4");
    const requestId = `0x${"01".repeat(32)}` as `0x${string}`;
    const before = await publicClient.getBalance({ address: recipient.account.address });

    const receipt = await waitForReceipt(
      publicClient,
      vault.write.executePayment(
        [agentId, requestId, recipient.account.address, amount],
        { account: agentSigner.account },
      ),
    );

    const events = await publicClient.getContractEvents({
      address: vault.address,
      abi: vault.abi,
      eventName: "PaymentExecuted",
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
      strict: true,
    });
    const event = events[0] as unknown as {
      args: {
        agentId: bigint;
        requestId: `0x${string}`;
        signer: `0x${string}`;
        recipient: `0x${string}`;
        amount: bigint;
        policyVersion: bigint;
      };
    };
    const after = await publicClient.getBalance({ address: recipient.account.address });

    assert.equal(after - before, amount);
    assert.equal(event.args.agentId, agentId);
    assert.equal(event.args.requestId, requestId);
    assert.equal(event.args.signer.toLowerCase(), agentSigner.account.address.toLowerCase());
    assert.equal(event.args.recipient.toLowerCase(), recipient.account.address.toLowerCase());
    assert.equal(event.args.amount, amount);
    assert.equal(event.args.policyVersion, BigInt(2));
  });

  it("rejects wrong signers, unapproved recipients, and ownerless policy changes", async function () {
    const { owner, agentSigner, recipient, other, registry, vault, agentId } =
      await deployFixture(viem, publicClient);
    const amount = parseEther("0.2");
    const firstRequestId = `0x${"02".repeat(32)}` as `0x${string}`;
    const secondRequestId = `0x${"03".repeat(32)}` as `0x${string}`;

    await assert.rejects(() =>
      vault.write.executePayment(
        [agentId, firstRequestId, recipient.account.address, amount],
        { account: other.account },
      ),
    );

    await assert.rejects(() =>
      vault.write.executePayment(
        [agentId, secondRequestId, other.account.address, amount],
        { account: agentSigner.account },
      ),
    );

    await assert.rejects(() =>
      vault.write.setPaused([agentId, true], { account: other.account }),
    );
    await assert.rejects(() =>
      registry.write.setActive([agentId, false], { account: other.account }),
    );

    await waitForReceipt(
      publicClient,
      registry.write.setActive([agentId, false], { account: owner.account }),
    );
    await assert.rejects(() =>
      vault.write.executePayment(
        [agentId, `0x${"0b".repeat(32)}` as `0x${string}`, recipient.account.address, amount],
        { account: agentSigner.account },
      ),
    );
    await waitForReceipt(
      publicClient,
      registry.write.setActive([agentId, true], { account: owner.account }),
    );

    await waitForReceipt(
      publicClient,
      vault.write.setPaused([agentId, true], { account: owner.account }),
    );
    await assert.rejects(() =>
      vault.write.executePayment(
        [agentId, `0x${"04".repeat(32)}` as `0x${string}`, recipient.account.address, amount],
        { account: agentSigner.account },
      ),
    );
  });

  it("enforces per-payment, daily, and duplicate-request limits", async function () {
    const { agentSigner, recipient, vault, agentId } = await deployFixture(viem, publicClient);
    const tooLarge = parseEther("1.1");
    const allowed = parseEther("1");
    const requestId = `0x${"05".repeat(32)}` as `0x${string}`;

    await assert.rejects(() =>
      vault.write.executePayment(
        [agentId, requestId, recipient.account.address, tooLarge],
        { account: agentSigner.account },
      ),
    );

    await waitForReceipt(
      publicClient,
      vault.write.executePayment(
        [agentId, requestId, recipient.account.address, allowed],
        { account: agentSigner.account },
      ),
    );

    await assert.rejects(() =>
      vault.write.executePayment(
        [agentId, requestId, recipient.account.address, allowed],
        { account: agentSigner.account },
      ),
    );

    await waitForReceipt(
      publicClient,
      vault.write.executePayment(
        [agentId, `0x${"06".repeat(32)}` as `0x${string}`, recipient.account.address, allowed],
        { account: agentSigner.account },
      ),
    );

    await assert.rejects(() =>
      vault.write.executePayment(
        [agentId, `0x${"06".repeat(32)}` as `0x${string}`, recipient.account.address, allowed],
        { account: agentSigner.account },
      ),
    );
  });

  it("reports DailyLimitExceeded, not an arithmetic panic, after the owner lowers the daily limit", async function () {
    const { owner, agentSigner, recipient, vault, agentId } = await deployFixture(viem, publicClient);

    await waitForReceipt(
      publicClient,
      vault.write.executePayment(
        [agentId, `0x${"0b".repeat(32)}` as `0x${string}`, recipient.account.address, parseEther("1")],
        { account: agentSigner.account },
      ),
    );
    // 1 MON already spent today; the owner tightens the daily limit to 0.5 MON.
    await waitForReceipt(
      publicClient,
      vault.write.configurePolicy([agentId, parseEther("0.5"), parseEther("0.5")], {
        account: owner.account,
      }),
    );

    await assert.rejects(
      () =>
        vault.write.executePayment(
          [agentId, `0x${"0c".repeat(32)}` as `0x${string}`, recipient.account.address, parseEther("0.1")],
          { account: agentSigner.account },
        ),
      (error: Error) => {
        assert.match(error.message, /DailyLimitExceeded/);
        return true;
      },
    );
  });

  it("resets the daily allowance on the next UTC day", async function () {
    const { agentSigner, recipient, vault, agentId } = await deployFixture(viem, publicClient);
    const amount = parseEther("1");

    await waitForReceipt(
      publicClient,
      vault.write.executePayment(
        [agentId, `0x${"07".repeat(32)}` as `0x${string}`, recipient.account.address, amount],
        { account: agentSigner.account },
      ),
    );
    await waitForReceipt(
      publicClient,
      vault.write.executePayment(
        [agentId, `0x${"08".repeat(32)}` as `0x${string}`, recipient.account.address, amount],
        { account: agentSigner.account },
      ),
    );

    await publicClient.request({ method: "evm_increaseTime", params: [86401] } as never);
    await publicClient.request({ method: "evm_mine", params: [] } as never);

    await waitForReceipt(
      publicClient,
      vault.write.executePayment(
        [agentId, `0x${"0a".repeat(32)}` as `0x${string}`, recipient.account.address, amount],
        { account: agentSigner.account },
      ),
    );
  });

  it("does not leave funds spent when the recipient rejects the transfer", async function () {
    const { owner, agentSigner, vault, agentId } = await deployFixture(viem, publicClient);
    const rejectingRecipient = await viem.deployContract("RejectingRecipient");
    const amount = parseEther("0.3");
    const requestId = `0x${"09".repeat(32)}` as `0x${string}`;

    await waitForReceipt(
      publicClient,
      vault.write.setRecipientApproval([agentId, rejectingRecipient.address, true], {
        account: owner.account,
      }),
    );

    await assert.rejects(() =>
      vault.write.executePayment(
        [agentId, requestId, rejectingRecipient.address, amount],
        { account: agentSigner.account },
      ),
    );

    const balance = await publicClient.readContract({
      address: vault.address,
      abi: vault.abi,
      functionName: "vaultBalance",
      args: [agentId],
    });
    const used = await publicClient.readContract({
      address: vault.address,
      abi: vault.abi,
      functionName: "requestUsed",
      args: [agentId, requestId],
    });

    assert.equal(balance, parseEther("5"));
    assert.equal(used, false);
  });

  it("rejects direct native-MON transfers without an agent context", async function () {
    const { other, vault } = await deployFixture(viem, publicClient);

    await assert.rejects(() =>
      other.sendTransaction({
        to: vault.address,
        value: parseEther("0.1"),
      }),
    );
  });
});
