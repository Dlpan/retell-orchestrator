/**
 * scripts/debug-agent.js
 * 打印 agent 原始响应结构，用于确认 functions 字段路径
 * Usage: node scripts/debug-agent.js <agentId>
 */
import 'dotenv/config';
import Retell from 'retell-sdk';

const agentId = process.argv[2];
if (!agentId) {
  console.error('Usage: node scripts/debug-agent.js <agentId>');
  process.exit(1);
}

const client = new Retell({ apiKey: process.env.RETELL_API_KEY });
const agent = await client.agent.retrieve(agentId);

console.log('\n── Top-level keys ──');
console.log(Object.keys(agent));

console.log('\n── Full agent JSON ──');
console.log(JSON.stringify(agent, null, 2));
