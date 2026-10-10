import type { Address, Hex, PublicClient } from "viem";
import { registryAbi } from "@/lib/guard";

// The registry has no "list agents by owner/signer" function, so we scan the most
// recent agent IDs and keep the matches. Fine at hackathon scale; an event indexer
// replaces this later.
export const MAX_AGENTS_SCANNED = 200;

export type RegisteredAgent = {
  id: bigint;
  owner: Address;
  authorizedSigner: Address;
  active: boolean;
  metadataHash: Hex;
};

/** Reads recent agents from the registry, newest first, keeping those that match. */
export async function loadAgents(
  client: PublicClient,
  registry: Address,
  matches: (agent: RegisteredAgent) => boolean,
): Promise<RegisteredAgent[]> {
  const nextAgentId = await client.readContract({
    address: registry,
    abi: registryAbi,
    functionName: "nextAgentId",
  });
  const lastId = nextAgentId - BigInt(1);
  const firstId =
    lastId > BigInt(MAX_AGENTS_SCANNED) ? lastId - BigInt(MAX_AGENTS_SCANNED - 1) : BigInt(1);

  const ids: bigint[] = [];
  for (let id = lastId; id >= firstId; id -= BigInt(1)) ids.push(id);

  const agents = await Promise.all(
    ids.map(async (id) => {
      const agent = await client.readContract({
        address: registry,
        abi: registryAbi,
        functionName: "getAgent",
        args: [id],
      });
      return { id, ...agent };
    }),
  );
  return agents.filter(matches);
}

export function sameAddress(a?: string, b?: string): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}
