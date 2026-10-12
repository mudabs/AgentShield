# AgentShield

AgentShield is a trust and security layer for autonomous AI agents making payments on Monad. The product goal is:

**Create agent → set policy → fund guarded vault → request payment → enforce policy → execute or reject → verify receipt → inspect history.**

The repository currently contains the foundation slice plus locally tested enforcement contracts. The browser still uses the tiny probe until the registry/vault are deployed and wired into the payment UI. The probe is deliberately not a payment vault.

## Current architecture

```text
Browser
  └─ Next.js client page
      ├─ wagmi + viem → injected wallet signer
      ├─ viem public transport → Monad Testnet RPC
      └─ AgentShieldProbe → marker read/write + confirmed receipt

Enforcement contracts (locally tested, not yet deployed):
  AgentRegistry → AgentGuardVault → policy checks → PaymentExecuted receipt

Next app slice:
  agent setup → policy editor → vault deposit → payment request → receipt/history
```

The wallet signs transactions, but it does not hold or enforce the guarded balance. `AgentGuardVault` is the authority for payment policy. AI will eventually parse and explain requests; it will not receive keys or bypass contract checks.

`AgentGuardVault` uses UTC calendar-day buckets (`block.timestamp / 1 days`), an owner-configured per-payment limit, a daily limit, an explicit recipient allowlist, an owner pause, and a request ID per payment. State is updated before the external native-MON transfer and protected by a reentrancy guard. Direct native-MON transfers without an agent context revert. Successful payments emit enough data to reconstruct the action and policy version; reverted calls do not retain events.

## Requirements

- Node.js 22.13+ (the local environment currently uses Node 24.13.1)
- npm
- An EVM wallet such as MetaMask for browser interaction
- Optional Monad Testnet MON from the [official faucet](https://faucet.monad.xyz) for testnet deployment and gas

## Run the app

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy to Vercel with continuous deployment

The repository includes [`vercel.json`](vercel.json) for a reproducible Next.js
build and [GitHub CI](.github/workflows/ci.yml) for linting, typechecking,
contract tests, and the production build.

To create the Vercel project, import the GitHub repository
[`mudabs/AgentShield`](https://github.com/mudabs/AgentShield) from the Vercel
dashboard. Keep the project root at the repository root, use the Next.js
framework preset, and set `master` as the Production Branch. Vercel's Git
integration then provides continuous deployment automatically:

- pushes to non-production branches and pull requests create Preview deployments;
- pushes and merges to `master` create Production deployments.

Add the following variables in Vercel Project Settings → Environment Variables.
Use Preview and Production scopes as appropriate; never commit their values.

Public browser configuration:

```text
NEXT_PUBLIC_MONAD_RPC_URL
NEXT_PUBLIC_PROBE_CONTRACT_ADDRESS
NEXT_PUBLIC_REGISTRY_CONTRACT_ADDRESS
NEXT_PUBLIC_VAULT_CONTRACT_ADDRESS
```

Server-only configuration:

```text
MONAD_TESTNET_RPC_URL
KIMI_API_KEY or OPENAI_API_KEY or ANTHROPIC_API_KEY
DEMO_AGENT_PRIVATE_KEY
DEMO_AGENT_ID
DEMO_ADDRESS_BOOK
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

The rate-limit variables (`INTENT_RATE_LIMIT_PER_MINUTE`,
`ARENA_RATE_LIMIT_PER_MINUTE`, and `ARENA_DAILY_ATTEMPTS`) are optional. Keep
`PRIVATE_KEY`, `E2E_AGENT_PRIVATE_KEY`, and `E2E_SHOP_PRIVATE_KEY` out of
Vercel; they are for local testnet scripts only. The demo agent key is also a
testnet-only key and should be scoped to Production unless you intentionally
want Preview deployments to spend testnet MON.

After importing the repository, push a branch or open a pull request to verify
the Preview deployment, then merge to `master` for the first Production
deployment. Vercel will show the deployment URL and build logs in the GitHub
check and in the Vercel dashboard.

## Compile and test the contract

```bash
npm run contracts:compile
npm run contracts:test
```

The enforcement test suite covers allowed payments, reconstructable receipts, wrong signers, unapproved recipients, unauthorized policy changes, pause, per-payment and daily limits, duplicate request IDs, UTC-day rollover, failed recipient transfers, and direct-transfer rejection.

## Enforcement contract layout

- `contracts/AgentRegistry.sol`: owner, authorized signer, active state, and metadata hash.
- `contracts/AgentGuardVault.sol`: native-MON custody, policy state, allowlist, nonce/request protection, and guarded execution.
- `contracts/RejectingRecipient.sol`: test-only recipient used to prove failed transfers roll back spending state.

The owner can deposit or withdraw funds administratively. The authorized agent signer has no withdrawal or arbitrary-call route; it can only call `executePayment` with an approved recipient and an amount allowed by the vault policy.

## AI provider boundary

The shared provider boundary now lives in `src/lib/ai/provider.ts`, and `src/lib/ai/payment-intent.ts` converts untrusted model output into one validated native-MON intent. Small network adapters for Kimi, OpenAI, Anthropic, AgentShield-managed inference, and external-agent callers will plug into that interface later. Provider credentials remain server-side and separate from wallet signing keys. A user key will never be placed in a `NEXT_PUBLIC_` variable, browser bundle, log, receipt, or contract call.

“Sign in with ChatGPT” is not treated as generic OpenAI API access, and a Claude.ai subscription is not treated as Anthropic Console API access. These are separate integration and billing surfaces; implementation requires verified partner availability, permissions, tenant controls, and account eligibility.

## Deploy the probe locally

In terminal 1:

```bash
npm run contracts:node
```

In terminal 2:

```bash
npm run contracts:deploy:local
```

Copy the printed address into `.env.local` as `NEXT_PUBLIC_PROBE_CONTRACT_ADDRESS`. Restart `npm run dev`. The browser app is configured for Monad Testnet, so use the testnet deploy command for the live wallet flow below; the local deploy is for contract preparation and test isolation.

## Deploy the probe to Monad Testnet

1. Copy `.env.example` to `.env`.
2. Set `PRIVATE_KEY` to a dedicated testnet-only deployer key. Never use a production key or expose it to the browser.
3. Fund that address with testnet MON from the [official faucet](https://faucet.monad.xyz).
4. Run:

```bash
npm run contracts:compile
npm run contracts:deploy:testnet
```

To deploy the guarded payment contracts, use the dedicated script below after
putting a funded testnet-only deployer key in `.env`:

```bash
npm run contracts:deploy:guarded:testnet
```

This deploys `AgentRegistry` first and passes its address into
`AgentGuardVault`. It does not create an agent or move funds. Save the printed
addresses as `NEXT_PUBLIC_REGISTRY_CONTRACT_ADDRESS` and
`NEXT_PUBLIC_VAULT_CONTRACT_ADDRESS` in `.env.local` before wiring the browser
flow.

5. Put the printed contract address in `.env.local` as `NEXT_PUBLIC_PROBE_CONTRACT_ADDRESS`, restart the app, connect the wallet, switch to Monad Testnet, and write a marker.

Monad Testnet configuration used here: chain ID `10143`, native token `MON`, and public RPC `https://testnet-rpc.monad.xyz`. Confirm current values against the [official Monad testnet documentation](https://docs.monad.xyz/developer-essentials/testnet) before deployment.

## Checks

```bash
npm run lint
npm run typecheck
npm run build
npm run contracts:compile
npm run contracts:test
```

See [docs/BUILD_LOG.md](docs/BUILD_LOG.md) for dated implementation notes, evidence, limitations, and the next slice.
