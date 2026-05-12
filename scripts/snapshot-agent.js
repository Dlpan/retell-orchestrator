#!/usr/bin/env node
/**
 * scripts/snapshot-agent.js
 * Save or restore a Retell agent's config snapshot.
 *
 * Usage:
 *   node scripts/snapshot-agent.js save   --agent <agentId> [--label <label>]
 *   node scripts/snapshot-agent.js list   --agent <agentId>
 *   node scripts/snapshot-agent.js restore --agent <agentId> --file <filename> [--dry-run]
 */

import 'dotenv/config';
import { program } from 'commander';
import chalk from 'chalk';
import { takeSnapshot, listSnapshots, restoreSnapshot } from '../src/core/retell-ops.js';

program.name('snapshot-agent').description('Snapshot and restore Retell agent configs');

program
  .command('save')
  .description('Save a snapshot of an agent\'s current config')
  .requiredOption('--agent <agentId>')
  .option('--label <label>', 'Human-readable label')
  .action(async (opts) => {
    console.log('');
    const emit = makeEmit();
    await takeSnapshot({ agentId: opts.agent, label: opts.label }, emit);
    console.log('');
  });

program
  .command('list')
  .description('List snapshots for an agent')
  .requiredOption('--agent <agentId>')
  .action(async (opts) => {
    const snaps = await listSnapshots(opts.agent);
    if (!snaps.length) { console.log('No snapshots found.'); return; }
    console.log('');
    console.log(chalk.bold('Snapshots:'));
    for (const s of snaps) {
      console.log(`  ${chalk.dim(s.createdAt.slice(0,19).replace('T',' '))}  ${s.filename}`);
      if (s.label) console.log(`    ${chalk.dim(s.label)}`);
    }
    console.log('');
  });

program
  .command('restore')
  .description('Restore an agent from a snapshot file')
  .requiredOption('--agent <agentId>')
  .requiredOption('--file <filename>', 'Snapshot filename from data/snapshots/')
  .option('--dry-run')
  .action(async (opts) => {
    console.log('');
    const emit = makeEmit();
    await restoreSnapshot({ agentId: opts.agent, filename: opts.file, dryRun: opts.dryRun }, emit);
    console.log('');
  });

program.parse(process.argv);

function makeEmit() {
  return function emit(event, payload) {
    const msg = typeof payload === 'string' ? payload : (payload.message ?? JSON.stringify(payload));
    switch (event) {
      case 'info':    console.log(chalk.dim('  ' + msg)); break;
      case 'success': console.log(chalk.green('  ✔ ' + msg)); break;
      case 'warn':    console.warn(chalk.yellow('  ⚠ ' + msg)); break;
      case 'error':   console.error(chalk.red('  ✖ ' + msg)); break;
    }
  };
}
