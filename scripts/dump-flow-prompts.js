#!/usr/bin/env node
/**
 * scripts/dump-flow-prompts.js
 *
 * Export all node instructions from a conversation-flow agent into a single
 * structured markdown file — ready to paste into an AI for review or editing.
 *
 * Usage:
 *   node scripts/dump-flow-prompts.js <agentId> [<agentId2> ...]
 *
 * Output:
 *   scripts/flow-dumps/<agentName>_<agentId>.md
 *
 * Workflow:
 *   1. Run this script to export the current node instructions
 *   2. Paste the markdown into an AI, describe the issue
 *   3. AI tells you which node(s) to update and what to change
 *   4. Apply changes via the Web UI (Flow Editor tab) or directly in Retell
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { listFlowNodes } from '../src/core/retell-ops.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'flow-dumps');

const ids = process.argv.slice(2);
if (!ids.length) {
  console.error('Usage: node scripts/dump-flow-prompts.js <agentId1> [<agentId2> ...]');
  process.exit(1);
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

for (const agentId of ids) {
  console.log(`\nFetching ${agentId}…`);

  let result;
  try {
    result = await listFlowNodes(agentId);
  } catch (err) {
    console.error(`  ✖ ${err.message}`);
    continue;
  }

  const { agentName, flowId, nodes } = result;

  if (nodes.length === 0) {
    console.warn(`  ⚠ No editable nodes found`);
    continue;
  }

  // ── Build markdown ────────────────────────────────────────────────────────
  const lines = [
    `# Flow Nodes — ${agentName}`,
    ``,
    `| Field | Value |`,
    `|-------|-------|`,
    `| Agent ID | \`${agentId}\` |`,
    `| Flow ID  | \`${flowId}\` |`,
    `| Nodes    | ${nodes.length} |`,
    ``,
    `---`,
    ``,
    `> **How to use this file with AI**`,
    `> Paste this document into your AI assistant and describe the issue you're seeing`,
    `> (e.g. "the agent hangs up too early" or "it doesn't collect the pet's name").`,
    `> The AI will tell you which node to edit and what to change.`,
    `> Then open the **Flow Editor** tab in the Web UI to apply the change.`,
    ``,
    `---`,
    ``,
  ];

  for (const node of nodes) {
    lines.push(
      `## ${node.name}`,
      ``,
      `| Field | Value |`,
      `|-------|-------|`,
      `| Node ID          | \`${node.id}\` |`,
      `| Type             | \`${node.type}\` |`,
      `| Instruction type | \`${node.instructionType}\` |`,
      ``,
      `### Instruction`,
      ``,
      node.text || '_(empty)_',
      ``,
      `---`,
      ``,
    );
  }

  // ── Write file ────────────────────────────────────────────────────────────
  const safeName = (agentName).replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename  = `${safeName}_${agentId}.md`;
  const filepath  = path.join(OUTPUT_DIR, filename);

  fs.writeFileSync(filepath, lines.join('\n'), 'utf8');
  console.log(`  ✅ Written: ${filepath}  (${nodes.length} node(s))`);
}
