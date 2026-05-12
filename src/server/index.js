/**
 * src/server/index.js
 *
 * Web server for retell-orchestrator.
 * Exposes a simple UI so non-CLI teammates can run sync / diff / snapshot ops.
 *
 * Start: node src/server/index.js
 * Then open: http://localhost:3000
 *
 * All long-running operations stream progress via Server-Sent Events (SSE)
 * so the browser shows a live log rather than waiting for a full response.
 */

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  syncTools,
  diffTools,
  takeSnapshot,
  listSnapshots,
  restoreSnapshot,
  listAgents,
} from '../core/retell-ops.js';
import {
  loadMerchants,
  getMerchant,
  compilePrompt,
} from '../core/prompt-compiler.js';
import { getClient } from '../api/retell-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── SSE helper ──────────────────────────────────────────────────────────────

/** Set up an SSE response and return an emit() function. */
function startSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  function emit(event, payload) {
    const data = typeof payload === 'string' ? { message: payload } : payload;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function close(success = true, extra = {}) {
    emit('close', { success, ...extra });
    res.end();
  }

  return { emit, close };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/** GET /api/agents — list all agents */
app.get('/api/agents', async (_req, res) => {
  try {
    const agents = await listAgents();
    res.json({ agents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/merchants — list all merchants from merchants.json */
app.get('/api/merchants', async (_req, res) => {
  try {
    const merchants = await loadMerchants();
    res.json({ merchants: merchants.map(m => ({ id: m.id, business_name: m.business_name, llm_id: m.llm_id })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/snapshots/:agentId — list snapshots for an agent */
app.get('/api/snapshots/:agentId', async (req, res) => {
  try {
    const snapshots = await listSnapshots(req.params.agentId);
    res.json({ snapshots });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/sync  (SSE)
 * Body: { from, to: string|string[], mode, filter, dryRun }
 */
app.post('/api/sync', async (req, res) => {
  const { from, to, mode = 'merge', filter, dryRun = false } = req.body ?? {};
  const { emit, close } = startSSE(res);

  if (!from || !to) {
    emit('error', { message: 'Missing required fields: from, to' });
    return close(false);
  }

  const targets = Array.isArray(to) ? to : [to];
  const filterSet = filter
    ? new Set(filter.split(',').map((s) => s.trim()).filter(Boolean))
    : null;

  try {
    const results = await syncTools(
      { from, to: targets, mode, filter: filterSet, dryRun },
      emit
    );
    close(true, { results });
  } catch (err) {
    emit('error', { message: err.message });
    close(false);
  }
});

/**
 * POST /api/diff  (SSE)
 * Body: { agentA, agentB }
 */
app.post('/api/diff', async (req, res) => {
  const { agentA, agentB } = req.body ?? {};
  const { emit, close } = startSSE(res);

  if (!agentA || !agentB) {
    emit('error', { message: 'Missing required fields: agentA, agentB' });
    return close(false);
  }

  try {
    const result = await diffTools({ agentA, agentB }, emit);
    close(true, result);
  } catch (err) {
    emit('error', { message: err.message });
    close(false);
  }
});

/**
 * POST /api/snapshot  (SSE)
 * Body: { agentId, label? }
 */
app.post('/api/snapshot', async (req, res) => {
  const { agentId, label } = req.body ?? {};
  const { emit, close } = startSSE(res);

  if (!agentId) {
    emit('error', { message: 'Missing required field: agentId' });
    return close(false);
  }

  try {
    const filepath = await takeSnapshot({ agentId, label }, emit);
    close(true, { filepath });
  } catch (err) {
    emit('error', { message: err.message });
    close(false);
  }
});

/**
 * POST /api/restore  (SSE)
 * Body: { agentId, filename, dryRun? }
 */
app.post('/api/restore', async (req, res) => {
  const { agentId, filename, dryRun = false } = req.body ?? {};
  const { emit, close } = startSSE(res);

  if (!agentId || !filename) {
    emit('error', { message: 'Missing required fields: agentId, filename' });
    return close(false);
  }

  try {
    await restoreSnapshot({ agentId, filename, dryRun }, emit);
    close(true);
  } catch (err) {
    emit('error', { message: err.message });
    close(false);
  }
});

/**
 * POST /api/sync-prompt  (SSE)
 * Body: { merchantId: string | '__all__', dryRun?: boolean, preview?: boolean }
 *
 * Compiles prompt(s) from templates + fragments and (unless dryRun) pushes to Retell LLM.
 * preview=true prints the compiled prompt text into the SSE stream.
 */
app.post('/api/sync-prompt', async (req, res) => {
  const { merchantId, dryRun = false, preview = false } = req.body ?? {};
  const { emit, close } = startSSE(res);

  if (!merchantId) {
    emit('error', { message: 'Missing required field: merchantId' });
    return close(false);
  }

  let merchants;
  try {
    merchants = merchantId === '__all__'
      ? await loadMerchants()
      : [await getMerchant(merchantId)];
  } catch (err) {
    emit('error', { message: err.message });
    return close(false);
  }

  const results = [];

  for (const merchant of merchants) {
    emit('info', { message: `▶ ${merchant.id}  (${merchant.llm_id})` });

    // 1. Compile
    let prompt;
    try {
      prompt = await compilePrompt(merchant);
    } catch (err) {
      emit('error', { message: `${merchant.id}: compile failed — ${err.message}` });
      results.push({ id: merchant.id, success: false });
      continue;
    }

    const lineCount = prompt.split('\n').length;
    emit('info', { message: `  Compiled: ${lineCount} lines, ${prompt.length} chars` });

    if (preview) {
      emit('preview', { id: merchant.id, prompt });
    }

    if (dryRun) {
      emit('warn', { message: `  (dry-run) Would push to LLM ${merchant.llm_id}` });
      results.push({ id: merchant.id, success: true, dryRun: true });
      continue;
    }

    // 2. Push to Retell LLM
    try {
      await getClient().llm.update(merchant.llm_id, { general_prompt: prompt });
      emit('success', { message: `  ✔ Pushed to LLM ${merchant.llm_id}` });
      results.push({ id: merchant.id, success: true });
    } catch (err) {
      emit('error', { message: `  ✖ Push failed — ${err.message}` });
      results.push({ id: merchant.id, success: false });
    }
  }

  const ok  = results.filter(r => r.success).length;
  const err = results.filter(r => !r.success).length;
  emit('info', { message: `\nSummary: ${ok} ok${err ? `, ${err} failed` : ''}` });
  close(ok === results.length);
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  retell-orchestrator UI → http://localhost:${PORT}\n`);
});
