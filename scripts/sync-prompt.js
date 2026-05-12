#!/usr/bin/env node
/**
 * scripts/sync-prompt.js
 *
 * Compile a merchant's prompt from templates + fragments, then push to Retell LLM.
 *
 * Usage:
 *   node scripts/sync-prompt.js --merchant <id>          # single merchant
 *   node scripts/sync-prompt.js --all                    # all merchants
 *   node scripts/sync-prompt.js --merchant <id> --dry-run --print  # preview only
 *
 * Options:
 *   --merchant <id>   Merchant id from data/merchants.json
 *   --all             Sync all merchants
 *   --dry-run         Compile but do not push to API
 *   --print           Print compiled prompt to stdout (useful with --dry-run)
 */

import 'dotenv/config';
import { program } from 'commander';
import chalk from 'chalk';
import { compilePrompt, loadMerchants, getMerchant } from '../src/core/prompt-compiler.js';
import { getClient } from '../src/api/retell-client.js';

program
  .name('sync-prompt')
  .description('Compile and push prompts from templates to Retell LLM')
  .option('--merchant <id>', 'Merchant ID from data/merchants.json')
  .option('--all',           'Sync all merchants in merchants.json')
  .option('--dry-run',       'Compile only, do not push to API')
  .option('--print',         'Print compiled prompt to stdout')
  .parse(process.argv);

const opts = program.opts();

if (!opts.merchant && !opts.all) {
  console.error(chalk.red('✖  Provide --merchant <id> or --all'));
  process.exit(1);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function syncMerchant(merchant, { dryRun, print }) {
  console.log(`\n${chalk.bold('▶')} ${chalk.cyan(merchant.id)} ${chalk.dim(`(${merchant.agent_id})`)}`);

  // 1. Compile
  let prompt;
  try {
    prompt = await compilePrompt(merchant);
  } catch (err) {
    console.error(chalk.red(`  ✖ Compile failed: ${err.message}`));
    return { id: merchant.id, success: false, error: err.message };
  }

  const lineCount = prompt.split('\n').length;
  const charCount = prompt.length;
  console.log(chalk.dim(`  Compiled: ${lineCount} lines, ${charCount} chars`));

  if (print) {
    console.log('\n' + chalk.dim('─'.repeat(60)));
    console.log(prompt);
    console.log(chalk.dim('─'.repeat(60)));
  }

  if (dryRun) {
    console.log(chalk.yellow('  (dry-run) Would push to LLM: ' + merchant.llm_id));
    return { id: merchant.id, success: true, dryRun: true };
  }

  // 2. Push to Retell LLM
  try {
    await getClient().llm.update(merchant.llm_id, { general_prompt: prompt });
    console.log(chalk.green(`  ✔ Pushed to LLM ${merchant.llm_id}`));
    return { id: merchant.id, success: true };
  } catch (err) {
    console.error(chalk.red(`  ✖ Push failed: ${err.message}`));
    return { id: merchant.id, success: false, error: err.message };
  }
}

async function main() {
  console.log('');
  console.log(chalk.bold.cyan('═══ Retell Prompt Sync ═══'));
  if (opts.dryRun) console.log(chalk.yellow('  DRY-RUN mode — prompts will not be pushed'));
  console.log('');

  const merchants = opts.all
    ? await loadMerchants()
    : [await getMerchant(opts.merchant)];

  const results = [];
  for (const merchant of merchants) {
    const result = await syncMerchant(merchant, {
      dryRun: !!opts.dryRun,
      print: !!opts.print,
    });
    results.push(result);
  }

  // Summary
  const ok  = results.filter((r) => r.success).length;
  const err = results.filter((r) => !r.success).length;
  console.log('');
  console.log(chalk.bold('Summary:'), chalk.green(`${ok} ok`), err ? chalk.red(`${err} failed`) : '');
  if (err > 0) process.exit(1);
}

main().catch((err) => {
  console.error(chalk.red('\n✖  ' + err.message));
  process.exit(1);
});
