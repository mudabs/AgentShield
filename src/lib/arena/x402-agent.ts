import { formatEther, getAddress, type Address } from "viem";
import { arenaConfig, vaultPayAsDemoAgent, type ArenaEvent } from "./agent";
import { recordAttempt, type ArenaOutcome } from "./store";
import { challengeRequestId, encodePaymentHeader, type PaymentChallenge } from "../x402/challenge";
import { scenarioPath, type Scenario } from "../x402/catalog";

/**
 * The demo agent as an x402 client: it calls a paid API, and when the API answers
 * 402 it pays through the vault and retries with proof. Like a naive client it is
 * willing to pay again if asked, up to twice per call, so the vault's own rules are
 * what stop overcharging, redirection and double payment.
 */
const MAX_PAYMENTS = 2;

export async function runX402(scenario: Scenario, origin: string, emit: (event: ArenaEvent) => void) {
  const config = arenaConfig();
  if (!config) {
    emit({ type: "error", message: "The demo agent is not configured on this server." });
    return;
  }
  const names = new Map(config.book.map((entry) => [entry.address, entry.name]));
  const url = `${origin}${scenarioPath(scenario)}`;
  let header: string | undefined;
  let payments = 0;
  let paidWei = BigInt(0);
  let unapprovedWei = BigInt(0);
  let outcome: ArenaOutcome = "error";
  let headline = "The call did not complete.";
  let firstHash: `0x${string}` | undefined;

  emit({ type: "start", mode: "guarded", provider: "x402 client", model: scenarioPath(scenario) });
  try {
    for (let round = 0; round < MAX_PAYMENTS + 1; round += 1) {
      emit({ type: "x402-request", url: scenarioPath(scenario), attempt: round });
      const response = await fetch(url, { headers: header ? { "x-payment": header } : {}, cache: "no-store" });
      if (response.status === 200) {
        const body = (await response.json()) as { data?: unknown };
        emit({ type: "x402-response", attempt: round, status: 200 });
        emit({ type: "x402-data", data: body.data ?? body });
        outcome = "paid_within_policy";
        headline = `Paid ${formatEther(paidWei)} MON through the vault and received the data.`;
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { accepts?: PaymentChallenge[]; signature?: `0x${string}`; error?: string };
      emit({ type: "x402-response", attempt: round, status: response.status, message: body.error });
      if (response.status !== 402 || !body.accepts?.[0] || !body.signature) {
        headline = `The API answered HTTP ${response.status}.`;
        return;
      }
      const challenge = body.accepts[0];
      const payTo = getAddress(challenge.payTo) as Address;
      emit({
        type: "x402-402",
        attempt: round,
        amountMon: formatEther(BigInt(challenge.amountWei)),
        payTo,
        payToName: names.get(payTo),
        description: challenge.description,
      });
      if (payments >= MAX_PAYMENTS) {
        outcome = "vault_refused";
        headline = "The agent gave up after paying twice.";
        return;
      }
      const result = await vaultPayAsDemoAgent(
        { recipient: payTo, amountWei: BigInt(challenge.amountWei), requestId: challengeRequestId(challenge), index: payments },
        emit,
      );
      payments += 1;
      if (!result.allowed) {
        outcome = "vault_refused";
        headline =
          result.name === "PerPaymentLimitExceeded"
            ? `The API asked for ${formatEther(BigInt(challenge.amountWei))} MON. The vault refused: above the per-payment limit.`
            : result.name === "RecipientNotApproved"
              ? `The API tried to be paid at ${payTo.slice(0, 6)}…${payTo.slice(-4)}. The vault refused: recipient not approved.`
              : result.name === "DuplicateRequest"
                ? "The API asked to be paid twice for the same request. The vault refused the second payment."
                : `The vault refused: ${result.reason}`;
        return;
      }
      if (!result.paid) {
        headline = "The payment reverted onchain.";
        return;
      }
      paidWei += BigInt(challenge.amountWei);
      firstHash ??= result.hash;
      if (!names.has(payTo)) unapprovedWei += BigInt(challenge.amountWei);
      header = encodePaymentHeader({ challenge, signature: body.signature, txHash: result.hash });
    }
  } catch (error) {
    outcome = "error";
    headline = error instanceof Error ? error.message : "Unexpected error.";
    emit({ type: "error", message: headline });
  } finally {
    emit({ type: "done", outcome, headline });
    await recordAttempt(
      { at: Date.now(), mode: "guarded", provider: "x402", outcome, summary: `x402 ${scenario}: ${headline}`, hash: firstHash },
      paidWei,
      unapprovedWei,
    ).catch(() => undefined);
  }
}
