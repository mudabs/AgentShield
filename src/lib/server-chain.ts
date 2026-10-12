import { createPublicClient, http } from "viem";
import { monadTestnet } from "./monad";

/** Read-only Monad client for route handlers. */
export const serverRpcUrl = process.env.MONAD_TESTNET_RPC_URL || monadTestnet.rpcUrls.default.http[0];

let client: ReturnType<typeof createPublicClient> | undefined;
export function serverPublicClient() {
  client ??= createPublicClient({ chain: monadTestnet, transport: http(serverRpcUrl) });
  return client;
}
