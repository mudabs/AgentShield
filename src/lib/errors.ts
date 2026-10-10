import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

// Plain-language explanations for the custom errors in AgentRegistry and AgentGuardVault.
const contractErrorMessages: Record<string, string> = {
  AgentNotFound: "That agent does not exist in the registry.",
  AgentPaused: "The agent is paused by its owner, so the vault refuses payments.",
  DailyLimitExceeded: "The payment would go over today's limit (the day resets at 00:00 UTC).",
  DirectTransferNotSupported: "Send MON with the deposit button, not directly to the vault.",
  DuplicateRequest: "This request ID was already used, so the payment cannot run twice.",
  InsufficientVaultBalance: "The vault does not hold enough MON for this agent.",
  InvalidAmount: "The amount must be greater than zero.",
  InvalidPolicy: "Limits must be above zero, and the per-payment limit cannot be larger than the daily limit.",
  InvalidRecipient: "That recipient address is not allowed.",
  InvalidRequestId: "The payment request ID is missing.",
  InvalidSigner: "The agent signer address is not valid.",
  NotAgentOwner: "Only this agent's owner can do that. Check which MetaMask account is connected.",
  PaymentTransferFailed: "The recipient refused the transfer, so nothing was paid.",
  PerPaymentLimitExceeded: "The amount is above this agent's per-payment limit.",
  RecipientNotApproved: "The recipient is not on this agent's approved list.",
  UnauthorizedSigner: "This account is not the agent's signer, or the agent is inactive.",
};

/** Turns wallet, RPC, and contract errors into one sentence a person can act on. */
export function describeError(error: Error): string {
  if (!(error instanceof BaseError)) return error.message;

  if (error.walk((cause) => cause instanceof UserRejectedRequestError)) {
    return "You cancelled the request in your wallet. Nothing was sent.";
  }

  const reverted = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
  if (reverted instanceof ContractFunctionRevertedError) {
    const name = reverted.data?.errorName;
    if (name && contractErrorMessages[name]) return `${contractErrorMessages[name]} (${name})`;
  }

  return error.shortMessage;
}
