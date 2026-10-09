# AgentShield build log

## 2026-10-08 — Foundation slice started

> Historical foundation entry. The enforcement status below supersedes its “no AgentRegistry / no guarded vault” statement.

### Current milestone and next action

Foundation: scaffold the application and prove the browser → wallet → Monad → contract receipt path. Next action is to deploy the probe to Monad Testnet when a funded testnet deployer is available, then verify the write through the browser wallet.

### Working / incomplete / blocked

- Working: Next.js TypeScript App Router scaffold; Tailwind styling; wagmi + viem provider; Monad Testnet chain configuration; probe contract source, test, and deploy script.
- Incomplete: no AgentRegistry, guarded vault, policy enforcement, receipt verifier, history, or AI parsing yet.
- Not blocked for local work. Testnet deployment requires a dedicated deployer private key and testnet MON; neither is present in the repository, and no deployment is being claimed.

### Files changed and behavior added

- `src/app/page.tsx`: first AgentShield dashboard; wallet connect/disconnect, network switch, balance display, probe read/write, pending/confirmed/error states, and explicit testnet/probe labeling.
- `src/app/providers.tsx`: client-side wagmi and React Query providers.
- `src/lib/monad.ts`: Monad Testnet chain definition and explorer/RPC constants.
- `src/lib/probe.ts`: typed ABI and public probe-address configuration.
- `contracts/AgentShieldProbe.sol`: non-custodial marker contract used only to validate the interaction path.
- `test/AgentShieldProbe.test.ts`: marker storage and event test.
- `hardhat.config.ts`, `scripts/deploy-probe.ts`: Hardhat 3 local/Testnet configuration and viem deployment script.
- `.env.example`: secret and public configuration names without values.
- `README.md`: setup, architecture, trust-boundary explanation, and honest deployment instructions.

### Important decisions and reasons

- Chose Hardhat 3 because the official Monad deployment guide documents Hardhat, the official Monad Hardhat 3 template uses the viem toolbox, and the local Node runtime satisfies the documented requirement. Foundry is not installed locally; no silent toolchain substitution was made.
- Chose injected wallet support through wagmi instead of adding a hosted wallet service. This keeps the first slice credential-free and makes the signer boundary visible.
- Kept the contract intentionally tiny. It is a plumbing probe, not a mock payment or a claim of policy enforcement.
- Used integer `uint256` marker values and no floating-point arithmetic. Future payment amounts will use native MON base units.

### Checks run and results

- `npx create-next-app@latest`: scaffold created successfully with Next.js 16.4.0, TypeScript, Tailwind, App Router, and npm lockfile.
- `npm install wagmi viem @tanstack/react-query`: completed successfully.
- Hardhat dependencies installed successfully. npm reported dependency audit findings; they have not been force-fixed because that can make unrelated breaking changes.
- Verified after wiring: `npm run contracts:compile`, `npm run contracts:test`, `npm run typecheck`, `npm run lint`, and `npm run build` all pass. `http://localhost:3000` returned HTTP 200 and rendered the AgentShield dashboard text. A read-only JSON-RPC call to `https://testnet-rpc.monad.xyz` returned chain ID `0x279f` (decimal `10143`) and a current block number. The documented local node/deploy path also succeeded: `npm run contracts:node` started at `127.0.0.1:8545`, and `npm run contracts:deploy:local` deployed `AgentShieldProbe` at `0x5fbdb2315678afecb367f032d93f642f64180aa3` on chain `31337`.

### Known limitations and unresolved questions

- `NEXT_PUBLIC_PROBE_CONTRACT_ADDRESS` is intentionally empty until a deployment is performed. The dashboard shows a setup message instead of pretending the contract exists.
- The current probe has no custody, policy, allowlist, pause, nonce, or payment behavior. Do not send funds to it.
- The app assumes an injected EVM wallet is available. Wallet-provider selection and mobile support are deferred.
- Public RPCs may be rate-limited. A provider-backed RPC can be configured through `NEXT_PUBLIC_MONAD_RPC_URL` and `MONAD_TESTNET_RPC_URL` later.
- Testnet deployment has not been attempted: `.env` and `.env.local` are absent, so no deployer key or probe address is available.

### Verified references

- Official Monad testnet documentation checked 2026-10-08: https://docs.monad.xyz/developer-essentials/testnet
- Official Monad Hardhat deployment guide checked 2026-10-08: https://docs.monad.xyz/guides/deploy-smart-contract/hardhat

## 2026-10-08 — Enforcement contracts locally tested

### Current milestone and next action

