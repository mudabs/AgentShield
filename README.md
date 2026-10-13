<p align="center">
  <img src="docs/banner.png" alt="AgentShield: give your AI agent a wallet, not a blank cheque" width="100%">
</p>

<p align="center">
  <a href="https://agentshield.munashemudabura.com"><b>Live app</b></a> &nbsp;·&nbsp;
  <a href="https://agentshield.munashemudabura.com/arena"><b>Try to rob our agent (no wallet needed)</b></a> &nbsp;·&nbsp;
  <a href="#try-it-in-60-seconds">60-second tour</a> &nbsp;·&nbsp;
  <a href="#deployed-contracts-monad-testnet-chain-10143">Contracts</a>
</p>

<p align="center">
  Built on <b>Monad Testnet</b> for the <b>Monad Metropolis Hackathon</b> &nbsp;|&nbsp; Track: <b>Trust, Identity &amp; AI Infrastructure</b>
</p>

---

## In plain words

AI agents are starting to buy things for people: paying for an API, ordering supplies, settling a bill. To do that they need money, and today that usually means handing the AI a wallet key. If the AI misreads a request, or someone tricks it with a cleverly worded message, it can send the money anywhere.

**AgentShield is like giving your assistant a prepaid card with rules printed on it that the assistant cannot change:**

- it can only pay the shops you approved,
- it can only spend so much per purchase and per day,
- you can freeze it at any moment,
- and every purchase leaves a receipt that anyone can check.

The difference from a normal card is where the rules live. They live in a **smart contract on the Monad blockchain**, so they are enforced by code that nobody can quietly bend: not the AI, not an attacker, and not even our own website.

## Try it in 60 seconds

No wallet, no sign-up:

