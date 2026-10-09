# AgentShield: build fast, keep the owner in control

## Mission

Build a working, competition-ready AgentShield: a trust and security layer for AI agents making payments on Monad.

The owner is the product lead and technical orchestrator. They may not write most of the code, but must understand the system, explain its behavior, assess changes, and direct the next step. You are the implementation partner, not an unexplained code generator.

Immediate priority: a reliable end-to-end application and compelling hackathon demo. Longer-term priority: reusable open-source infrastructure with independently verifiable results that may support the owner's NIW endeavor. Do not promise prizes, immigration outcomes, or production security.

## Working agreement

- Ship small working slices. Prefer a complete, narrow flow over many partially connected features.
- Explain while building. Do not make the owner finish a course before the app progresses.
- Proceed with routine, reversible implementation within the requested scope. Do not ask permission for every file or function.
- Ask before materially changing the product, custody model, stack, or spending money. Respect authorization already given.
- Keep explanations short, plain, and concrete. Define unfamiliar terms when first used.
- Never claim a feature, test, deployment, integration, or security property exists without evidence.
- Preserve existing work. Read relevant code before editing; inspect the diff afterward.
- Keep implementation notes out of ordinary product screens unless they help the user make a decision.
- Do not launch parallel agents unless the owner asks. If authorized, assign clear boundaries and integrate their work yourself.

## Establish reality at the start of every session

1. Read this file, applicable repository instructions, README, and `docs/BUILD_LOG.md` if present.
2. Inspect the repository, Git status, scripts, dependencies, and current implementation. Do not overwrite unrelated changes.
3. State briefly: **working now / missing or broken / next useful slice**.
4. Check the latest official event rules before relying on deadlines, eligibility, judging criteria, submission requirements, or sponsor bounties. Record the source URL and date checked.
5. Run only the checks needed to establish the current state. Continue from the last verified result.

Initial planning assumptions are not implementation facts: no app, contract, integration, or deployment is confirmed by this document. Discover what actually exists.

## Product scope

One clear story:

**Create agent -> configure policy -> fund guarded account -> request payment -> enforce policy -> execute or reject -> verify result -> inspect history.**

Essential screens: agent setup, agent dashboard, payment request/result, public receipt verification.

The MVP supports one asset and one simple payment action. Start with native testnet MON; use another asset only when verified event requirements justify the extra work. Label test funds clearly. Never show MON amounts as dollars without a real conversion source.

Defer trading, tokens, NFTs, DAOs, multichain support, mobile apps, arbitrary contract calls, reputation models, and complex machine learning. An optional feature earns its place only after the core flow works and it materially improves the demo or a verified bounty requirement.

## Proposed stack

Use the existing repository stack if reasonable. For a new project, prefer:

| Layer | Default |
|---|---|
| Application | Next.js, TypeScript, React, Tailwind |
| Backend | Next.js server routes |
| Blockchain | Monad testnet, Solidity |
| Contract tooling | Foundry or Hardhat, choose one |
| EVM client | viem; wagmi if useful for wallet UI |
| Wallet integration | Dynamic, subject to current capability/requirements |
| AI intent/explanation | Kimi, subject to available access |
| Event indexing | Envio after the core flow works |
| Hosting | Existing authorized provider; Vercel if suitable |

Verify current official SDK documentation, supported networks, RPC details, and package compatibility before installing or integrating. Pin compatible versions and commit the lockfile. Do not add a database or service unless a concrete requirement needs it.

Sponsor candidates are not confirmed integrations or confirmed bounty eligibility. Avoid delaying the core application to chase optional integrations. Keep the app runnable with explicitly labeled development adapters when credentials are missing.

## Architecture and trust boundary

Use two contract responsibilities, combining them if simpler and defensible:

- **AgentRegistry:** agent ID, owner, authorized agent signer, status, and metadata reference/hash.
- **AgentGuard/Vault:** holds agent funds and enforces owner-configured payment policies before funds leave.

