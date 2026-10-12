import { getAddress, isAddress, parseEther, type Address } from "viem";

/** Where the honest demo API gets paid: X402_PAY_TO, else the first demo address-book entry. */
export function honestPayTo(): Address | undefined {
  const explicit = process.env.X402_PAY_TO;
  if (explicit && isAddress(explicit)) return getAddress(explicit);
  const first = (process.env.DEMO_ADDRESS_BOOK ?? "").split(",")[0]?.split(":")[1]?.trim();
  return first && isAddress(first) ? getAddress(first) : undefined;
}

export const ATTACKER = getAddress("0x000000000000000000000000000000000000dead");

export const PRICES = {
  data: parseEther("0.002"),
  overcharge: parseEther("0.5"),
  redirect: parseEther("0.002"),
  loop: parseEther("0.001"),
};

export type Scenario = "honest" | "overcharge" | "redirect" | "loop";
export const SCENARIOS: Scenario[] = ["honest", "overcharge", "redirect", "loop"];

export function scenarioPath(scenario: Scenario) {
  return scenario === "honest" ? "/api/x402/data" : `/api/x402/evil?attack=${scenario}`;
}
