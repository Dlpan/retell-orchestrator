#!/usr/bin/env node
/**
 * scripts/dump-prompts.js
 * 打印指定 agents 的完整 prompt，用于分析结构
 * Usage: node scripts/dump-prompts.js <agentId1> <agentId2> ...
 */
import 'dotenv/config';
import Retell from 'retell-sdk';

const ids = process.argv.slice(2);
if (!ids.length) {
  console.error('Usage: node scripts/dump-prompts.js <agentId1> <agentId2> ...');
  process.exit(1);
}

const client = new Retell({ apiKey: process.env.RETELL_API_KEY });

for (const id of ids) {
  const agent = await client.agent.retrieve(id);
  const llm   = await client.llm.retrieve(agent.response_engine.llm_id);

  console.log('\n' + '='.repeat(60));
  console.log(`AGENT : ${agent.agent_name}`);
  console.log(`ID    : ${id}`);
  console.log(`LLM   : ${agent.response_engine.llm_id}`);
  console.log('='.repeat(60));
  console.log(llm.general_prompt ?? '(no prompt)');
}
