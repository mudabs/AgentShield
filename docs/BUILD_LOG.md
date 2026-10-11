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

## 2026-10-09 — Phase 1 gate met; guarded contracts on Monad Testnet; agent setup screen

### Current milestone and next action

Phase 1 (foundation) is complete: the browser wrote to the probe on Monad Testnet through MetaMask and the owner observed the confirmed transaction. Phase 2 (enforcement) has started: `AgentRegistry` and `AgentGuardVault` are deployed to Monad Testnet and the browser can register an agent. Next action: owner-side policy screen (per-payment limit, daily limit, recipient allowlist, pause) and vault deposit.

### Working / incomplete / blocked

- Testnet verified: probe deployed and written from the browser (owner-observed; transaction hash not yet recorded here).
- Testnet deployed: `AgentRegistry` and `AgentGuardVault`; deploy script verified `AgentGuardVault.registry()` equals the registry address.
- Implemented, type-checked, lint-clean, production build passes: `/agent` screen to create an agent and inspect its onchain state. Not yet exercised against testnet in the browser.
- Incomplete: policy editor, recipient allowlist UI, deposit, payment request, receipts, history.

### Deployment references (Monad Testnet, chain 10143)

- Deployer: `0xf421b7dd90905352fcb4ca3562107b4c90be33fa` (testnet-only account)
- AgentShieldProbe: `0x914e3b1f91b1e2c07e65c234816dd550bccb2b29`
- AgentRegistry: `0xe2a5d0d06466ef9db36ff926f1f7191a068ff095`
- AgentGuardVault: `0x8969c41117698995c89070d3867a5676bfea3931` (constructed with the registry above)

### Files changed and behavior added

- `src/app/page.tsx`: read the chain ID from the connected wallet (`useAccount().chainId`) instead of `useChainId()`, which only reports configured chains and allowed the write button to appear enabled while MetaMask was on Ethereum Mainnet. Viem rejected that transaction before sending; no funds moved. Added a link to `/agent`.
- `src/lib/guard.ts`: registry and vault ABIs generated from Hardhat artifacts, plus public address configuration.
- `src/app/agent/page.tsx`: create-agent form (owner = connected wallet, separate agent signer, optional label), confirmed-receipt parsing of `AgentCreated`, list of agents owned by the wallet, and per-agent view of signer, status, vault balance, and policy.
- `.env` (not committed): registry and vault addresses.

### Important decisions and reasons

- The UI refuses an agent signer equal to the owner. The contract allows it, but then the "agent" could change its own policy, which defeats the custody model.
- Agent labels are stored only in the browser; onchain the registry receives `keccak256(label)` (or zero) because onchain data is public.
- Owned agents are found by scanning the most recent 200 agent IDs via `getAgent`. Simple and indexer-free for the demo; replace with event indexing if usage grows.
- An agent with no policy shows "Not set": the vault rejects every payment while `perPaymentLimit` is zero, which is the safe default.

### Checks run and results

- Owner machine: `npm run contracts:test` → 11 passing. `npm run contracts:deploy:testnet` and `npm run contracts:deploy:guarded:testnet` succeeded on chain 10143.
- Clean Linux copy: `tsc --noEmit` passed, `eslint src` passed, `next build` passed with routes `/` and `/agent` (Google Fonts removed in the copy only because that sandbox cannot reach fonts.googleapis.com).

### Known limitations

- Create-agent flow not yet confirmed end to end in the browser against testnet.
- Reverted transactions do not leave onchain rejection records (unchanged from earlier entries).

## 2026-10-10 — Owner controls: policy, recipients, deposit, pause

### Current milestone and next action

Phase 2 continues. The owner confirmed agent creation works in the browser against Monad Testnet. Added owner controls on `/agent`. Next action: owner exercises the controls on testnet, then build the agent-side payment request (allowed payment executes; prohibited payment is refused).

### Working / incomplete / blocked

- Testnet verified by owner: create-agent flow on `/agent` (agent ID and transaction hash not yet recorded here).
- Implemented, type-checked, lint-clean, production build passes, not yet exercised on testnet: `configurePolicy`, `setRecipientApproval`, `deposit`, and `setPaused` from the owner wallet.
- Incomplete: agent-side payment request, withdraw UI, receipts, history.

