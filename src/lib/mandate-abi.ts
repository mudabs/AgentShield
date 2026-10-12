import type { Abi } from "viem";
import { isAddress, type Address } from "viem";

// Generated from artifacts/contracts/MandateExecutor.sol/MandateExecutor.json. Regenerate if MandateExecutor.sol changes.
export const mandateExecutorAbi = [
  {
    "inputs": [
      {
        "internalType": "contract AgentRegistry",
        "name": "registry_",
        "type": "address"
      },
      {
        "internalType": "contract AgentGuardVault",
        "name": "vault_",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "agentId",
        "type": "uint256"
      }
    ],
    "name": "AgentNotWiredToExecutor",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ECDSAInvalidSignature",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "length",
        "type": "uint256"
      }
    ],
    "name": "ECDSAInvalidSignatureLength",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "s",
        "type": "bytes32"
      }
    ],
    "name": "ECDSAInvalidSignatureS",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidShortString",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "remaining",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "requested",
        "type": "uint256"
      }
    ],
    "name": "MandateBudgetExceeded",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "validUntil",
        "type": "uint64"
      }
    ],
    "name": "MandateExpired",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "validAfter",
        "type": "uint64"
      }
    ],
    "name": "MandateNotYetValid",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "limit",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "requested",
        "type": "uint256"
      }
    ],
    "name": "MandatePerPaymentExceeded",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "mandateHash",
        "type": "bytes32"
      }
    ],
    "name": "MandateRevoked",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotAgentOwner",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "caller",
        "type": "address"
      }
    ],
    "name": "NotMandateAgent",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "recovered",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "owner",
        "type": "address"
      }
    ],
    "name": "NotSignedByOwner",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ReentrancyGuardReentrantCall",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "str",
        "type": "string"
      }
    ],
    "name": "StringTooLong",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [],
    "name": "EIP712DomainChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "mandateHash",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "agentId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "requestId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "spentUnderMandate",
        "type": "uint256"
      }
    ],
    "name": "MandatePayment",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "mandateHash",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "agentId",
        "type": "uint256"
      }
    ],
    "name": "MandateRevokedByOwner",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "MANDATE_TYPEHASH",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "eip712Domain",
    "outputs": [
      {
        "internalType": "bytes1",
        "name": "fields",
        "type": "bytes1"
      },
      {
        "internalType": "string",
        "name": "name",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "version",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "chainId",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "verifyingContract",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "salt",
        "type": "bytes32"
      },
      {
        "internalType": "uint256[]",
        "name": "extensions",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "agentId",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "agentKey",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "recipient",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "maxTotal",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "maxPerPayment",
            "type": "uint256"
          },
          {
            "internalType": "uint64",
            "name": "validAfter",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "validUntil",
            "type": "uint64"
          },
          {
            "internalType": "bytes32",
            "name": "purposeHash",
            "type": "bytes32"
          },
          {
            "internalType": "uint256",
            "name": "nonce",
            "type": "uint256"
          }
        ],
        "internalType": "struct MandateExecutor.Mandate",
        "name": "mandate",
        "type": "tuple"
      },
      {
        "internalType": "bytes",
        "name": "ownerSignature",
        "type": "bytes"
      },
      {
        "internalType": "bytes32",
        "name": "requestId",
        "type": "bytes32"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "execute",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "agentId",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "agentKey",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "recipient",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "maxTotal",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "maxPerPayment",
            "type": "uint256"
          },
          {
            "internalType": "uint64",
            "name": "validAfter",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "validUntil",
            "type": "uint64"
          },
          {
            "internalType": "bytes32",
            "name": "purposeHash",
            "type": "bytes32"
          },
          {
            "internalType": "uint256",
            "name": "nonce",
            "type": "uint256"
          }
        ],
        "internalType": "struct MandateExecutor.Mandate",
        "name": "mandate",
        "type": "tuple"
      }
    ],
    "name": "mandateHash",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "registry",
    "outputs": [
      {
        "internalType": "contract AgentRegistry",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "agentId",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "agentKey",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "recipient",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "maxTotal",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "maxPerPayment",
            "type": "uint256"
          },
          {
            "internalType": "uint64",
            "name": "validAfter",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "validUntil",
            "type": "uint64"
          },
          {
            "internalType": "bytes32",
            "name": "purposeHash",
            "type": "bytes32"
          },
          {
            "internalType": "uint256",
            "name": "nonce",
            "type": "uint256"
          }
        ],
        "internalType": "struct MandateExecutor.Mandate",
        "name": "mandate",
        "type": "tuple"
      }
    ],
    "name": "remaining",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "agentId",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "agentKey",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "recipient",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "maxTotal",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "maxPerPayment",
            "type": "uint256"
          },
          {
            "internalType": "uint64",
            "name": "validAfter",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "validUntil",
            "type": "uint64"
          },
          {
            "internalType": "bytes32",
            "name": "purposeHash",
            "type": "bytes32"
          },
          {
            "internalType": "uint256",
            "name": "nonce",
            "type": "uint256"
          }
        ],
        "internalType": "struct MandateExecutor.Mandate",
        "name": "mandate",
        "type": "tuple"
      }
    ],
    "name": "revoke",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "mandateHash",
        "type": "bytes32"
      }
    ],
    "name": "revoked",
    "outputs": [
      {
        "internalType": "bool",
        "name": "revoked",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "mandateHash",
        "type": "bytes32"
      }
    ],
    "name": "spentUnder",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "spent",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "vault",
    "outputs": [
      {
        "internalType": "contract AgentGuardVault",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const satisfies Abi;

export const mandateExecutorAddress: Address | undefined = isAddress(process.env.NEXT_PUBLIC_MANDATE_EXECUTOR_ADDRESS ?? "")
  ? (process.env.NEXT_PUBLIC_MANDATE_EXECUTOR_ADDRESS as Address)
  : undefined;
