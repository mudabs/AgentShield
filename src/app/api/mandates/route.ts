import { connection } from "next/server";
import { describeError } from "@/lib/errors";
import { mandatesOverview, submitMandate } from "@/lib/mandate-server";

/** GET: the mandate-only demo agent and its signed mandates. POST: submit an owner-signed mandate. */
export async function GET() {
  await connection();
  try {
    return Response.json(await mandatesOverview(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ message: describeError(error as Error) }, { status: 502 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    return Response.json(await submitMandate(body));
  } catch (error) {
    return Response.json({ message: error instanceof Error ? error.message : "Could not save the mandate." }, { status: 400 });
  }
}
