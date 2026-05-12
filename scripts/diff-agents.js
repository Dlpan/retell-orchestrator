#!/usr/bin/env node
/**
 * scripts/diff-agents.js
 * Compare custom tools between two Retell agents.
 *
 * Usage:
 *   node scripts/diff-agents.js --a <agentId> --b <agentId>
 */

import 'dotenv/config';
import { program } from 'commander';
import chalk from 'chalk';
import { diffTools } from '../src/core/retell-ops.js';

program
  .name('diff-agents')
  .description('Compare custom tools between two Retell agents')
  .requiredOption('--a <agentId>', 'Agent A')
  .requiredOption('--b <agentId>', 'Agent B')
  .parse(process.argv);

const opts = program.opts();

console.log('');
console.log(chalk.bold.cyan('═══ Retell Agent Diff ═══'));
console.log('');

function emit(event, payload) {
  const msg = typeof payload === 'string' ? payload : (payload.message ?? '');
  switch (event) {
    case 'info':  console.log(chalk.dim('  ' + msg)); break;
    case 'error': console.error(chalk.red('  ✖ ' + msg)); break;
    case 'diff': {
      const map = {
        only_a:  chalk.blue('A only') + '  ',
        only_b:  chalk.magenta('B only') + '  ',
        changed: chalk.yellow('changed'),
        same:    chalk.dim('same   '),
      };
      const label = map[payload.op];
      if (label) console.log(`  ${label}  ${payload.name}`);
      break;
    }
    case 'done': {
      console.log('');
      console.log(chalk.bold('Summary:'));
      console.log(`  Only in A  : ${chalk.blue(payload.onlyInA.length)}`);
      console.log(`  Only in B  : ${chalk.magenta(payload.onlyInB.length)}`);
      console.log(`  Same       : ${chalk.dim(payload.inBoth.length)}`);
      console.log(`  Changed    : ${chalk.yellow(payload.changed.length)}`);
      break;
    }
  }
}

diffTools({ agentA: opts.a, agentB: opts.b }, emit)
  .then(() => console.log(''))
  .catch(err => {
    console.error(chalk.red('\n✖  ' + err.message));
    process.exit(1);
  });
