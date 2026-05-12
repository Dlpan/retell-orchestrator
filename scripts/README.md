# Scripts

## sync-functions.js — Sync custom functions between agents

将一个 Retell Agent 的 Custom Functions 同步到另一个 Agent 中去。

### 前置条件

```bash
cp .env.example .env        # 填入 RETELL_API_KEY
npm install
```

### 基本用法

```bash
# 将 agentA 的全部 functions 合并到 agentB（推荐）
node scripts/sync-functions.js --from <sourceAgentId> --to <targetAgentId>

# 先预览，不写入
node scripts/sync-functions.js --from <sourceAgentId> --to <targetAgentId> --dry-run

# 完全替换：target 上原有但 source 没有的 functions 会被删除
node scripts/sync-functions.js --from <sourceAgentId> --to <targetAgentId> --mode replace

# 只同步指定名称的 functions
node scripts/sync-functions.js --from <sourceAgentId> --to <targetAgentId> \
  --filter "bookAppointment,lookupPatient"

# 查看完整 JSON payload（调试用）
node scripts/sync-functions.js --from <sourceAgentId> --to <targetAgentId> --dry-run --verbose
```

### 参数说明

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `--from <agentId>` | ✅ | — | 源 Agent ID |
| `--to <agentId>` | ✅ | — | 目标 Agent ID |
| `--mode <merge\|replace>` | | `merge` | `merge`：保留 target 已有 functions，只覆盖同名 + 追加新增；`replace`：完全用 source 替换 |
| `--filter <names>` | | 全部 | 逗号分隔的 function 名称，只同步这些 |
| `--dry-run` | | false | 预览模式，不写入 API |
| `--verbose` | | false | 打印完整 JSON payload |

### 两种 mode 对比

```
Source functions:  [A, B, C]
Target functions:  [B, D]

merge  →  [A, B(覆盖), C, D]   ← 推荐：不破坏 target 独有的 D
replace → [A, B(覆盖), C]      ← 危险：D 被删除
```

### npm script 快捷方式

```bash
npm run sync-functions -- --from <src> --to <tgt> --dry-run
```
