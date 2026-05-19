#!/usr/bin/env node
/**
 * scripts/dump-prompts.js
 * 将指定 agents 的完整 prompt 写入本地 markdown 文件，用于分析结构
 * Usage: node scripts/dump-prompts.js <agentId1> <agentId2> ...
 * Output: scripts/prompt-dumps/<agentName>_<agentId>.md
 */
import 'dotenv/config';
import Retell from 'retell-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'prompt-dumps');

const ids = process.argv.slice(2);
if (!ids.length) {
  console.error('Usage: node scripts/dump-prompts.js <agentId1> <agentId2> ...');
  process.exit(1);
}

// 确保输出目录存在
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const client = new Retell({ apiKey: process.env.RETELL_API_KEY });

for (const id of ids) {
  const agent = await client.agent.retrieve(id);
  const llm   = await client.llm.retrieve(agent.response_engine.llm_id);

  const agentName = (agent.agent_name ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename  = `${agentName}_${id}.md`;
  const filepath  = path.join(OUTPUT_DIR, filename);

  const content = [
    `# Agent: ${agent.agent_name}`,
    ``,
    `| Field | Value |`,
    `|-------|-------|`,
    `| Agent ID | \`${id}\` |`,
    `| LLM ID   | \`${agent.response_engine.llm_id}\` |`,
    ``,
    `## Prompt`,
    ``,
    llm.general_prompt ?? '(no prompt)',
  ].join('\n');

  fs.writeFileSync(filepath, content, 'utf8');
  console.log(`✅ Written: ${filepath}`);
}
