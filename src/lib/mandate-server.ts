import { formatEther, getAddress, recoverTypedDataAddress, type Address, type Hex } from "viem";
import { registryAbi, registryAddress, vaultAbi, vaultAddress } from "./guard";
import { mandateExecutorAbi, mandateExecutorAddress } from "./mandate-abi";
import { MANDATE_TYPES, mandateDigest, mandateDomain, parseMandate, purposeHashOf, type Mandate, type StoredMandate } from "./mandates";
import { listMandates, saveMandate } from "./mandate-store";
import { arenaConfig } from "./arena/agent";
import { serverPublicClient } from "./server-chain";

export function mandateConfig() {
  const agentId = process.env.MANDATE_AGENT_ID;
  const demo = arenaConfig();
  if (!mandateExecutorAddress || !registryAddress || !vaultAddress || !agentId || !/^\d+$/.test(agentId) || !demo) return undefined;
  return { executor: mandateExecutorAddress, agentId: BigInt(agentId), agentKey: demo.account.address, book: demo.book };
}

export async function mandatesOverview() {
  const config = mandateConfig();
  if (!config) return { configured: false as const };
  const client = serverPublicClient();
  const [agent, policy, balance, approvals, stored] = await Promise.all([
    client.readContract({ address: registryAddress!, abi: registryAbi, functionName: "getAgent", args: [config.agentId] }),
    client.readContract({ address: vaultAddress!, abi: vaultAbi, functionName: "getPolicy", args: [config.agentId] }),
    client.readContract({ address: vaultAddress!, abi: vaultAbi, functionName: "vaultBalance", args: [config.agentId] }),
    Promise.all(
      config.book.map((entry) =>
        client.readContract({ address: vaultAddress!, abi: vaultAbi, functionName: "approvedRecipients", args: [config.agentId, entry.address] }),
      ),
    ),
    listMandates(),
  ]);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const mandates = await Promise.all(
    stored.map(async (entry) => {
      const mandate = parseMandate(entry.mandate)!;
      const [spent, revoked] = await Promise.all([
        client.readContract({ address: config.executor, abi: mandateExecutorAbi, functionName: "spentUnder", args: [entry.id] }),
        client.readContract({ address: config.executor, abi: mandateExecutorAbi, functionName: "revoked", args: [entry.id] }),
      ]);
      const status = revoked ? "revoked" : now > mandate.validUntil ? "expired" : now < mandate.validAfter ? "not yet valid" : spent >= mandate.maxTotal ? "used up" : "active";
      return {
        ...entry,
        spentMon: formatEther(spent),
        remainingMon: formatEther(mandate.maxTotal > spent ? mandate.maxTotal - spent : BigInt(0)),
        maxTotalMon: formatEther(mandate.maxTotal),
        maxPerPaymentMon: formatEther(mandate.maxPerPayment),
        status,
      };
    }),
  );
  const [perPaymentLimit, dailyLimit, spentToday, , , paused] = policy;
  return {
    configured: true as const,
    executor: config.executor,
    agentId: config.agentId.toString(),
    owner: getAddress(agent.owner),
    agentKey: config.agentKey,
    wired: getAddress(agent.authorizedSigner) === getAddress(config.executor),
    vaultBalance: formatEther(balance),
    perPaymentLimit: formatEther(perPaymentLimit),
    dailyLimit: formatEther(dailyLimit),
    spentToday: formatEther(spentToday),
    paused,
    recipients: config.book.map((entry, index) => ({ ...entry, approved: approvals[index] })),
    mandates,
  };
}

/** Validates a signed mandate (owner's signature, our agent, sane window) and stores it. */
export async function submitMandate(body: { mandate?: unknown; signature?: unknown; purpose?: unknown; recipientName?: unknown }) {
  const config = mandateConfig();
  if (!config) throw new Error("Mandates are not configured on this server.");
  const mandate = parseMandate(body.mandate);
  const signature = typeof body.signature === "string" && /^0x[0-9a-fA-F]{130}$/.test(body.signature) ? (body.signature as Hex) : undefined;
  const purpose = typeof body.purpose === "string" ? body.purpose.trim() : "";
  if (!mandate || !signature) throw new Error("Send a mandate and its signature.");
  if (!purpose || purpose.length > 120) throw new Error("Give the mandate a purpose of 1 to 120 characters.");
  if (mandate.agentId !== config.agentId) throw new Error(`This demo accepts mandates for agent #${config.agentId}.`);
  if (mandate.agentKey !== config.agentKey) throw new Error("The mandate must name this server's agent key.");
  if (mandate.purposeHash !== purposeHashOf(purpose)) throw new Error("The purpose text does not match the signed purpose hash.");
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (mandate.validUntil <= now) throw new Error("That mandate has already expired.");
  if (mandate.validUntil - mandate.validAfter > BigInt(30 * 86_400)) throw new Error("Keep mandates to 30 days or less.");
  const signer = await recoverTypedDataAddress({
    domain: mandateDomain(config.executor),
    types: MANDATE_TYPES,
    primaryType: "Mandate",
    message: mandate,
    signature,
  });
  const owner = await serverPublicClient().readContract({ address: registryAddress!, abi: registryAbi, functionName: "ownerOf", args: [config.agentId] });
  if (getAddress(signer) !== getAddress(owner)) throw new Error("Only the agent's owner can sign its mandates.");
  const id = mandateDigest(mandate, config.executor);
  const existing = await listMandates();
  if (existing.some((entry) => entry.id === id)) return { id, duplicate: true };
  const recipientName = typeof body.recipientName === "string" ? body.recipientName.slice(0, 40) : undefined;
  const entry: StoredMandate = { id, mandate: body.mandate as StoredMandate["mandate"], signature, purpose, recipientName, createdAt: Date.now() };
  await saveMandate(entry);
  return { id, duplicate: false };
}

export async function findMandate(id: string): Promise<{ entry: StoredMandate; mandate: Mandate } | undefined> {
  const entry = (await listMandates()).find((item) => item.id === id);
  const mandate = entry && parseMandate(entry.mandate);
  return entry && mandate ? { entry, mandate } : undefined;
}

export type { Address };