Implemented the first contract-enforced payment boundary. Next action is to deploy `AgentRegistry` and `AgentGuardVault` to Monad Testnet, wire the browser to their real addresses, and expose agent setup, policy configuration, deposit, and payment request state in the dashboard.

### Working / incomplete / blocked

- Implemented and locally tested: registry identity, owner-controlled signer/status/metadata, guarded native-MON custody, per-payment and daily UTC limits, recipient allowlist, owner pause, request IDs, reentrancy protection, failed-transfer rollback, and successful payment events.
- Still incomplete: Testnet deployment, browser integration for the vault, payment-request UI, offchain rejection log, public receipt verifier, history, and a real model adapter.
- Not blocked for local contract work. Testnet deployment still needs a dedicated funded deployer key and testnet MON.

### Files changed and behavior added

- `contracts/AgentRegistry.sol`: agent owner/signer/status/metadata registry with owner-only mutations.
- `contracts/AgentGuardVault.sol`: owner-only deposit/withdraw/policy controls and signer-only guarded payments.
- `contracts/RejectingRecipient.sol`: test-only reverting recipient.
- `test/AgentGuardVault.test.ts`: seven passing tests covering the security boundary and receipt event.
- `README.md`: updated architecture, policy semantics, receipt honesty, and provider boundary.
- `src/lib/ai/provider.ts`: provider-neutral managed/user-key/external-agent interface using opaque credential references.
- `src/lib/ai/payment-intent.ts`: deterministic normalization from untrusted model output to integer-wei native-MON intent.
- `test/PaymentIntent.test.ts`: validation tests for addresses, amounts, actions, ambiguity, and zero-value rejection.

### Important decisions and reasons

- Kept the working `AgentShieldProbe` and its browser path intact; the probe is still explicitly non-custodial.
- Split registry identity from vault custody so network deployment addresses and payment logic can evolve independently.
- Used UTC day buckets with `block.timestamp / 1 days`, integer wei amounts, and request IDs. State is marked before the external transfer and `ReentrancyGuard` protects the call.
- Reverted payments intentionally emit no rejection event. The future app must use a clearly labeled offchain rejection record if it wants to show blocked attempts.
- Owner withdrawals are administrative custody actions. The agent signer has no withdrawal or arbitrary-call route.
- Established the provider interface before adding a model SDK. Model output must normalize into the same validated intent regardless of provider; provider credentials are represented only by opaque server-side references.

### Checks run and results

- `npm run contracts:compile`: passed; three new Solidity files compiled with solc `0.8.28`.
- `npm run contracts:test`: passed; `11 passing` across vault, probe, and payment-intent validation tests.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- One parallel compile/test invocation hit a Hardhat cache race; the sequential rerun passed. No source fix was required for that tooling race.

### Provider/account research recorded before implementation

- OpenAI’s official guidance describes Sign in with ChatGPT as an identity and, separately, an optional participating-app plan-usage authorization. Availability is limited to supported apps/sites; plan usage has separate account-plan and app eligibility conditions.
- OpenAI API billing is separate from ChatGPT billing.
- Anthropic’s official guidance says Claude.ai subscriptions and Anthropic Console API access are separate products.
- Kimi’s official API guidance says the Open Platform requires an API key, uses an OpenAI-compatible format, and is separate from Kimi Membership and Kimi Code.

References checked 2026-10-08:

- https://help.openai.com/en/articles/20001410-sign-in-with-chatgpt
- https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites
- https://support.anthropic.com/en/articles/9876003-i-subscribe-to-a-paid-claude-ai-plan-why-do-i-have-to-pay-separately-for-api-usage-on-console
- https://www.kimi.ai/help/kimi-api/api-overview

## 2026-10-09 — Prepared guarded-contract deployment

Current milestone: make the real registry/vault deployment repeatable before using the funded Monad testnet deployer.

- Working: `scripts/deploy-guarded.ts` deploys `AgentRegistry`, then deploys `AgentGuardVault` with the registry address as its constructor argument.
- Incomplete: no testnet deployment has been claimed; the browser is not yet wired to the guarded contract addresses; no agent or vault funds have been created onchain.
- Changed: added guarded local/testnet npm commands and public address placeholders to `.env.example`.
- Local verification: `npm run contracts:deploy:guarded:local` passed on chain `31337`, deployed both contracts, and verified `AgentGuardVault.registry()` matched the newly deployed registry address.
- Important decision: the existing probe deployment remains available and unchanged. The guarded deployment has a separate command so the old foundation path is not silently replaced.
- Next action: run the guarded deployment with a locally configured, funded testnet-only `PRIVATE_KEY`, then verify the chain ID and constructor linkage from the deployed addresses.
