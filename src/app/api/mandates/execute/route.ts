import { keccak256, parseEventLogs, stringToBytes, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { demoAgentClients, errorName, serialized } from "@/lib/arena/agent";
import { describeError } from "@/lib/errors";
import { mandateExecutorAbi } from "@/lib/mandate-abi";
import { findMandate, mandateConfig } from "@/lib/mandate-server";
import { MANDATE_TYPES, mandateDomain } from "@/lib/mandates";
import { parseMonAmount } from "@/lib/amounts";
import { monadTestnet } from "@/lib/monad";

/**
 * POST { id, amountMon, attack? }
 * The server's agent key spends under a stored mandate. attack = "forge" (a mandate signed
 * by a stranger) or "tamper" (the real mandate with its budget raised after signing) only
 * asks the contract and never sends.
 */
export const maxDuration = 60;
const recent = new Map<string, number[]>();

export async function POST(request: Request) {
  const caller = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const calls = (recent.get(caller) ?? []).filter((time) => now - time < 60_000);
  if (calls.length >= 6) return Response.json({ message: "Easy there. Wait a minute." }, { status: 429 });
  recent.set(caller, [...calls, now]);

  const config = mandateConfig();
  const clients = demoAgentClients();
  if (!config || !clients) return Response.json({ message: "Mandates are not configured on this server." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { id?: string; amountMon?: string; attack?: string };
  const found = body.id ? await findMandate(body.id) : undefined;
  if (!found) return Response.json({ message: "Unknown mandate." }, { status: 404 });
  const amount = parseMonAmount(body.amountMon ?? "");
  if (!amount.ok) return Response.json({ message: amount.message }, { status: 400 });

  let mandate = found.mandate;
  let signature = found.entry.signature as Hex;
  if (body.attack === "forge") {
    const stranger = privateKeyToAccount(generatePrivateKey());
    signature = await stranger.signTypedData({ domain: mandateDomain(config.executor), types: MANDATE_TYPES, primaryType: "Mandate", message: mandate });
  } else if (body.attack === "tamper") {
    mandate = { ...mandate, maxTotal: mandate.maxTotal * BigInt(100), maxPerPayment: mandate.maxPerPayment * BigInt(100) };
  }
  const requestId = keccak256(stringToBytes(`${found.entry.id}:${toHex(crypto.getRandomValues(new Uint8Array(16)))}`));
  const args = [mandate, signature, requestId, amount.wei] as const;

  try {
    const result = await serialized(async () => {
      try {
        await clients.publicClient.simulateContract({ account: clients.account, address: config.executor, abi: mandateExecutorAbi, functionName: "execute", args });
      } catch (error) {
        return { allowed: false as const, errorName: errorName(error), reason: describeError(error as Error) };
      }
      if (body.attack) return { allowed: true as const, simulatedOnly: true };
      const gas = await clients.publicClient.estimateContractGas({ account: clients.account, address: config.executor, abi: mandateExecutorAbi, functionName: "execute", args });
      const hash = await clients.walletClient.writeContract({
        account: clients.account,
        chain: monadTestnet,
        address: config.executor,
        abi: mandateExecutorAbi,
        functionName: "execute",
        args,
        gas: (gas * BigInt(125)) / BigInt(100),
      });
      const receipt = await clients.publicClient.waitForTransactionReceipt({ hash, timeout: 45_000 });
      const paid = receipt.status === "success" && parseEventLogs({ abi: mandateExecutorAbi, eventName: "MandatePayment", logs: receipt.logs }).length > 0;
      return { allowed: true as const, paid, hash };
    });
    return Response.json(result);
  } catch (error) {
    return Response.json({ message: describeError(error as Error) }, { status: 502 });
  }
}
