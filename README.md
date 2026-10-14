<p align="center">
  <img src="docs/banner.png" alt="AgentShield: give your AI agent a wallet, not a blank cheque" width="100%">
</p>

<p align="center">
  <a href="https://agentshield.munashemudabura.com"><b>Live app</b></a> &nbsp;·&nbsp;
  <a href="https://agentshield.munashemudabura.com/arena"><b>Try to rob our agent (no wallet needed)</b></a> &nbsp;·&nbsp;
  <a href="https://1drv.ms/v/c/0b7e4a9aa62ca320/IQDRfbJI8MOeRbOcMBivv5BaAY967xndRF096iy-xbpDFl8?e=y7A084"><b>Demo video</b></a> &nbsp;·&nbsp;
  <a href="https://1drv.ms/v/c/0b7e4a9aa62ca320/IQApcP6E7MePRoH6KGpnD0BjAUFSWuQt-Va-047XKtvXkQo?e=iVXNTq"><b>Pitch video</b></a>
</p>

<p align="center">
  Monad Metropolis Hackathon &nbsp;|&nbsp; Track 04: Trust, Identity &amp; AI Infrastructure &nbsp;|&nbsp; Built on Monad Testnet &nbsp;|&nbsp; Solo project by Munashe Mudabura
</p>

---

## What it is

AI agents are starting to pay for things on their own. Today that usually means giving the AI a wallet key, and if the AI is tricked or the key leaks, it can send money anywhere.

**AgentShield gives an AI agent a wallet, not a blank cheque.** The agent's money sits in a vault contract on Monad, and the vault checks the owner's rules on every payment:

- pay only the recipients the owner approved,
- stay under a per-payment and a daily limit,
- stop instantly if the owner pauses it,
- leave a public receipt for every payment.

The AI can only *ask* the vault to pay. Even a fully hijacked AI cannot move money the rules don't allow.

**Who it is for:** developers building AI agents that spend money (shopping agents, API-paying agents, assistants), and the people who own those agents.

## Try it in 60 seconds (no wallet needed)

