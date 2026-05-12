# Retell Orchestrator

A centralized management hub for [Retell AI](https://www.retellai.com/) voice agents — **Configuration as Code**.

Eliminates manual UI configuration by programmatically managing Custom Functions (Tools) across multiple agents, with a built-in Web UI so the whole team can operate without touching the CLI.

---

## Features

| Feature | CLI | Web UI |
|---|---|---|
| **Sync** custom functions between agents | ✅ | ✅ |
| **Batch sync** to multiple agents at once | ✅ | ✅ |
| **Diff** two agents' tools side-by-side | ✅ | ✅ |
| **Snapshot** an agent's config | ✅ | ✅ |
| **Restore** from a previous snapshot | ✅ | ✅ |

---

## How Retell stores custom functions

```
agent.response_engine.llm_id
  └─ llm.general_tools[]
       └─ { type: 'custom', name, url, parameters, ... }
```

All operations read/write through the LLM layer, leaving system tools (`end_call`, `transfer_call`, etc.) untouched.

---

## Quick Start

```bash
git clone https://github.com/Dlpan/retell-orchestrator.git
cd retell-orchestrator

cp .env.example .env      # add your RETELL_API_KEY
npm install
```

### Web UI (recommended for teams)

```bash
npm run ui
# → http://localhost:3000
```

### CLI

```bash
# Sync custom functions between agents
npm run sync -- --from <sourceAgentId> --to <targetAgentId> --dry-run
npm run sync -- --from <sourceAgentId> --to <targetAgentId>

# Compare two agents
npm run diff -- --a <agentA> --b <agentB>

# Snapshot an agent's config
npm run snapshot -- save   --agent <agentId> --label "before-update"
npm run snapshot -- list   --agent <agentId>
npm run snapshot -- restore --agent <agentId> --file <filename> --dry-run
```

---

## CLI Options

### `sync-functions`

| Option | Default | Description |
|---|---|---|
| `--from <id>` | required | Source agent ID |
| `--to <id>` | required | Target agent ID |
| `--mode merge\|replace` | `merge` | `merge` upserts (keeps target-only tools); `replace` overwrites all custom tools |
| `--filter <names>` | all | Comma-separated tool names to sync |
| `--dry-run` | — | Preview without writing |
| `--verbose` | — | Print full JSON payloads |

**merge vs replace:**
```
Source: [A, B, C]   Target: [B, D]

merge   → [A, B(overwrite), C, D]   ← safe, keeps D
replace → [A, B(overwrite), C]      ← removes D
```

---

## Project Structure

```
retell-orchestrator/
├── src/
│   ├── api/retell-client.js      # Retell SDK wrapper
│   ├── core/retell-ops.js        # Business logic (sync / diff / snapshot)
│   └── server/
│       ├── index.js              # Express server (SSE streaming)
│       └── public/index.html     # Web UI
├── scripts/
│   ├── sync-functions.js         # Sync CLI
│   ├── diff-agents.js            # Diff CLI
│   └── snapshot-agent.js         # Snapshot / restore CLI
├── data/snapshots/               # Local snapshot storage
├── .env.example                  # Environment variable template
└── package.json
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```env
RETELL_API_KEY=key_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Get your API key at [app.retellai.com/dashboard/api-key](https://app.retellai.com/dashboard/api-key).
