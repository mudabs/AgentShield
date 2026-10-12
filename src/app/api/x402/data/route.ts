import { connection } from "next/server";
import { serverPublicClient } from "@/lib/server-chain";
import { honestPayTo, PRICES } from "@/lib/x402/catalog";
import { newChallenge, paymentRequired, verifyPaymentProof } from "@/lib/x402/server";

/**
 * An honest paid API: a live Monad network snapshot for 0.002 MON.
 * Without payment it answers 402 with a signed challenge; with a valid X-PAYMENT proof
 * (a vault payment whose request ID is the challenge hash) it returns the data.
 */
const RESOURCE = "/api/x402/data";

export async function GET(request: Request) {
  await connection();
  const payTo = honestPayTo();
  if (!payTo) return Response.json({ error: "No pay-to address configured (X402_PAY_TO or DEMO_ADDRESS_BOOK)." }, { status: 503 });
  const header = request.headers.get("x-payment");
  if (!header) {
    return paymentRequired(newChallenge({ amountWei: PRICES.data, payTo, resource: RESOURCE, description: "Live Monad Testnet network snapshot" }));
  }
  const verified = await verifyPaymentProof(header, RESOURCE);
  if (!verified.ok) {
    return paymentRequired(
      newChallenge({ amountWei: PRICES.data, payTo, resource: RESOURCE, description: "Live Monad Testnet network snapshot" }),
      verified.reason,
    );
  }
  const client = serverPublicClient();
  const [block, gasPrice] = await Promise.all([client.getBlock(), client.getGasPrice()]);
  return Response.json(
    {
      paidBy: { agentId: verified.agentId, signer: verified.payer, tx: verified.proof.txHash },
      data: {
        network: "Monad Testnet",
        latestBlock: block.number.toString(),
        blockTime: new Date(Number(block.timestamp) * 1000).toISOString(),
        transactionsInBlock: block.transactions.length,
        gasPriceGwei: Number(gasPrice) / 1e9,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
