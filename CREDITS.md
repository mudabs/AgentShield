# Credits, AI disclosure and prior work

AgentShield is released under the [MIT License](LICENSE). This file credits every library, service, AI tool and media tool used to build the project, its documentation and its demo videos.

## AI coding tools (disclosure)

AI assistants were used throughout the build, as the hackathon rules require us to disclose:

| Tool | Provider | Used for |
|---|---|---|
| Claude (Claude Code, Claude app, Claude Desktop) | Anthropic | Writing and reviewing code, smart contracts, tests, scripts, documentation and the demo recording scripts |
| Codex | OpenAI | Writing and reviewing code |
| ChatGPT / OpenAI models | OpenAI | Planning, writing help |

All AI-assisted output was reviewed, tested and deployed by the author. The design decisions and the submission are the author's own.

## AI models used inside the product

| Model | Provider | Used for |
|---|---|---|
| GPT-5 mini | OpenAI | Turns a plain-language payment request into a structured intent (app and Break the Agent) |
| Kimi K2.6 | Moonshot AI | Alternative model for the same intent step |
| Claude | Anthropic | Supported as an optional model in the code; disabled in the live deployment |

## Pre-existing code

- The project was scaffolded with `create-next-app` (Next.js, Vercel) on October 8, 2026. Everything else in this repository (contracts, app, API routes, MCP server, scripts, tests and docs) was built during the hackathon period, October 8 to 13, 2026.
- Smart contracts import audited building blocks from OpenZeppelin Contracts (ReentrancyGuard, EIP712, ECDSA). These are used as libraries, not copied.

## Open-source libraries

| Library | License | Used for |
|---|---|---|
| [Next.js](https://nextjs.org) | MIT | Web app framework |
| [React](https://react.dev) / React DOM | MIT | User interface |
| [wagmi](https://wagmi.sh) | MIT | Wallet connection and contract calls in the browser |
| [viem](https://viem.sh) | MIT | Ethereum/Monad client, signing, ABI encoding (app, scripts, MCP server) |
| [TanStack Query](https://tanstack.com/query) | MIT | Data fetching and caching for wagmi |
| [OpenZeppelin Contracts](https://www.openzeppelin.com/contracts) | MIT | ReentrancyGuard, EIP712, ECDSA in the Solidity contracts |
| [Hardhat](https://hardhat.org) and hardhat-toolbox-viem | MIT | Compiling, testing and deploying contracts |
| [Solidity](https://soliditylang.org) compiler (solc) | GPL-3.0 | Compiling contracts (build tool only, not distributed) |
| [Tailwind CSS](https://tailwindcss.com) | MIT | Styling |
| [TypeScript](https://www.typescriptlang.org) | Apache-2.0 | Language and type checking |
| [ESLint](https://eslint.org) / typescript-eslint | MIT | Linting |
| [Chai](https://www.chaijs.com) | MIT | Test assertions |
| [dotenv](https://github.com/motdotla/dotenv) | BSD-2-Clause | Loading local environment variables |
| [Geist](https://vercel.com/font) font | SIL Open Font License 1.1 | Typography |
| [Model Context Protocol](https://modelcontextprotocol.io) specification | MIT | Protocol implemented by `mcp/server.mjs` (no SDK dependency) |

Standards and ideas we build on, with credit: EIP-712 (typed signatures), the x402 payment pattern (Coinbase), Google's Agent Payments Protocol (AP2) mandate concept, ERC-8004 (agent identity), and the OWASP guidance on "Excessive Agency" for LLM applications.

## Infrastructure and services

| Service | Used for |
|---|---|
| [Monad](https://monad.xyz) Testnet (chain 10143) | Where the contracts run |
| Monad Testnet public RPC and block explorer | Reading chain data and linking transactions |
| [Vercel](https://vercel.com) | Hosting the live site |
| [Upstash](https://upstash.com) Redis | Shared storage for the scoreboard, feed and mandates |
| [MetaMask](https://metamask.io) | Wallet used during development and testing |
| [GitHub](https://github.com) | Source code and CI |

## Demo video, voice and images

| Tool | Used for |
|---|---|
| [ElevenLabs](https://elevenlabs.io) | Voiceover for the demo video, generated from the author's own voice |
| [HyperFrames](https://www.npmjs.com/package/hyperframes) | Composing the intro and launch videos |
| [Kokoro TTS](https://huggingface.co/hexgrad/Kokoro-82M) (Apache-2.0) | Draft narration voice in the launch video |
| [MusicGen](https://github.com/facebookresearch/audiocraft) (Meta) | Background music bed in the launch video |
| [Puppeteer](https://pptr.dev) (Apache-2.0) and Google Chrome | Recording the live site for the walkthrough videos |
| [FFmpeg](https://ffmpeg.org) | Cutting, speeding, stitching and syncing video and audio |
| Claude (Anthropic) | Designing the AgentShield shield logo, favicon and banner (SVG/PNG drawn in code) and the video storyboards |
| Clipchamp / OBS Studio | Final editing and webcam recording |

## Trademarks

Monad, Monad Metropolis and their logos are marks of the Monad Foundation and are used only to identify this project's participation in the hackathon. Claude is a trademark of Anthropic. OpenAI, ChatGPT, Codex and GPT are trademarks of OpenAI. Kimi is a trademark of Moonshot AI. ElevenLabs, MetaMask, Vercel, Upstash and other names are trademarks of their owners. No endorsement is implied.
