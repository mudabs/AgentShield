# AgentShield MCP server

Give any MCP-capable AI app (Cursor, VS Code agents, Claude Desktop, Windsurf, ...) a **guarded wallet**. The AI gets four tools; every payment goes through the AgentShield vault on Monad Testnet, so the owner's onchain rules apply whatever the model is told.

| Tool | What it does |
|---|---|
| `agentshield_status` | Vault balance, per-payment and daily limits, what is left today, pause state, approved recipients |
| `agentshield_preview_payment` | Asks the vault, without sending, whether a payment would pass, and which rule would refuse it |
| `agentshield_pay` | Pays by address-book name or address; returns the transaction and a verifiable receipt link |
| `agentshield_fetch_paid_url` | Calls an HTTP 402 (x402-style) API, pays once through the vault, retries with proof |

No dependencies beyond `viem` (already in this repo). Plain JavaScript, so it runs with `node` from any folder.

## 1. Get an agent

Register an agent on the AgentShield site (Owner setup) with a separate signer account, set its limits, approve recipients and deposit. Or reuse the demo agent created by `npm run demo:setup`.

## 2. Add it to your AI app

Cursor (`~/.cursor/mcp.json`), Claude Desktop (`claude_desktop_config.json`) and most clients use the same shape:

```json
{
  "mcpServers": {
    "agentshield": {
      "command": "node",
      "args": ["C:/path/to/AgentShield/mcp/server.mjs"],
      "env": {
        "AGENTSHIELD_AGENT_PRIVATE_KEY": "0x... (the agent's testnet signer key)",
        "AGENTSHIELD_AGENT_ID": "9",
        "AGENTSHIELD_VAULT": "0xbdbb2b644d79ac3f5a5282e52050e9b5e563a202",
        "AGENTSHIELD_REGISTRY": "0x7a9131100dd823af635f68f1223a0cadfdf5d71a",
        "AGENTSHIELD_ADDRESS_BOOK": "Shop:0x1240E3e019384c673a1b6CFbA61823b6619C98Df,Store:0x9F3Bedf793c5bBDB4Cbc7477b83d64552a5bC93d",
        "AGENTSHIELD_APP_URL": "https://your-deployment.vercel.app"
      }
    }
  }
}
```

Then ask your AI: *"Check my AgentShield wallet, then pay Shop 0.005 MON for coffee."* or *"Fetch https://your-deployment.vercel.app/api/x402/data and tell me the latest block."*

## Why the key is safe(r) here

The key in this config can only call `executePayment`. It cannot withdraw, change limits, approve recipients or unpause. If the AI is prompt-injected, or the config leaks, the worst case is bounded by the owner's onchain policy, and the owner can rotate the key or pause the agent in one transaction.

## Smoke test

`npm run mcp:smoke` starts the server with the demo agent from `.env` and calls `agentshield_status`, previews an allowed and a refused payment, and (if `AGENTSHIELD_APP_URL` is set or the dev server is running) buys the x402 demo data.