1. Open **[agentshield.munashemudabura.com/arena](https://agentshield.munashemudabura.com/arena)**.
2. Keep **Compromised AI** selected (the AI will obey anything).
3. Click **Drain the vault**, then **Send**. The AI agrees, the vault refuses. 0 MON moved.
4. Try **Guarded AI** with **Honest request**: the agent pays the approved shop and you get a receipt.

## Features

- **Owner setup:** register an agent with its own key, set limits, approve recipients, deposit, withdraw, pause, rotate the key.
- **Plain-language payments:** "pay Shop 0.005 MON for coffee"; an AI turns it into a payment, the vault decides.
- **Signed mandates:** the owner signs a free one-off permission (one recipient, one budget, one time window).
- **x402 Guard:** agents paying for APIs are protected from overcharging, redirected payments and double charges.
- **Break the Agent:** a public challenge where anyone can attack a live agent.
- **Receipts and Verify API:** anyone can check a payment, and merchants can verify it with one call.
- **MCP server:** any AI app (Claude, Codex, Cursor, VS Code) can use the same vault and rules.

## How it works

```text
You: "Pay Shop 0.005 MON for coffee"
   -> AI model reads it and proposes a payment (it never sees keys)
   -> AgentShield app checks the proposal
   -> Vault contract on Monad checks every rule
   -> paid, with a public receipt   OR   refused, nothing moves
```

## How it uses Monad

- **All the rules live onchain.** Three Solidity contracts on Monad Testnet hold the money and enforce the policy, so neither the AI, an attacker, nor our own website can bend them.
- **Fast and cheap enough for agents.** Monad's quick blocks and low fees let an agent make many small payments and get a confirmed result in about a second, which is what an agent paying per API call needs.
- **EVM compatible.** Standard Solidity, OpenZeppelin and viem work unchanged, so other projects can plug in easily.

| Contract (Monad Testnet, chain 10143) | Address |
|---|---|
| AgentRegistry | [`0x7a9131100dd823af635f68f1223a0cadfdf5d71a`](https://testnet.monadvision.com/address/0x7a9131100dd823af635f68f1223a0cadfdf5d71a) |
| AgentGuardVault | [`0xbdbb2b644d79ac3f5a5282e52050e9b5e563a202`](https://testnet.monadvision.com/address/0xbdbb2b644d79ac3f5a5282e52050e9b5e563a202) |
| MandateExecutor | [`0x55285f1f98be674a64c51dc53316b62604d023f4`](https://testnet.monadvision.com/address/0x55285f1f98be674a64c51dc53316b62604d023f4) |

Example payment: [receipt](https://agentshield.munashemudabura.com/api/verify?tx=0x74c7bd3535ba8c29f1a76233456bfa409fdce39e28e1e823d5b32cee8a2dd251) for transaction `0x74c7bd35…2dd251`.

## Tech stack

Solidity 0.8.28 + OpenZeppelin, Hardhat 3, Next.js 16 + React 19, Tailwind CSS 4, wagmi + viem, Upstash Redis, Vercel, OpenAI GPT-5 mini and Moonshot Kimi K2.6 for reading requests, and a dependency-free MCP server in Node.js.

## Run it yourself

You need Node.js 22, npm, MetaMask on Monad Testnet, and test MON from [faucet.monad.xyz](https://faucet.monad.xyz).

```bash
git clone https://github.com/mudabs/AgentShield.git
cd AgentShield
npm install
cp .env.example .env     # fill in the values described in .env.example
npm run dev              # open http://localhost:3000
npm run contracts:test   # run the contract and unit tests
```

Full setup, deployment, environment variables, security model and architecture: **[docs/TECHNICAL.md](docs/TECHNICAL.md)**. App and MCP walkthrough: **[docs/USER_GUIDE.md](docs/USER_GUIDE.md)**.

---

## License

MIT. See [LICENSE](LICENSE).

## AI disclosure

This project was built with AI coding assistants: **Claude** (Anthropic: Claude Code, Claude app, Claude Desktop) and **Codex / ChatGPT** (OpenAI). They helped write and review code, contracts, tests, scripts, documentation and the demo video scripts. All output was reviewed, tested and deployed by the author. The demo video voiceover was generated with **ElevenLabs** from the author's own voice.

## Prior work and build window

The project was scaffolded with `create-next-app` on October 8, 2026. Everything else (contracts, app, API, MCP server, scripts, tests, docs) was built during the hackathon, October 8 to 13, 2026. OpenZeppelin Contracts are used as libraries, not copied.

## Acknowledgments

**Open-source libraries:** Next.js (MIT), React (MIT), wagmi (MIT), viem (MIT), TanStack Query (MIT), OpenZeppelin Contracts (MIT), Hardhat and hardhat-toolbox-viem (MIT), Solidity compiler (GPL-3.0, build tool only), Tailwind CSS (MIT), TypeScript (Apache-2.0), ESLint and typescript-eslint (MIT), Chai (MIT), dotenv (BSD-2-Clause), Geist font (SIL OFL 1.1), Model Context Protocol specification (MIT).

**AI models in the product:** OpenAI GPT-5 mini, Moonshot AI Kimi K2.6 (Anthropic Claude supported in code, off in the live app).

**Services:** Monad Testnet and its public RPC and explorer, Vercel (hosting), Upstash Redis (storage), MetaMask (wallet), GitHub (code and CI).

**Video, voice and images:** ElevenLabs (voiceover), HyperFrames (intro and launch videos), Kokoro TTS (draft narration), MusicGen by Meta (music bed), Puppeteer and Google Chrome (screen recording), FFmpeg (editing), Clipchamp and OBS Studio (editing and webcam), OneDrive (video hosting). The logo, favicon and banner were drawn in code with Claude.

**Ideas and standards we build on:** EIP-712 typed signatures, the x402 payment pattern (Coinbase), Google's AP2 mandates, ERC-8004 agent identity, and OWASP's "Excessive Agency" guidance for LLM apps.

**Trademarks:** Monad and Monad Metropolis names and logos belong to the Monad Foundation and are used only to show participation in the hackathon. Claude is a trademark of Anthropic; OpenAI, ChatGPT, Codex and GPT of OpenAI; Kimi of Moonshot AI; other names belong to their owners. No endorsement is implied.