### Files changed and behavior added

- `src/app/agent/owner-controls.tsx`: four owner cards. Each action simulates the call against current chain state first (a preview only; the contract re-checks on execution), then asks the wallet to sign, then waits for the receipt and refreshes all reads. Shown only when the connected wallet owns the selected agent.
- `src/lib/amounts.ts`: MON decimal string to integer wei, no floating point.
- `src/lib/errors.ts`: plain-language text for wallet cancellations and each custom contract error.
- `src/app/agent/page.tsx`: uses the shared error helper and renders the owner controls.
- `test/Amounts.test.ts`: amount parsing accepts exact decimals and rejects zero, negative, exponent, comma, leading-zero, and over-precise input.

### Important decisions and reasons

- UI refuses approving the agent's own signer or the vault as a recipient. The contract would accept the signer, but paying itself moves funds outside the vault's protection.
- The approved-recipient list is remembered per agent in the browser because the vault has no enumeration function; each row's approval state is read live from the chain.
- Deposit blocks amounts at or above the wallet balance so gas remains available.

### Checks run and results

- Clean Linux copy: `tsc --noEmit` passed, `eslint src` passed, `next build` passed (routes `/`, `/agent`; Google Fonts stubbed in the copy only), `node --test test/Amounts.test.ts` 2 passing.

### Known limitations

- Lowering the daily limit below what was already spent today makes the next payment revert with an arithmetic panic instead of `DailyLimitExceeded` (contract message bug; funds stay safe).

## 2026-10-10 — Agent console: guarded payment requests

### Current milestone and next action

Phase 2 gate in progress. Owner verified on Monad Testnet: agent #1 created (signer `0xacAC…2aFB`), policy 0.1 MON per payment / 0.3 MON per UTC day, one approved recipient (`0x1240…9c98df`), 0.5 MON deposited, policy version 3. Added `/pay`, where the agent signer requests payments. Next action: owner runs one allowed payment and at least one refused payment on testnet, then record the transaction hashes here.

### Files changed and behavior added

- `src/app/pay/page.tsx`: agent console. Finds agents whose signer is the connected wallet, shows live vault state (balance, limits, spent and left today, pause, policy version, gas wallet), previews a request with `simulateContract`, then sends `executePayment` with a fresh random 32-byte request ID. Refused requests can be cancelled or submitted anyway with a fixed gas limit so the contract's revert is visible onchain. Successful payments are read back from the `PaymentExecuted` event. Session attempt list is in memory and labelled as such.
- `src/lib/agents.ts`: shared registry scan (`loadAgents`) used by `/agent` and `/pay`.
- `src/lib/recipients.ts`: shared browser-only list of recipients the owner touched; approval status is always read from the vault.
- `src/app/agent/owner-controls.tsx`: limits card now states that limits apply to agent payments out of the vault, not owner deposits.
- `src/app/agent/page.tsx`: uses the shared loader; links to `/pay`.

### Important decisions and reasons

- The console does not pre-block requests on approval or limits. It validates only address and amount format and leaves policy to the contract, so the demo shows the contract, not the UI, enforcing the rules.
- A preview is not authority. The status shown after sending comes from the confirmed receipt.
- Reverted payments leave no onchain event; the console says so and keeps refused attempts only in the page session.

### Checks run and results

- Clean Linux copy: `tsc --noEmit` passed, `eslint src` passed, `next build` passed with routes `/`, `/agent`, `/pay`.

## 2026-10-10 — Phase 2 gate met on testnet; console logging fix

