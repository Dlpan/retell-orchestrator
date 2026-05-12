/**
 * src/core/prompt-compiler.js
 *
 * Compiles a Handlebars prompt template for a given merchant.
 *
 * Flow:
 *   merchant config (data/merchants.json)
 *     + template (src/prompts/templates/<template>.md)
 *     + fragments (src/prompts/fragments/**\/*.md)
 *   → rendered prompt string
 *   → push to Retell LLM via retell-client
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import Handlebars from 'handlebars';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR  = path.resolve(__dirname, '../../src/prompts');
const MERCHANTS_FILE = path.resolve(__dirname, '../../data/merchants.json');

// ─── Handlebars helpers ───────────────────────────────────────────────────────

Handlebars.registerHelper('eq', (a, b) => a === b);
Handlebars.registerHelper('concat', (...args) => args.slice(0, -1).join(''));

// ─── Fragment registration ────────────────────────────────────────────────────

/**
 * Recursively walks `dir` and registers every .md file as a Handlebars partial.
 * The partial name is the relative path without extension, e.g. "rules/guardrails"
 */
async function registerFragments(dir, base = dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await registerFragments(fullPath, base);
    } else if (entry.name.endsWith('.md')) {
      const partialName = path
        .relative(base, fullPath)
        .replace(/\.md$/, '')
        .replace(/\\/g, '/');
      const content = await fs.readFile(fullPath, 'utf8');
      Handlebars.registerPartial(partialName, content);
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load all merchants from data/merchants.json.
 */
export async function loadMerchants() {
  const raw = await fs.readFile(MERCHANTS_FILE, 'utf8');
  return JSON.parse(raw);
}

/**
 * Find a single merchant by id.
 */
export async function getMerchant(id) {
  const merchants = await loadMerchants();
  const merchant = merchants.find((m) => m.id === id);
  if (!merchant) throw new Error(`Merchant "${id}" not found in merchants.json`);
  return merchant;
}

/**
 * Compile the prompt for a merchant config object.
 *
 * @param {object} merchant  — entry from merchants.json
 * @returns {Promise<string>} compiled prompt ready to push to Retell LLM
 */
export async function compilePrompt(merchant) {
  // Register all fragments as Handlebars partials
  const fragmentsDir = path.join(PROMPTS_DIR, 'fragments');
  await registerFragments(fragmentsDir);

  // Load the template
  const templatePath = path.join(PROMPTS_DIR, 'templates', `${merchant.template}.md`);
  const templateSrc = await fs.readFile(templatePath, 'utf8');

  // Compile and render
  const template = Handlebars.compile(templateSrc, { noEscape: true });
  return template(merchant).trim();
}

/**
 * Preview: compile and return prompt without pushing.
 */
export async function previewPrompt(merchantId) {
  const merchant = await getMerchant(merchantId);
  return compilePrompt(merchant);
}