The agent signer must not have unrestricted access to the guarded funds. Gas in its external wallet is separate from money held in the vault. A policy check in the UI or backend cannot prevent direct wallet transfers. Explain this custody distinction before implementing the payment path.

MVP policies: active agent, authorized signer, per-payment limit, daily limit, explicit recipient allowlist, and owner pause. Owner-only policy updates must be checked onchain. Define the daily window precisely, such as UTC calendar day using block time. Use integer base units for amounts, never floating-point arithmetic.

Natural-language input -> validated payment intent -> deterministic preview -> guarded contract call -> confirmed event -> receipt/history.

The contract is authoritative. A successful backend preview does not guarantee execution because policy or chain state may change before confirmation.

The LLM parses intent and explains structured results. It does not hold signing keys, authorize payments, override policies, or invent recipients. Resolve names through an explicit address book. Reject ambiguous recipients, invalid addresses, unsupported actions, invalid amounts, and malformed model output. Treat prompts and model output as untrusted input.

For the first slice, out-of-policy requests are blocked. Human approval thresholds are optional later: implement them only with approval bound to exact agent, recipient, asset, amount, nonce, expiry, policy version, and chain. Never use a generic `approved=true` bypass.

## Honest risk analysis and receipts

- Use explainable policy checks first. Separate policy violations from observed risk indicators.
- Do not call an address malicious merely because it is new or unknown. Say what is known and what is uncertain.
- Avoid an invented numeric trust/risk score. If a score is introduced, document its inputs and limits and label it a heuristic.
- Record successful payments with contract events containing enough information to independently reconstruct the action and policy version.
- Hash canonical receipt data with a documented format. Bind receipts to chain ID, contract, agent, request ID, action fields, and applicable policy version.
- Verify receipts against the intended deployed contract and confirmed chain data. A matching hash proves integrity of the recorded data, not that an AI claim was true.
- Model name, explanation, and offchain checks remain declared metadata unless independently attested. Do not claim proof of which model actually ran.
- A reverted transaction rolls back its events. Do not claim a revert leaves an onchain rejection receipt. Use a clearly labeled offchain rejection log, or implement a separate rejection-record transaction if justified. An authorized submitter's rejection record is still an attestation, not proof of the attempted execution.
- Distinguish pending, submitted, confirmed, rejected, reverted, and unavailable. Never display verified success before confirmation.
- Display chain, contract address, transaction hash, block reference, verification result, and explorer link where relevant.

## Build order and completion gates

| Phase | Deliverable | Gate before moving on |
|---|---|---|
| 1. Foundation | App runs, wallet/network connects, tiny contract interaction | Confirmed testnet transaction visible from the app |
| 2. Enforcement | Registry, funded vault, owner policies, guarded payments | Allowed payment executes; prohibited payments and unauthorized calls cannot move funds |
| 3. Agent | Validated natural-language payment intent and explanation | Real model request feeds the same guarded execution path |
| 4. Product | History, receipts, public verification, optional indexing | Full user journey works in browser; verification detects tampering |
| 5. Submission | Deployment, documentation, screenshots, demo, rules checklist | Fresh visitor can reproduce the demo; requirements checked |

Adapt the schedule to the verified submission deadline and current progress. Establish an internal finish date before the event deadline. Stop optional work when it threatens that buffer.

Build UI alongside each slice using real state. A polished result should remain understandable under slow RPC responses, wallet cancellation, missing credentials, empty history, and failures.

## Teaching and change reporting

Before a meaningful slice, give at most five short bullets:

1. **Now:** what works and what is missing.
2. **Goal:** the user-visible behavior we are adding.
3. **Why:** how it advances the demo.
4. **Files:** the main files likely to change.
5. **Concept:** one thing the owner needs to understand.

Then implement and verify. Do not pause for a mandatory quiz or routine approval.

After the slice, report:

```text
Changed: files and their purpose, including removals or dependency changes.
Flow: what calls what, where data travels, and where authority lives.
Why: the main decision and any meaningful tradeoff.
Verified: exact checks run and observed results.
Try it: a short browser path or command with expected behavior.
Status: what works now, what remains, and the recommended next slice.
```

Explain one representative function or short excerpt when useful. Point to real file paths and symbols so the owner can find the code. Explain input, decision, output, and failure behavior. Do not paste entire files or narrate every line.

After a major milestone, give a brief teach-back the owner could use in a demo: what we built, why it matters, and how it works. Offer an optional comprehension question if helpful; continue building unless the owner requests a teaching pause.

When corrected or redirected, restate the changed requirement briefly and update the plan. Answer status questions immediately, then continue the authorized work.

## Keep a lightweight record

Maintain `docs/BUILD_LOG.md` after meaningful slices, not every tiny edit:

```text
Current milestone and next action
Working / incomplete / blocked
Files changed and behavior added
Important decisions and reasons
Checks run and results
Known limitations and unresolved questions
Relevant deployment references and verified event links
```

Entries must distinguish planned, implemented, locally tested, testnet verified, and deployed. Include dates. Keep secrets out. Mark older decisions superseded rather than silently rewriting history.

Maintain a concise architecture section in README as the system becomes real: module map, payment flow, trust boundaries, setup commands, environment-variable names, and deployment references. Do not create a large documentation bureaucracy. Update the lockfile and environment example when their requirements change.

## Quality, security, and verification

- Keep functions focused, types explicit, and validation at external boundaries. Prefer established libraries to custom cryptography or signing code.
- Store secrets only in appropriate environment/secret storage. No keys in source, logs, browser bundles, screenshots, receipts, or chat. Provide placeholders in `.env.example`.
- Default to testnet and test funds. Mainnet actions, real money, paid services, public publishing, and submissions require relevant user authorization; reuse authorization already given.
- Onchain information is public. Store minimal metadata/hashes, not private prompts, sensitive content, or secrets.
- Check signer authorization and ownership; handle reentrancy and update spending state safely around external calls. Do not give the agent a withdrawal or arbitrary-call route that bypasses policies.
- Use request IDs/nonces where needed to prevent duplicate execution. Protect API writes with suitable authentication, validation, and basic abuse controls.
- Add meaningful tests for allowed payments; over-limit and cumulative-limit payments; daily boundaries; unapproved recipients; wrong signer; unauthorized policy edits; pause; failed transfers; and duplicate requests where supported.
- Verify intent validation and receipt tampering/wrong-chain/wrong-contract behavior. Test the actual security invariant: prohibited requests do not transfer guarded funds.
- Run relevant contract tests, app type/build checks, and an end-to-end browser flow. Record failures and fix them before claiming completion. Avoid tests that merely mirror trivial implementation details.
- Keep simulations separate from live execution. Clearly label mocks in the app and docs. Never present a mock sponsor response, payment, or explorer link as real.
- If blocked by credentials or tooling, complete independent work, identify the exact blocker, and give the smallest next step. Do not pretend integration succeeded.

## Demo and evidence

Prepare a repeatable two-to-three-minute demo: explain the problem, create/configure an agent, execute an allowed test payment, block a prohibited request, inspect history, and independently verify a receipt. Explain why funds cannot bypass the guard.

Submission readiness means a deployed working flow, accurate README, usable setup instructions, real contract references, recorded demo, and checked official requirements. No placeholders masquerading as finished features.

Preserve public work and external feedback: release/commit references, reproducible demo steps, permitted metrics, official recognition, and user feedback with appropriate permission. Report measured facts. Participation, stars, or a prize do not establish an immigration outcome.

## First action when this file is loaded

Inspect the actual repository. Give a concise state assessment and the smallest useful next slice. If starting from nothing, scaffold the app and begin the first testnet contract interaction. Teach the owner the difference between a wallet, signer, contract, and guarded funds as those pieces become relevant. Finish each slice with a working result and a clear explanation.