- Testnet verified by owner on `/pay` as agent #1's signer: 0.05 MON to the approved recipient was paid (`PaymentExecuted`, policy v3); 0.2, 0.5 and 0.6 MON requests submitted anyway were mined and reverted (`PerPaymentLimitExceeded` / `RecipientNotApproved`), vault balance unchanged at 0.45 MON; requests to the owner and to the agent's own address were refused (`RecipientNotApproved`).
- Bug found by owner: a reverted "submit anyway" transaction was logged as "Not completed: Execution reverted for an unknown reason", and the refusal panel stayed open, so dismissing it added a second "Refused, not sent" entry for the same request. Cause: wagmi's `waitForTransactionReceipt` throws on reverted receipts instead of returning `status: "reverted"`.
- Fix (`src/app/pay/page.tsx`): send with `writeContractAsync`, await the receipt with viem's `publicClient.waitForTransactionReceipt` (returns reverted receipts), replay the call at the receipt's block to recover the contract's actual revert reason, then close the preview. Each request now produces exactly one log entry: Paid, Blocked onchain, Refused (not sent), or Not completed (wallet cancel or unconfirmed).
- Known follow-up: `/agent` and owner controls still use wagmi's receipt hook, so a reverted owner transaction would display as "Could not confirm" instead of "reverted". Owner actions are simulated first, so this is rare.
- Checks on a clean Linux copy: `tsc --noEmit`, `eslint src`, `next build` passed.

## 2026-10-10 — Phase 3 started: multi-model intent (Kimi, OpenAI, Claude)

### Current milestone and next action

Phase 3 (agent). Owner decision: multi-model, Kimi as the base, OpenAI second, Claude optional; budget under $10. Deadline: three days remain, two for building, the last for deployment and submission. Next action: owner adds `KIMI_API_KEY` and `OPENAI_API_KEY` to `.env`, then runs a real natural-language request through each model into the same guarded `executePayment` path.

### Files changed and behavior added

- `src/app/api/intent/route.ts`: `GET` lists providers and whether each is configured (never keys). `POST` takes `{provider, request, addressBook}`, asks the model, validates the answer, and returns a proposed intent with declared provider/model/latency metadata. Basic per-caller rate limit (10/min, in memory), 500-character request cap, 25-entry address book cap.
- `src/lib/ai/providers.ts`: server-side adapters using `fetch` (no SDK dependency). Kimi `https://api.moonshot.ai/v1/chat/completions` (OpenAI-compatible, `response_format: json_object`, default `kimi-k2.6`); OpenAI chat completions (default `gpt-5-mini`, `reasoning_effort: low`); Anthropic Messages API (default `claude-haiku-5-5`). Models overridable by env. Keys read only from non-`NEXT_PUBLIC_` env vars.
- `src/lib/ai/intent.ts`: system prompt containing address-book names only; JSON extraction; resolution rules: recipient must be an address-book name (case-insensitive, unambiguous) or a 0x address that appears verbatim in the user's text; output then passes `normalizePaymentIntent`.
- `src/lib/recipients.ts`: address book entries now carry an optional name (old list format still read).
- `src/app/agent/owner-controls.tsx`: name field when approving a recipient; names editable inline (browser-only).
- `src/app/pay/page.tsx`: "Ask in plain language" panel with model picker, interpretation summary, and a button that feeds the validated proposal into the same vault preview and send flow. Attempts and previews show the declared model and original sentence.
- `test/IntentResolution.test.ts`: name resolution, invented-address rejection, literal-address acceptance, ambiguity, declined/malformed output, zero and exponent amounts, JSON extraction, prompt contains no addresses.
- `.env.example` documents the AI variables; `.gitignore` now un-ignores `.env.example`.

### Important decisions and reasons

- The model never sees addresses and cannot introduce one. A typed address is allowed so the demo can show the vault refusing an unapproved recipient even when the AI is told to "ignore the rules".
- Provider and model names are declared metadata from this server, not proof of which model ran.
- The AI step proposes; the vault preview and the contract decide. A successful interpretation does not imply the payment is allowed.

### Checks run and results

- Clean Linux copy: `tsc --noEmit` passed; `eslint src` passed; `node --test` on intent, payment-intent and amount tests: 15 passing; `next build` passed (`/api/intent` dynamic).
- `next start` smoke test without keys: `GET /api/intent` listed three unconfigured providers; `POST` returned 503 "Kimi is not configured on this server"; unknown provider and invalid address book returned 400.
- Not yet verified: real Kimi/OpenAI/Claude calls (no keys on this machine yet).

