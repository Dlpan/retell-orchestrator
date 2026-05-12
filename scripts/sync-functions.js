#!/usr/bin/env node
/**
 * scripts/sync-functions.js  — CLI wrapper
 * Core logic lives in src/core/retell-ops.js
 *
 * Usage:
 *   node scripts/sync-functions.js --from <agentId> --to <agentId> [options]
 *   node scripts/sync-functions.js --help
 */

import 'dotenv/config';
import { program } from 'commander';
import chalk from 'chalk';
import { syncTools } from '../src/core/retell-ops.js';

program
  .name('sync-functions')
  .description('Sync custom functions from one Retell agent to another')
  .requiredOption('--from <agentId>', 'Source agent ID')
  .requiredOption('--to <agentId>',   'Target agent ID (use --to multiple times for batch)')
  .option('--mode <mode>',    'merge | replace', 'merge')
  .option('--filter <names>', 'Comma-separated function names to sync')
  .option('--dry-run',        'Preview without writing')
  .option('--verbose',        'Show full JSON payloads')
  .parse(process.argv);

const opts = program.opts();

if (!['merge', 'replace'].includes(opts.mode)) {
  process.stderr.write(chalk.red(`✖  --mode must be "merge" or "replace"\n`));
  process.exit(1);
}

const filterSet = opts.filter
  ? new Set(opts.filter.split(',').map(s => s.trim()).filter(Boolean))
  : null;

const targets = Array.isArray(opts.to) ? opts.to : [opts.to];

if (targets.every(t => t === opts.from)) {
  process.stderr.write(chalk.red('✖  --from and --to must be different\n'));
  process.exit(1);
}

console.log('');
console.log(chalk.bold.cyan('═══ Retell Function Sync ═══'));
if (opts.dryRun) console.log(chalk.yellow('  DRY-RUN mode'));
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
      const icon = icons[payload.op] ?? ' ';
      console.log(`  ${icon} ${payload.name}${payload.description ? chalk.dim('  — ' + payload.description) : ''}`);
      if (opts.verbose && (payload.tool || payload.toolA)) {
        console.log(chalk.dim(JSON.stringify(payload.tool ?? payload.toolA, null, 2).split('\n').map(l => '    ' + l).join('\n')));
      }
      break;
    }
    case 'done': break;
    case 'close': break;
  }
}

syncTools({ from: opts.from, to: targets, mode: opts.mode, filter: filterSet, dryRun: opts.dryRun }, emit)
  .then(() => { console.log(''); })
  .catch(err => {
    console.error(chalk.red('\n✖  ' + err.message));
    process.exit(1);
  });
