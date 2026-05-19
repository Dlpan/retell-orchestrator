#!/usr/bin/env node
/**
 * scripts/sync-vars-and-tools.js
 *
 * Sync default_dynamic_variables and/or custom tools from a retell-llm source
 * agent to one or more targets (retell-llm OR conversation-flow).
 *
 * Usage:
 *   node scripts/sync-vars-and-tools.js --from <agentId> --to <agentId> [options]
 *
 * Examples:
 *   # Sync everything (tools + vars) from Maddies → template flow agent
 *   node scripts/sync-vars-and-tools.js \
 *     --from agent_fd2693101dd9ae40a0471274c9 \
 *     --to   agent_7f14ac4c78d741448453a31074
 *
 *   # Dry-run, tools only
 *   node scripts/sync-vars-and-tools.js \
 *     --from agent_fd2693101dd9ae40a0471274c9 \
 *     --to   agent_7f14ac4c78d741448453a31074 \
 *     --no-vars --dry-run
 *
 *   # Vars only, specific keys
 *   node scripts/sync-vars-and-tools.js \
 *     --from agent_fd2693101dd9ae40a0471274c9 \
 *     --to   agent_7f14ac4c78d741448453a31074 \
 *     --no-tools --var-filter "business_name,business_phone,working_hours"
 */

import 'dotenv/config';
import { program } from 'commander';
import chalk from 'chalk';
import { syncVarsAndTools } from '../src/core/retell-ops.js';

program
  .name('sync-vars-and-tools')
  .description('Sync dynamic variables and/or custom tools from a retell-llm agent to any target agent (including conversation-flow)')
  .requiredOption('--from <agentId>',      'Source agent ID (must be retell-llm)')
  .requiredOption('--to <agentId...>',     'Target agent ID(s) — repeat for multiple')
  .option('--mode <mode>',                 'merge (default) | replace', 'merge')
  .option('--no-tools',                    'Skip custom tools sync')
  .option('--no-vars',                     'Skip dynamic variables sync')
  .option('--tool-filter <names>',         'Comma-separated tool names to sync')
  .option('--var-filter <keys>',           'Comma-separated variable keys to sync')
  .option('--dry-run',                     'Preview without writing')
  .option('--verbose',                     'Show full JSON payloads')
  .parse(process.argv);

const opts = program.opts();

if (!['merge', 'replace'].includes(opts.mode)) {
  process.stderr.write(chalk.red('✖  --mode must be "merge" or "replace"\n'));
  process.exit(1);
}

const targets = Array.isArray(opts.to) ? opts.to : [opts.to];

const toolFilter = opts.toolFilter
  ? new Set(opts.toolFilter.split(',').map((s) => s.trim()).filter(Boolean))
  : null;

const varFilter = opts.varFilter
  ? new Set(opts.varFilter.split(',').map((s) => s.trim()).filter(Boolean))
  : null;

console.log('');
console.log(chalk.bold.cyan('═══ Retell Vars + Tools Sync ═══'));
if (opts.dryRun) console.log(chalk.yellow('  DRY-RUN mode — no changes will be written'));
console.log(chalk.dim(`  Source : ${opts.from}`));
console.log(chalk.dim(`  Target : ${targets.join(', ')}`));
console.log(chalk.dim(`  Mode   : ${opts.mode}`));
console.log(chalk.dim(`  Sync   : ${[opts.tools && 'tools', opts.vars && 'vars'].filter(Boolean).join(' + ')}`));
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
    case 'done':  break;
    case 'close': break;
  }
}

syncVarsAndTools(
  {
    from:       opts.from,
    to:         targets,
    mode:       opts.mode,
    syncTools:  opts.tools,
    syncVars:   opts.vars,
    toolFilter,
    varFilter,
    dryRun:     opts.dryRun ?? false,
  },
  emit
)
  .then(() => { console.log(''); })
  .catch((err) => {
    console.error(chalk.red('\n✖  ' + err.message));
    process.exit(1);
  });
