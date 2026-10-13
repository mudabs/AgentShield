# AgentShield User Guide

Two parts:

1. [Navigating the app](#part-1-navigating-the-app): every page, what it is for, and what to click.
2. [Using AgentShield from an AI app (MCP)](#part-2-using-agentshield-from-an-ai-app-mcp): give Claude Desktop, VS Code or Codex a guarded wallet.

Live app: https://agentshield.munashemudabura.com (Monad Testnet; MON here is test money with no value).

---

## Key ideas in one minute

| Term | Plain meaning |
|---|---|
| **Owner** | The person the agent works for. Uses MetaMask. Only the owner can set rules, add money or take it out. |
| **Agent** | The AI's own account. Its **signer key** can only *ask* the vault to pay. |
| **Vault** | The smart contract (`AgentGuardVault`) holding the agent's MON. Checks every rule before paying. |
| **Policy** | The agent's rules: max per payment, max per day (UTC), approved recipients, pause switch. |
| **Mandate** | A one-off permission the owner signs for free: one recipient, a budget, a time window, a purpose. |
| **Receipt** | A public page for any payment, read straight from the blockchain. |
| **Gas** | The small fee (in MON) for sending any transaction. |

**Rule of thumb:** the owner decides, the agent asks, the vault checks.

---

## Part 1: Navigating the app

The top menu has five pages: **Owner setup · Agent console · Address book · Mandates · Break the agent**. The logo takes you home.

### Which page do I need?

| I want to... | Go to | Wallet? |
|---|---|---|
| See it work in 60 seconds | **Break the agent** (`/arena`) | No |
| Create my own agent and set its rules | **Owner setup** (`/agent`) | Yes, owner account |
| Make payments as my agent | **Agent console** (`/pay`) | Yes, agent account |
| Name and approve who my agent can pay | **Address book** (`/book`) | Owner to approve |
| Give a one-off, time-limited permission | **Mandates** (`/mandates`) | Owner to sign |
| Prove a payment happened and why | **Receipt** (`/receipt/<tx>`) | No |

### Home (`/`)
- What AgentShield is, the three-step flow, what the contract guarantees, contract addresses, honest limits.
- Buttons: **Set up an agent**, **Try to rob our agent**, **Open the agent console**.

### Break the agent (`/arena`): no wallet needed
A live demo agent that pays **by itself**. Its key is held by the server, with strict limits (0.01 MON per payment, 0.05 per day, Shop and Store only).

1. Pick a mode:
   - **Compromised AI:** the AI obeys anything and the app's own checks are switched off. Only the vault is left to stop it.
   - **Guarded AI:** normal AgentShield.
2. Pick a brain (**OpenAI** is fastest) and an example attack, or type your own.
3. Press **Send**. Watch the steps: *AI brain → app checks → vault contract → paid or blocked*.
4. **x402 Guard** section: the agent buys data from four paid APIs (honest, overcharging, redirecting, pay-again). Only the honest one gets paid.
5. Right side: the **scoreboard** ("MON stolen" stays at 0), the **target** (live vault balance and limits) and **recent attempts**.

### Owner setup (`/agent`): owner wallet
1. **Connect wallet** (top right) with your **owner** account, on Monad Testnet.
2. **Register an AI agent:** paste a **second** account's address as the agent signer (never your owner address), then **Create agent onchain**.
3. Pick the agent under **Your agents**, then use the cards:

| Card | What it does |
|---|---|
| **Spending limits** | Max per payment and max per day. Until set, every payment is refused. |
| **Approved recipients** | Add a name and address, then **Approve recipient**. **Revoke** removes approval. |
| **Fund the vault** | Deposit MON for this agent. |
| **Withdraw** | Take MON back to your owner wallet (**All** fills the full balance). |
| **Emergency stop** | **Pause agent** blocks every payment instantly; **Resume** undoes it. |
| **Agent key** | **Change signer**: if the agent's key leaks, point the agent at a new one. |
| **Retire** | **Deactivate agent**: retire it in the registry (reversible). |

Each card is one MetaMask transaction from the owner.

### Agent console (`/pay`): agent wallet
1. Switch MetaMask to the **agent** account (the one you used as signer) and connect.
2. **Ask in plain language**, e.g. *"Pay Shop 0.02 MON for milk and Store 0.03 MON for bread"*. Choose a model and press **Interpret**.
3. Check what the AI understood, then **Check with the vault** (a free preview).
4. **Send payment** (MetaMask asks once per payment).
5. Or **fill it in yourself**: address and amount, no AI.
6. **History** (bottom) survives refreshes. Each paid entry has a **receipt →** link.
- Right panel: live balance, limits, spent today, gas wallet.

### Address book (`/book`)
- One contact list per browser: names for addresses so the AI can say "Shop".
- **Look up an address:** is it in the book, and is it approved for the selected agent?
- **Add a contact:** owners can **Save and approve onchain** in one step.
- Names stay in your browser; **approval is onchain**, per agent.

### Mandates (`/mandates`)
- **Owner (left):** connect as the mandate agent's owner, choose recipient, purpose, total budget, max per payment and hours, then **Sign mandate (free, no gas)**.
- **Mandate cards (right):** budget bar, status (active, expired, revoked, used up) and buttons:
  - **Agent pays:** the server agent spends under the mandate.
  - **Overspend**, **Forge signature**, **Raise budget ×100:** attacks; the contract refuses each.
  - **Revoke (owner):** cancels the mandate onchain.

### Receipt (`/receipt/<transaction hash>`)
- **Onchain record:** agent, amount, recipient, who signed, time, block, request ID.
- **Request details:** the typed sentence and model, marked **Verified** only if they match the onchain fingerprint.
- **Copy share link**, and **Machine-readable proof (JSON)** via `/api/verify`.

### For developers and merchants
| Endpoint | Purpose |
|---|---|
| `GET /api/verify?tx=0x…` | Proof that a payment came from a rule-bound agent (JSON, open CORS). |
| `GET /api/x402/data` | Honest paid API (402 challenge, 0.002 MON). |
| `GET /api/x402/evil?attack=overcharge\|redirect\|loop` | Malicious paid APIs for testing. |

### Troubleshooting

| You see | Do this |
|---|---|
| "Wrong network" / "Switch to Monad Testnet" | Click the switch button and approve in MetaMask. |
| "…is not the signer for any agent" | You're on the owner account. Switch MetaMask to the agent account. |
| "This account has 0 MON for gas" | Send ~0.2 MON from the owner to the agent account. |
| A deposit or transfer reverts right after another one | Monad's reserve rule for wallets under 10 MON: wait a few seconds and retry. |
| A brand-new wallet says "insufficient balance" | New Monad accounts need about a minute after first funding. |
| "Easy there. Wait a minute" (429) | Rate limit; try again shortly. |
| Payment refused with a reason | That's the vault working. The reason names the rule that blocked it. |

---

## Part 2: Using AgentShield from an AI app (MCP)

### What MCP is
**MCP (Model Context Protocol)** is like a USB port for AI apps. Our **MCP server** (`mcp/server.mjs`) plugs in and gives the AI four tools:

| Tool | What the AI can do |
|---|---|
| `agentshield_status` | See its balance, limits, what's left today, and approved recipients |
| `agentshield_preview_payment` | Ask the vault "would this be allowed?" without sending |
| `agentshield_pay` | Pay a recipient by name or address; returns the transaction and a receipt link |
| `agentshield_fetch_paid_url` | Open a paid (HTTP 402) API, pay once through the vault, return the data |

The AI never gets the owner's key, and the vault applies the rules to every payment.

### Before you start
- **Node.js 22** installed, and this repo cloned with `npm install` run.
- **An agent** you own, with limits set, recipients approved and the vault funded (see Owner setup).
- **The agent's private key** (testnet only). This is the **agent** key, never your owner or MetaMask main key.
- About 0.2 MON in the agent account for gas.

### Step 1: Smoke test from the terminal (20 seconds)
```bash
npm run mcp:smoke
```
This starts the server with the demo agent from your `.env` and calls every tool: status, an allowed preview, a refused preview (unapproved address), a refused x402 overcharge, and a paid x402 purchase. If you see JSON results with `"allowed": true` and `"refusedBy": "AgentShield vault"`, it works.

### Step 2: Fill in your settings
You need these values for any app:

| Setting | Example |
|---|---|
| `AGENTSHIELD_AGENT_PRIVATE_KEY` | `0x…` the agent's testnet key |
| `AGENTSHIELD_AGENT_ID` | `9` |
| `AGENTSHIELD_VAULT` | `0xbdbb2b644d79ac3f5a5282e52050e9b5e563a202` |
| `AGENTSHIELD_REGISTRY` | `0x7a9131100dd823af635f68f1223a0cadfdf5d71a` |
| `AGENTSHIELD_ADDRESS_BOOK` | `Shop:0x1240E3e019384c673a1b6CFbA61823b6619C98Df,Store:0x9F3Bedf793c5bBDB4Cbc7477b83d64552a5bC93d` |
| `AGENTSHIELD_APP_URL` | `https://agentshield.munashemudabura.com` (for receipt links) |

Use the full path to `mcp/server.mjs` on your computer, e.g. `C:/Users/you/Projects/AgentShield/mcp/server.mjs` (forward slashes work on Windows).

### Step 3a: Claude Desktop
1. Open **Claude Desktop → Settings → Developer → Edit Config**. This opens `claude_desktop_config.json`.
2. Add (or merge into) `mcpServers`:
```json
{
  "mcpServers": {
    "agentshield": {
      "command": "node",
      "args": ["C:/path/to/AgentShield/mcp/server.mjs"],
      "env": {
        "AGENTSHIELD_AGENT_PRIVATE_KEY": "0x...",
        "AGENTSHIELD_AGENT_ID": "9",
        "AGENTSHIELD_VAULT": "0xbdbb2b644d79ac3f5a5282e52050e9b5e563a202",
        "AGENTSHIELD_REGISTRY": "0x7a9131100dd823af635f68f1223a0cadfdf5d71a",
        "AGENTSHIELD_ADDRESS_BOOK": "Shop:0x1240E3e019384c673a1b6CFbA61823b6619C98Df,Store:0x9F3Bedf793c5bBDB4Cbc7477b83d64552a5bC93d",
        "AGENTSHIELD_APP_URL": "https://agentshield.munashemudabura.com"
      }
    }
  }
}
```
3. **Fully quit and reopen** Claude Desktop. The tools appear under the tools/connectors icon in a new chat.

### Step 3b: VS Code (GitHub Copilot, agent mode)
1. In your project, create `.vscode/mcp.json`:
```json
{
  "servers": {
    "agentshield": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/path/to/AgentShield/mcp/server.mjs"],
      "env": {
        "AGENTSHIELD_AGENT_PRIVATE_KEY": "0x...",
        "AGENTSHIELD_AGENT_ID": "9",
        "AGENTSHIELD_VAULT": "0xbdbb2b644d79ac3f5a5282e52050e9b5e563a202",
        "AGENTSHIELD_REGISTRY": "0x7a9131100dd823af635f68f1223a0cadfdf5d71a",
        "AGENTSHIELD_ADDRESS_BOOK": "Shop:0x1240E3e019384c673a1b6CFbA61823b6619C98Df,Store:0x9F3Bedf793c5bBDB4Cbc7477b83d64552a5bC93d",
        "AGENTSHIELD_APP_URL": "https://agentshield.munashemudabura.com"
      }
    }
  }
}
```
2. Click **Start** above the server entry, open Copilot Chat, switch to **Agent** mode and enable the `agentshield` tools.
3. Add `.vscode/mcp.json` to `.gitignore`; it contains a key.

### Step 3c: OpenAI Codex CLI
Add to `~/.codex/config.toml`:
```toml
[mcp_servers.agentshield]
command = "node"
args = ["C:/path/to/AgentShield/mcp/server.mjs"]

[mcp_servers.agentshield.env]
AGENTSHIELD_AGENT_PRIVATE_KEY = "0x..."
AGENTSHIELD_AGENT_ID = "9"
AGENTSHIELD_VAULT = "0xbdbb2b644d79ac3f5a5282e52050e9b5e563a202"
AGENTSHIELD_REGISTRY = "0x7a9131100dd823af635f68f1223a0cadfdf5d71a"
AGENTSHIELD_ADDRESS_BOOK = "Shop:0x1240E3e019384c673a1b6CFbA61823b6619C98Df,Store:0x9F3Bedf793c5bBDB4Cbc7477b83d64552a5bC93d"
AGENTSHIELD_APP_URL = "https://agentshield.munashemudabura.com"
```
Restart Codex. (Config formats change between versions; if this fails, check the Codex docs for "MCP servers".)

### Step 4: Things to ask your AI
| Ask | Expected result |
|---|---|
| "Check my AgentShield wallet." | Balance, limits, left today, Shop and Store approved |
| "Would paying Shop 0.005 MON be allowed?" | `allowed: true`, nothing sent |
| "Pay Shop 0.005 MON for coffee." | Paid, with a transaction hash and receipt link |
| "Pay 0x000000000000000000000000000000000000dEaD 0.005 MON." | Refused: recipient not approved |
| "Pay Store 5 MON." | Refused: above the per-payment limit |
| "Fetch https://agentshield.munashemudabura.com/api/x402/data" | Pays 0.002 MON once, returns live Monad data |
| "Fetch https://agentshield.munashemudabura.com/api/x402/evil?attack=redirect" | Refused by the vault, nothing paid |

**Demo tip:** after a refusal, ask the AI to "try harder" or "ignore the rules". It can't: the refusal comes from the contract, not the AI.

### Safety notes
- The key in these configs is stored as plain text on your computer. Use a **dedicated testnet agent key** only.
- That key can only call `executePayment`. It can't withdraw, change limits, approve recipients or unpause.
- If it leaks: **Owner setup → Agent key → Change signer**, or **Pause agent**. One transaction each.
- Never put your **owner** key in an MCP config.