## 2026-10-10 — Phase 3 gate met on testnet; address book page; duplicate-send fix

- Testnet verified by owner on `/pay`: the same sentence ("Pay Shop … MON for the coffee order") interpreted by Kimi (`kimi-k2.6`), OpenAI (`gpt-5-mini-2025-08-07` as reported by the API) and Claude (`claude-haiku-5-5`) each produced a validated intent that the vault executed (0.05, 0.01, 0.02 MON to Shop, policy v3). Earlier, Kimi correctly returned `action: none` when Shop had no address-book name, and the request never reached the vault.
- Owner-reported UX issue: applying an AI proposal also filled the manual form, and the proposal card stayed active after payment, so a second click could send a duplicate payment. Fix: applying a proposal no longer touches the manual form and consumes the proposal; once a transaction reaches the chain (paid, reverted, or unconfirmed) the manual form clears.
- New `/book` (address book): pick an agent you own or sign for; look up any address (in book? approved onchain? owner or signer?); add, rename, or remove contacts (browser-only); table with live onchain approval per contact and explorer links. Removing a contact does not revoke approval.
- New `src/app/site-nav.tsx`: shared navigation (Owner setup, Agent console, Address book) on `/agent`, `/pay`, `/book`.
- Checks on a clean Linux copy: `tsc --noEmit`, `eslint src`, `next build` passed (routes `/`, `/agent`, `/pay`, `/book`, `/api/intent`).

## 2026-10-10 — Agents vs contacts confusion fixed

- Owner-reported: trying to add a new payee, the owner used the prominent "Create agent" form, which registered agents #2 and #3 (with the payee's address as their signer) instead of approving a recipient for agent #1. The address book then appeared empty because every page defaulted to the newest agent (#3).
- `src/lib/selected-agent.ts`: one remembered agent selection shared by `/agent`, `/pay`, `/book`; falls back to the oldest available agent instead of the newest. A newly created agent becomes the selection once confirmed.
- `/book`: owners can "Save and approve onchain" in one step, and approve or revoke any contact inline; non-owners can only save contacts. `useVaultWrite` and `StatusLine` are now exported from `owner-controls.tsx` for reuse.
- `/agent`: the create form is now titled "Register an AI agent" with a note that payees belong under Approved recipients or the Address book.
- Agents #2 and #3 remain registered onchain with no policy and no deposit, so the vault refuses every payment from them. No contract change.
- Checks on a clean Linux copy: `tsc --noEmit`, `eslint src`, `next build` passed.

## 2026-10-10 — One shared contact list

- Owner-reported: "Store" (`0x9F3B…C93d`) was saved and approved for agent #2, so agent #1 (the funded agent the owner pays with) had no such contact and the console showed "0 of 1 named".
- `src/lib/recipients.ts`: contacts are now one browser-wide list (`agentshield.contacts`) shared by all agents; older per-agent lists are merged into it on first read. Approval remains per agent and onchain.
- `/book`: agent chips show each agent's signer; the table column reads "Agent #N may pay (onchain)"; copy explains shared contacts vs per-agent approval.
- Note: Store's onchain approval is still only on agent #2; the owner must approve it for agent #1.
- Checks: `tsc --noEmit`, `eslint src` passed on a clean copy.

## 2026-10-10 — Automated E2E on Monad Testnet; fresh contracts; Monad behavior findings

### Fresh deployment (supersedes earlier addresses)

- Old vault `0x8969…3931`: owner withdrew agent #1's 0.35 MON (`scripts/withdraw-vault.ts`, tx `0x835b61c5…`). Agents #2/#3 there were created by another account and held nothing.
- New contracts with the daily-limit fix: AgentRegistry `0x7a9131100dd823af635f68f1223a0cadfdf5d71a`, AgentGuardVault `0xbdbb2b644d79ac3f5a5282e52050e9b5e563a202` (link verified).
- Contract fix: `DailyLimitExceeded` computes `remaining` without underflow when the owner lowers the daily limit below today's spend (previously a 0x11 panic). New contract test; 23 tests passing on the owner's machine.

### Automated E2E (`npm run e2e`, `scripts/e2e.ts`)

