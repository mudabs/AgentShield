import { connection } from "next/server";
import { verifyAgentPayment } from "@/lib/verify";

/**
 * GET /api/verify?tx=0x…[&e=<request details from a receipt link>]
 * For merchants and other services: proves a payment came from a rule-bound
 * AgentShield agent, read live from Monad. Open to any origin.
 */
const cors = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };

export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const result = await verifyAgentPayment(url.searchParams.get("tx") ?? "", url.searchParams.get("e"));
  return Response.json(result, { status: result.ok ? 200 : 400, headers: cors });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET, OPTIONS" } });
}
