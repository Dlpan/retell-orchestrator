#!/usr/bin/env node
/**
 * scripts/sync-post-call-data.js
 *
 * Sync Post Call Data Retrieval fields from one agent to one or more targets.
 *
 * post_call_analysis_data lives on the agent object itself, so this works
 * regardless of engine type — single-prompt (retell-llm) and conversation-flow
 * agents are both supported as source or target.
 *
 * Usage:
 *   node scripts/sync-post-call-data.js --from <agentId> --to <agentId> [options]
 *
 * Examples:
 *   # Sync all fields from a single-prompt agent to a conversation-flow agent
 *   node scripts/sync-post-call-data.js \
 *     --from agent_dc565489788859550a98e18f1f \
 *     --to   agent_7f14ac4c78d741448453a31074
 *
 *   # Sync specific fields only (merge mode, default)
 *   node scripts/sync-post-call-data.js \
 *     --from agent_dc565489788859550a98e18f1f \
 *     --to   agent_7f14ac4c78d741448453a31074 \
 *     --filter "call_outcome,customer_name,booking_confirmed"
 *
 *   # Replace all fields on target and also copy the model setting
 *   node scripts/sync-post-call-data.js \
 *     --from agent_dc565489788859550a98e18f1f \
 *     --to   agent_7f14ac4c78d741448453a31074 \
 *     --mode replace --sync-model
 *
 *   # Dry-run preview (no writes)
 *   node scripts/sync-post-call-data.js \
 *     --from agent_dc565489788859550a98e18f1f \
 *     --to   agent_7f14ac4c78d741448453a31074 \
 *     --dry-run
 */

import 'dotenv/config';
import { program } from 'commander';
import chalk from 'chalk';
import { syncPostCallData } from '../src/core/retell-ops.js';

program
  .name('sync-post-call-data')
  .description(
    'Sync Post Call Data Retrieval fields from any agent to one or more targets.\n' +
    'Works across engine types: retell-llm ↔ conversation-flow.'
  )
  .requiredOption('--from <agentId>',   'Source agent ID')
  .requiredOption('--to <agentId...>',  'Target agent ID(s) — repeat for multiple')
  .option('--mode <mode>',              'merge (default) | replace', 'merge')
  .option('--filter <names>',           'Comma-separated field names to sync (default: all)')
  .option('--sync-model',               'Also sync the post_call_analysis_model setting')
  .option('--dry-run',                  'Preview changes without writing')
  .parse(process.argv);

const opts = program.opts();

if (!['merge', 'replace'].includes(opts.mode)) {
  process.stderr.write(chalk.red('✖  --mode must be "merge" or "replace"\n'));
  process.exit(1);
}

const targets = Array.isArray(opts.to) ? opts.to : [opts.to];

const filter = opts.filter
  ? new Set(opts.filter.split(',').map((s) => s.trim()).filter(Boolean))
  : null;

console.log('');
console.log(chalk.bold.cyan('═══ Retell Post Call Data Sync ═══'));
if (opts.dryRun)   console.log(chalk.yellow('  DRY-RUN mode — no changes will be written'));
console.log(chalk.dim(`  Source     : ${opts.from}`));
console.log(chalk.dim(`  Target(s)  : ${targets.join(', ')}`));
console.log(chalk.dim(`  Mode       : ${opts.mode}`));
if (filter)        console.log(chalk.dim(`  Filter     : ${[...filter].join(', ')}`));
if (opts.syncModel) console.log(chalk.dim(`  Sync model : yes`));
console.log('');

function emit(event, payload) {
  const msg = typeof payload === 'string' ? payload : (payload.message ?? JSON.stringify(payload));
  switch (event) {
    case 'info':    console.log(chalk.dim('  ' + msg)); break;
    case 'success': console.log(chalk.green('  ✔ ' + msg)); break;
    case 'warn':    console.warn(chalk.yellow('  ⚠ ' + msg)); break;
    case 'error':   console.error(chalk.red('  ✖ ' + msg)); break;
    case 'diff': {
      const icons = { add: chalk.green('+'), update: chalk.yellow('~'), remove: chalk.red('-') };
      const icon  = icons[payload.op] ?? ' ';
      const desc  = payload.description ? chalk.dim('  — ' + payload.description) : '';
      console.log(`  ${icon} ${payload.name}${desc}`);
      break;
    }
    case 'done':
    case 'close':
      break;
  }
}

syncPostCallData(
  {
    from:      opts.from,
    to:        targets,
    mode:      opts.mode,
    filter,
    syncModel: opts.syncModel ?? false,
    dryRun:    opts.dryRun    ?? false,
  },
  emit
)
  .then(() => { console.log(''); })
  .catch((err) => {
    console.error(chalk.red('\n✖  ' + err.message));
    process.exit(1);
  });
