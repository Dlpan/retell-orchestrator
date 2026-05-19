# Retell Orchestrator

A centralized management hub for [Retell AI](https://www.retellai.com/) voice agents — **Configuration as Code**.

Eliminates manual UI configuration by programmatically managing Custom Functions (Tools), Dynamic Variables, and Post Call Data Retrieval across multiple agents, with a built-in Web UI so the whole team can operate without touching the CLI.

---

## Features

| Feature | CLI | Web UI |
|---|---|---|
| **Sync** custom functions between agents | ✅ | ✅ |
| **Batch sync** to multiple agents at once | ✅ | ✅ |
| **Sync Vars & Tools** — sync dynamic variables and/or custom tools across engine types (retell-llm → retell-llm or conversation-flow) | ✅ | ✅ |
| **Sync Post Call Data** — sync post call analysis fields across any engine type | ✅ | ✅ |
| **Diff** two agents' tools side-by-side | ✅ | ✅ |
| **Snapshot** an agent's config | ✅ | ✅ |
| **Restore** from a previous snapshot | ✅ | ✅ |

---

## How Retell stores config

### retell-llm agents

```
agent.response_engine.llm_id
  └─ llm.general_tools[]               ← custom tools
  └─ llm.default_dynamic_variables{}
```

### conversation-flow agents

```
agent.response_engine.conversation_flow_id
  └─ flow.tools[]                      ← custom tools (custom-only, no system tools)
  └─ flow.default_dynamic_variables{}
```

### Post Call Data (all engine types)

```
agent.post_call_analysis_data[]        ← stored on the agent object itself
agent.post_call_analysis_model
```

Tool sync operations leave system tools (`end_call`, `transfer_call`, etc.) untouched. The **Sync Vars & Tools** feature handles cross-engine differences automatically, including the required `tool_id` field and `args_at_root` (Payload: args only) that conversation-flow tools require.

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
# Sync custom functions between agents (retell-llm only)
npm run sync -- --from <sourceAgentId> --to <targetAgentId> --dry-run
npm run sync -- --from <sourceAgentId> --to <targetAgentId>

# Sync dynamic variables and/or custom tools (cross-engine)
node scripts/sync-vars-and-tools.js --from <sourceAgentId> --to <targetAgentId> --dry-run

# Sync post call analysis fields
node scripts/sync-post-call-data.js --from <sourceAgentId> --to <targetAgentId> --dry-run

# Compare two agents
npm run diff -- --a <agentA> --b <agentB>

# Snapshot an agent's config
npm run snapshot -- save    --agent <agentId> --label "before-update"
npm run snapshot -- list    --agent <agentId>
npm run snapshot -- restore --agent <agentId> --file <filename> --dry-run
```

---

## CLI Options

### `sync-functions` (retell-llm only)

| Option | Default | Description |
|---|---|---|
| `--from <id>` | required | Source agent ID |
| `--to <id>` | required | Target agent ID |
| `--mode merge\|replace` | `merge` | `merge` upserts (keeps target-only tools); `replace` overwrites all custom tools |
| `--filter <names>` | all | Comma-separated tool names to sync |
| `--dry-run` | — | Preview without writing |
| `--verbose` | — | Print full JSON payloads |

### `sync-vars-and-tools` (cross-engine)

Syncs custom tools and/or dynamic variables from a **retell-llm** source to any target (retell-llm or conversation-flow).

| Option | Default | Description |
|---|---|---|
| `--from <id>` | required | Source agent ID (must be retell-llm) |
| `--to <id...>` | required | Target agent ID(s) — repeat for multiple |
| `--mode merge\|replace` | `merge` | merge upserts; replace overwrites |
| `--no-tools` | — | Skip custom tools sync |
| `--no-vars` | — | Skip dynamic variables sync |
| `--tool-filter <names>` | all | Comma-separated tool names to sync |
| `--var-filter <keys>` | all | Comma-separated variable keys to sync |
| `--dry-run` | — | Preview without writing |
| `--verbose` | — | Print full JSON payloads |

### `sync-post-call-data` (any engine type)

Syncs post call analysis fields from any source agent to any target agent(s).

| Option | Default | Description |
|---|---|---|
| `--from <id>` | required | Source agent ID |
| `--to <id...>` | required | Target agent ID(s) — repeat for multiple |
| `--mode merge\|replace` | `merge` | merge upserts by field name; replace overwrites |
| `--filter <names>` | all | Comma-separated field names to sync |
| `--sync-model` | — | Also sync the `post_call_analysis_model` setting |
| `--dry-run` | — | Preview without writing |

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
│   ├── api/retell-client.js          # Retell SDK wrapper
│   ├── core/retell-ops.js            # Business logic (sync / diff / snapshot)
│   ├── prompts/templates/            # Prompt templates for managed agents
│   └── server/
│       ├── index.js                  # Express server (SSE streaming)
│       └── public/index.html         # Web UI
├── scripts/
│   ├── sync-functions.js             # Sync custom tools CLI (retell-llm only)
│   ├── sync-vars-and-tools.js        # Sync vars + tools CLI (cross-engine)
│   ├── sync-post-call-data.js        # Sync post call data CLI
│   ├── diff-agents.js                # Diff CLI
│   ├── snapshot-agent.js             # Snapshot / restore CLI
│   └── dump-prompts.js               # Export agent prompts to markdown files
├── data/snapshots/                   # Local snapshot storage
├── .env.example                      # Environment variable template
└── package.json
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```env
RETELL_API_KEY=key_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Get your API key at [app.retellai.com/dashboard/api-key](https://app.retellai.com/dashboard/api-key).