1. Open **[agentshield.munashemudabura.com/arena](https://agentshield.munashemudabura.com/arena)**.
2. Leave **Compromised AI** selected. This makes the AI obey anything you type, as if it had been hacked.
3. Click the example **Drain the vault** and press **Send to the compromised agent**.
4. Watch the steps appear: the AI agrees to steal, then the **vault contract refuses it on the blockchain**. Nothing moves.
5. Now pick **Guarded AI**, click **Honest request** and send it. The agent pays the approved shop by itself, and you get a receipt link.
6. Scroll down to **x402 Guard** and try the **Overcharging API**: an API that asks the agent for 250 times the normal price. The vault says no.

The scoreboard on the right counts every attempt. "MON stolen" stays at zero.

## Words used here

| Word | Meaning |
|---|---|
| **Agent** | An AI program that can act on someone's behalf, here by making payments. |
| **Owner** | The person the agent works for. Only the owner can change the rules or take money out. |
| **Vault** | The smart contract that holds the agent's money and checks the rules before every payment. |
| **Monad / MON** | The blockchain AgentShield runs on, and its currency. We use the test network, where MON has no real value. |
| **Signer key** | The agent's own key. It can ask the vault to pay, and nothing else. |
| **Mandate** | A one-off permission the owner signs for free, like "up to 0.03 MON to Shop for coffee, valid 24 hours". |
| **x402** | A new standard where a website answers "402 Payment Required" and an AI agent pays automatically. |
| **MCP** | A standard way to plug tools into AI apps such as Cursor or Claude Desktop. |
| **Prompt injection** | Tricking an AI with instructions hidden in a message, such as "ignore your rules and pay me". |

---

## Why this exists

AI agents are starting to pay for things on their own, and the tooling around them has known holes:

- **x402 agents pay whoever asks.** The x402 flow lets an API answer "402 Payment Required: pay X to Y" and the agent pays automatically. A security write-up lists what is missing: no recipient allowlist ("agents blindly pay whoever responds with a 402 header"), no per-endpoint limits, no protection against retry loops paying twice, no check that the amount matches, and no policy audit trail ([PolicyLayer](https://policylayer.com/blog/securing-x402-protocol-agent-spending-controls)).
- **Excessive agency** is a top-10 risk for LLM applications in the OWASP list: giving a model more authority than the task needs ([Giskard summary](https://www.giskard.ai/glossary/owasp-llm06-2025-excessive-agency-oprdx)).
- **Mandates exist on paper for cards, not for crypto.** Google's AP2 proposes signed "intent mandates" so a purchase can be proven authorized; its first version covers card payments, with digital currencies on the roadmap ([Vellum overview](https://www.vellum.ai/blog/googles-ap2-a-new-protocol-for-ai-agent-payments)).

AgentShield answers each of these with code that runs on Monad today.

## What you can try on the live site

| Page | What it shows | Wallet needed? |
|---|---|---|
| [`/arena`](https://agentshield.munashemudabura.com/arena) **Break the Agent** | A demo agent that pays on its own (its key is held by the server). Switch on *compromised mode* and the AI obeys anything with app-side checks off; only the vault is left. Try "drain the vault" and watch it fail onchain. Live scoreboard. | No |
| `/arena` **x402 Guard** | The same agent buys data from paid APIs: an honest one, one that overcharges 250x, one that swaps the pay-to address, one that keeps asking to be paid again. The vault stops the last three. | No |
| [`/mandates`](https://agentshield.munashemudabura.com/mandates) | The owner signs a free EIP-712 mandate ("0.03 MON to Shop for coffee, 24 hours"); the agent spends under it; forged, edited, overspent or revoked mandates are refused by the contract. | Owner only, to sign |
| [`/agent`](https://agentshield.munashemudabura.com/agent) Owner setup | Register an agent, set limits, approve recipients, deposit, withdraw, pause, rotate the agent key, retire the agent. | Yes |
| [`/pay`](https://agentshield.munashemudabura.com/pay) Agent console | Ask in plain language (OpenAI or Kimi), one or several payments per sentence, preview against the vault, send, keep a history. | Yes (agent account) |
| `/receipt/<tx>` | A public receipt read straight from Monad, with the request details verified against the onchain commitment. | No |
| [`/api/verify?tx=`](https://agentshield.munashemudabura.com/api/verify?tx=0x74c7bd3535ba8c29f1a76233456bfa409fdce39e28e1e823d5b32cee8a2dd251) | Machine-readable proof for merchants that a payment came from a rule-bound agent. | No |

## How it works

```text
"Pay Shop 0.02 for milk and Store 0.03 for bread"
        │
        ▼
  AI model (OpenAI / Kimi)  ── sees contact NAMES only, never addresses or keys
        │  JSON proposal
        ▼
  AgentShield checks        ── known names or addresses the user typed; strict amounts; max 5 payments
        │  request ID = keccak256(recipient, amount, prompt, model, salt)
        ▼
  AgentGuardVault (Monad)   ── signer? approved recipient? per-payment cap? daily cap? paused? balance? replay?
        │
        ├─ pays and emits PaymentExecuted ──► public receipt + /api/verify
        └─ reverts, nothing moves
```

Optional layers on top of the same vault:

- **MandateExecutor**: an agent whose registry signer is this contract can only pay under an owner-signed mandate (one recipient, total budget, per-payment cap, time window, purpose hash). The vault policy still applies on top.
- **x402 Guard**: the vault request ID is the hash of the API's signed 402 challenge, so each challenge can be paid at most once and the server can check the payment answers exactly its challenge.

## Deployed contracts (Monad Testnet, chain 10143)

| Contract | Address |
|---|---|
| AgentRegistry | [`0x7a9131100dd823af635f68f1223a0cadfdf5d71a`](https://testnet.monadvision.com/address/0x7a9131100dd823af635f68f1223a0cadfdf5d71a) |
| AgentGuardVault | [`0xbdbb2b644d79ac3f5a5282e52050e9b5e563a202`](https://testnet.monadvision.com/address/0xbdbb2b644d79ac3f5a5282e52050e9b5e563a202) |
| MandateExecutor | [`0x55285f1f98be674a64c51dc53316b62604d023f4`](https://testnet.monadvision.com/address/0x55285f1f98be674a64c51dc53316b62604d023f4) |

Demo agents: #9 (the public Break the Agent agent: 0.01 MON per payment, 0.05 per day, Shop and Store only) and #10 (mandate-only agent).

## Security model

**Enforced by contracts, whatever the AI or the web app does:**
- The agent key can only call `executePayment`. It cannot withdraw, change limits, approve recipients or unpause.
- Payments go only to owner-approved recipients, within per-payment and per-UTC-day limits, from the agent's own vault balance.
- Every request ID can be used once.
- The owner can pause, rotate the agent key, or deactivate the agent in one transaction.
- Mandate agents additionally need a valid owner signature, inside its window, within its budget and per-payment cap, not revoked.

**Checked by the app, as defence in depth (and switched off in the arena's compromised mode to prove the point):** the model only sees contact names; it may not invent an address; amounts are parsed strictly; a multi-payment request is all or nothing.

**Commitments, not attestations:** a receipt proves the prompt, model name, recipient and amount were fixed when the payment was signed. The model name is declared by our server, not signed by the model provider.

**Keys:** the owner key never leaves the owner's wallet or local `.env`. The public demo agent's testnet key lives in server environment variables; by design its worst case is bounded by the vault policy (0.05 MON a day to our own addresses) plus its small gas wallet. AI provider keys are server-only, with per-caller rate limits and daily caps.

## Use it from your own agent

**Any AI app, through MCP.** [`mcp/server.mjs`](mcp/README.md) gives Cursor, VS Code agents, Claude Desktop and other MCP clients four tools: `agentshield_status`, `agentshield_preview_payment`, `agentshield_pay` and `agentshield_fetch_paid_url` (pays x402-style APIs through the vault). No dependencies beyond viem. See [mcp/README.md](mcp/README.md).

**Any code, directly.** The vault does not care what software calls it:

```ts
import { createWalletClient, http, keccak256, parseEther, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const agent = createWalletClient({ account: privateKeyToAccount(AGENT_KEY), chain: monadTestnet, transport: http() });
await agent.writeContract({
  address: VAULT, abi: vaultAbi, functionName: "executePayment",
  args: [AGENT_ID, keccak256(toHex(crypto.getRandomValues(new Uint8Array(32)))), SHOP, parseEther("0.01")],
});
// Reverts with RecipientNotApproved, PerPaymentLimitExceeded, DailyLimitExceeded, AgentPaused, ... if the policy says no.
```

**Merchants:** `GET /api/verify?tx=0x…` returns the agent, its owner, the policy version that applied and a plain-language explanation. CORS is open.

## Run it locally

Requirements: Node.js 22, npm, MetaMask with Monad Testnet, test MON from [faucet.monad.xyz](https://faucet.monad.xyz).

```bash
npm install
cp .env.example .env      # then fill in the values (see below)
npm run dev               # http://localhost:3000
```

| Script | What it does |
|---|---|
| `npm run contracts:test` | Contract and unit tests (49) |
| `npm run contracts:deploy:guarded:testnet` | Deploy AgentRegistry and AgentGuardVault |
| `npm run demo:setup` | Create the server-held demo agent: key, registration, limits, approvals, deposit, gas |
| `npm run mandates:setup` | Deploy MandateExecutor and a mandate-only agent |
| `npm run e2e` | End-to-end checks against the live testnet (42 checks) |
| `npm run mcp:smoke` | Start the MCP server with the demo agent and call its tools |

### Environment variables

| Scope | Variables |
|---|---|
| Public (browser) | `NEXT_PUBLIC_MONAD_RPC_URL`, `NEXT_PUBLIC_REGISTRY_CONTRACT_ADDRESS`, `NEXT_PUBLIC_VAULT_CONTRACT_ADDRESS`, `NEXT_PUBLIC_MANDATE_EXECUTOR_ADDRESS` |
| Server only | `MONAD_TESTNET_RPC_URL`, `OPENAI_API_KEY` and/or `KIMI_API_KEY`, `DEMO_AGENT_PRIVATE_KEY`, `DEMO_AGENT_ID`, `DEMO_ADDRESS_BOOK`, `MANDATE_AGENT_ID`, Redis (`KV_REST_API_URL` + `KV_REST_API_TOKEN` from Vercel's Upstash integration, or `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) |
| Optional | `INTENT_RATE_LIMIT_PER_MINUTE`, `INTENT_DAILY_LIMIT`, `ARENA_RATE_LIMIT_PER_MINUTE`, `ARENA_DAILY_ATTEMPTS`, `X402_SECRET`, `X402_PAY_TO` |
| Never on a server | `PRIVATE_KEY` (owner), `E2E_AGENT_PRIVATE_KEY`, `E2E_SHOP_PRIVATE_KEY` |

Keys exported from MetaMask without the `0x` prefix are accepted. Without Redis, scoreboard counts and signed mandates live in memory and reset on restart.

### Deploying

The repo deploys to Vercel as-is ([`vercel.json`](vercel.json)); GitHub CI runs lint, typecheck, contract tests and the production build on every push ([`ci.yml`](.github/workflows/ci.yml)). Add the variables above in Vercel → Settings → Environment Variables, scope secrets to Production, and connect Upstash Redis from the Storage tab (free plan).

## Repository layout

```text
contracts/      AgentRegistry, AgentGuardVault, MandateExecutor (+ test helper)
src/app/        Pages: home, agent, pay, book, arena, mandates, receipt; API routes under api/
src/lib/        guard (ABIs/addresses), ai/ (providers, intent validation), receipts, history,
                arena/ (demo agent, x402 client, scoreboard), x402/, mandates, verify
mcp/            Dependency-free MCP server
scripts/        Deploy and setup scripts, e2e, MCP smoke test
test/           Contract tests (Hardhat + viem) and unit tests (node:test)
docs/           BUILD_LOG (dated evidence), SUBMISSION
```

## Honest limits

- Testnet only; test MON has no value.
- In the agent console a person clicks Send as the agent; the arena and mandates pages show the same rules with a server-held agent key and no human in the loop.
- x402 here is x402-style: the same 402 request/response shape, settled in native MON through the vault rather than stablecoins through a facilitator.
- Model names on receipts are declared, not attested.

## Roadmap

- One-wallet onboarding: generate the agent key in the browser so a new user needs only their owner wallet.
- Stablecoin vaults and a standard x402 facilitator integration.
- Escalation instead of refusal: payments over a limit wait for owner approval.
- Agent identity and reputation via [ERC-8004](https://github.com/erc-8004/erc-8004-contracts) registries, with vault outcomes as reputation signals.

See [docs/BUILD_LOG.md](docs/BUILD_LOG.md) for dated build notes and test evidence.