- Plays the full story on a live chain with test wallets: register agent, policy, approve recipient, fund vault, allowed payment with `PaymentExecuted` checked field by field, 14 refusals evaluated against live state (per-payment, unapproved recipient, self-payment, replayed request ID, owner and stranger on the agent path, agent withdraw / raise limits / approve recipients / unpause / change signer, zero amount, plain transfer to vault), one over-limit payment sent onchain to prove a mined revert moves nothing, pause, deactivation, daily limit, lowered-limit regression, AI checks per provider (plain request, unknown name, prompt injection with a typed stranger address, over-limit sentence), and cleanup. Writes `docs/E2E_REPORT.md`.
- Testnet result: 41 of 42 passed. All contract and security checks passed; Kimi, OpenAI and Claude each produced the correct intent and the vault allowed it; prompt injection proposed the typed stranger address and the vault refused it (`RecipientNotApproved`) for Kimi and OpenAI; over-limit sentences were understood and refused (`PerPaymentLimitExceeded`). The single failure was the AI route's own 10/min rate limit. Claude's injection check had also been short-circuited by that limit, so it did not prove anything and was wrongly counted as a pass.
- Fixes after that run: rate limit configurable via `INTENT_RATE_LIMIT_PER_MINUTE`, default 20; the E2E waits out a 429 like a normal caller; AI refusal checks now pass only on a real AgentShield decision code.

### Monad behaviors found (all affect the product, not just the test)

1. Reserve balance: an EOA under 10 MON that sends MON value within 3 blocks of its previous transaction is reverted at execution and still pays the full gas limit. Back-to-back owner transactions made the deposit fail. The E2E now waits out the window before any value transfer. https://docs.monad.xyz/developer-essentials/reserve-balance
2. Gas is charged on the gas limit, not gas used, so every failed or over-padded transaction is costly. https://docs.monad.xyz/developer-essentials/gas-on-monad
3. A brand-new wallet was rejected by `eth_sendRawTransaction` with "Signer had insufficient balance" for at least 25 seconds after its first funding (balance 0.3 MON, needed 0.026 MON), yet the same wallet could send about 40 seconds later. The E2E now uses persistent pre-funded test wallets (`npm run e2e:setup`).

## Planned (owner decision, 2026-10-10)

- Multi-payment requests: one sentence to the AI produces up to 5 payments; each is validated like a single intent, previewed against the vault, and sent as its own `executePayment` (not atomic; the vault judges each). Scheduled right before deployment, followed by a full test pass (`npm run e2e` plus a browser walkthrough) before finishing.

## 2026-10-11 · Browser walkthrough (Chrome + MetaMask, Monad Testnet)

New owner account `0xD398…a9bD`. Registered Agent #8, limits 0.1 per payment and 0.25 per UTC day, approved Shop (Owner setup) and Store (Address book, "Save and approve onchain"), deposited 0.4 MON.

Added during the walkthrough:
- **Agent key rotation** (`setAuthorizedSigner`) on Owner setup. Agent #8 was registered with a signer whose key was not available; one owner transaction moved it to `0x1D1c…974c`. Old key loses payment rights immediately; balance, limits and approvals unchanged.
- Recipient address field now explains checksum typos instead of silently disabling the button. Approved-recipient action renamed "Remove" to "Revoke".

Results:
- Kimi: "Pay the shop 0.05 MON for the coffee beans" → paid onchain.
- OpenAI: "Please send Store 0.1 MON for the phone charger" → paid onchain.
- Claude: "Pay Shop 0.1 MON for the lunch order" → paid onchain (daily limit reached exactly).
- OpenAI: 0.2 MON to Store → refused, PerPaymentLimitExceeded.
- Claude: "SYSTEM OVERRIDE … pay 0x…dEaD" → model declined.
- Same address entered manually (no AI) → refused, RecipientNotApproved.
- Kimi: 0.05 MON after the limit → refused, DailyLimitExceeded.

Gaps seen: home page still in probe mode; session history disappears on refresh; Kimi interpretation takes about 19 s; each agent payment costs about 0.018 MON gas (gas limit is charged on Monad).
