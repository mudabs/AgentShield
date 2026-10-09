import { isAddress, type Address } from "viem";

export const probeAbi = [
  {
    type: "function",
    name: "marker",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "setMarker",
    stateMutability: "nonpayable",
    inputs: [{ name: "newMarker", type: "uint256" }],
    outputs: [],
  },
  {
    type: "event",
    name: "MarkerUpdated",
    anonymous: false,
    inputs: [
      { indexed: true, name: "caller", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ],
  },
] as const;

const configuredProbeAddress = process.env.NEXT_PUBLIC_PROBE_CONTRACT_ADDRESS;

export const probeContractAddress: Address | undefined =
  configuredProbeAddress && isAddress(configuredProbeAddress)
    ? configuredProbeAddress
    : undefined;
