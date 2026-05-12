/**
 * src/core/retell-ops.js
 *
 * Pure business logic for all Retell orchestration operations.
 * No CLI / HTTP concerns here — consumed by both scripts/ and src/server/.
 *
 * Each function accepts an `emit(event, payload)` callback so callers
 * (CLI or SSE stream) can render progress however they like.
 *
 * emit events: 'info' | 'success' | 'warn' | 'error' | 'diff' | 'done'
 */

import fs from 'fs/promises';
import path from 'path';
import {
  getAgentMeta,
  getAgentCustomTools,
  setLlmTools,
  getAgent,
  getLlmForAgent,
  getClient,
} from '../api/retell-client.js';

// ─── 1. SYNC ──────────────────────────────────────────────────────────────────

/**
 * Sync custom tools from one agent to one or more targets.
 *
 * @param {object} opts
 * @param {string}   opts.from       Source agent ID
 * @param {string[]} opts.to         Target agent ID(s)
 * @param {'merge'|'replace'} opts.mode
 * @param {Set<string>|null} opts.filter  Names to sync (null = all)
 * @param {boolean}  opts.dryRun
 * @param {Function} emit            (event, payload) => void
 * @returns {Promise<object[]>}      Array of per-target results
 */
export async function syncTools({ from, to, mode = 'merge', filter = null, dryRun = false }, emit) {
  emit('info', `Fetching source agent metadata…`);
  const srcMeta = await getAgentMeta(from);
  assertRetellLlm(srcMeta, 'source', emit);

  emit('info', `Source: ${srcMeta.name} (LLM: ${srcMeta.llmId})`);

  const srcData = await getAgentCustomTools(from);
  emit('info', `Source has ${srcData.customTools.length} custom tool(s)`);

  // Apply filter
  let toolsToSync = srcData.customTools;
  if (filter && filter.size > 0) {
    toolsToSync = srcData.customTools.filter((t) => filter.has(t.name));
    if (toolsToSync.length === 0) {
      emit('warn', `No tools matched filter [${[...filter].join(', ')}]. Available: ${srcData.customTools.map(t => t.name).join(', ') || '(none)'}`);
      return [];
    }
    emit('info', `Filter applied → ${toolsToSync.length} tool(s)`);
  }

  const results = [];

  for (const targetId of to) {
    emit('info', `\n── Target: ${targetId}`);
    try {
      const result = await _syncToTarget({ targetId, toolsToSync, mode, filter, dryRun }, emit);
      results.push({ targetId, ...result });
    } catch (err) {
      emit('error', `Failed for target ${targetId}: ${err.message}`);
      results.push({ targetId, success: false, error: err.message });
    }
  }

  return results;
}

async function _syncToTarget({ targetId, toolsToSync, mode, filter, dryRun }, emit) {
  const tgtMeta = await getAgentMeta(targetId);
  assertRetellLlm(tgtMeta, 'target', emit);
  emit('info', `  Name: ${tgtMeta.name} (LLM: ${tgtMeta.llmId})`);

  const tgtData = await getAgentCustomTools(targetId);
  const nonCustomTools = tgtData.allTools.filter((t) => t.type !== 'custom');

  // Build new custom tools list
  let newCustomTools;
  if (mode === 'replace') {
    if (filter && filter.size > 0) {
      const kept = tgtData.customTools.filter((t) => !filter.has(t.name));
      newCustomTools = [...kept, ...toolsToSync];
    } else {
      newCustomTools = toolsToSync;
    }
  } else {
    const tgtMap = new Map(tgtData.customTools.map((t) => [t.name, t]));
    for (const t of toolsToSync) tgtMap.set(t.name, t);
    newCustomTools = [...tgtMap.values()];
  }

  // Diff
  const tgtNames = new Set(tgtData.customTools.map((t) => t.name));
  const syncNames = new Set(toolsToSync.map((t) => t.name));
  const added   = toolsToSync.filter((t) => !tgtNames.has(t.name));
  const updated = toolsToSync.filter((t) =>  tgtNames.has(t.name));
  const removed = mode === 'replace'
    ? (filter ? tgtData.customTools.filter(t => filter.has(t.name) && !syncNames.has(t.name))
              : tgtData.customTools.filter(t => !syncNames.has(t.name)))
    : [];

  for (const t of added)   emit('diff', { op: 'add',    name: t.name, description: t.description });
  for (const t of updated) emit('diff', { op: 'update', name: t.name, description: t.description });
  for (const t of removed) emit('diff', { op: 'remove', name: t.name });

  if (added.length === 0 && updated.length === 0 && removed.length === 0) {
    emit('info', '  No changes needed');
    return { success: true, added: 0, updated: 0, removed: 0, noChange: true };
  }

  if (!dryRun) {
    await setLlmTools(tgtMeta.llmId, [...nonCustomTools, ...newCustomTools]);
    emit('success', `  ✔ Applied: +${added.length} ~${updated.length} -${removed.length}`);
  } else {
    emit('info', `  (dry-run) Would apply: +${added.length} ~${updated.length} -${removed.length}`);
  }

  return { success: true, added: added.length, updated: updated.length, removed: removed.length };
}

// ─── 2. DIFF ──────────────────────────────────────────────────────────────────

/**
 * Compare custom tools between two agents and emit a structured diff.
 *
 * @param {{ agentA: string, agentB: string }} opts
 * @param {Function} emit
 * @returns {Promise<{ onlyInA: string[], onlyInB: string[], inBoth: string[], changed: string[] }>}
 */
export async function diffTools({ agentA, agentB }, emit) {
  emit('info', 'Fetching both agents…');
  const [metaA, metaB] = await Promise.all([getAgentMeta(agentA), getAgentMeta(agentB)]);
  assertRetellLlm(metaA, 'Agent A', emit);
  assertRetellLlm(metaB, 'Agent B', emit);

  emit('info', `Agent A: ${metaA.name}`);
  emit('info', `Agent B: ${metaB.name}`);

  const [dataA, dataB] = await Promise.all([
    getAgentCustomTools(agentA),
    getAgentCustomTools(agentB),
  ]);

  const mapA = new Map(dataA.customTools.map((t) => [t.name, t]));
  const mapB = new Map(dataB.customTools.map((t) => [t.name, t]));

  const allNames = new Set([...mapA.keys(), ...mapB.keys()]);
  const onlyInA = [], onlyInB = [], inBoth = [], changed = [];

  for (const name of allNames) {
    if (!mapB.has(name)) {
      onlyInA.push(name);
      emit('diff', { op: 'only_a', name, tool: mapA.get(name) });
    } else if (!mapA.has(name)) {
      onlyInB.push(name);
      emit('diff', { op: 'only_b', name, tool: mapB.get(name) });
    } else {
      const toolA = mapA.get(name);
      const toolB = mapB.get(name);
      const sigA = JSON.stringify({ url: toolA.url, parameters: toolA.parameters, description: toolA.description });
      const sigB = JSON.stringify({ url: toolB.url, parameters: toolB.parameters, description: toolB.description });
      if (sigA !== sigB) {
        changed.push(name);
        emit('diff', { op: 'changed', name, toolA, toolB });
      } else {
        inBoth.push(name);
        emit('diff', { op: 'same', name });
      }
    }
  }

  emit('done', { onlyInA, onlyInB, inBoth, changed });
  return { onlyInA, onlyInB, inBoth, changed };
}

// ─── 3. SNAPSHOT ─────────────────────────────────────────────────────────────

const SNAPSHOTS_DIR = new URL('../../data/snapshots', import.meta.url).pathname;

/**
 * Export an agent's full config (LLM + tools) to a JSON snapshot file.
 *
 * @param {{ agentId: string, label?: string }} opts
 * @param {Function} emit
 * @returns {Promise<string>} path to written snapshot file
 */
export async function takeSnapshot({ agentId, label }, emit) {
  emit('info', `Fetching agent ${agentId}…`);
  const meta = await getAgentMeta(agentId);
  assertRetellLlm(meta, 'agent', emit);

  const { llm } = await getLlmForAgent(agentId);

  const snapshot = {
    version: 1,
    createdAt: new Date().toISOString(),
    label: label ?? `snapshot-${meta.name}-${Date.now()}`,
    agent: { id: meta.id, name: meta.name, llmId: meta.llmId },
    llm,
  };

  await fs.mkdir(SNAPSHOTS_DIR, { recursive: true });
  const filename = `${meta.id}_${Date.now()}.json`;
  const filepath = path.join(SNAPSHOTS_DIR, filename);
  await fs.writeFile(filepath, JSON.stringify(snapshot, null, 2), 'utf8');

  emit('success', `Snapshot saved: data/snapshots/${filename}`);
  return filepath;
}

/**
 * List all snapshots for a given agent ID, newest first.
 *
 * @param {string} agentId
 * @returns {Promise<Array>}
 */
export async function listSnapshots(agentId) {
  await fs.mkdir(SNAPSHOTS_DIR, { recursive: true });
  const files = await fs.readdir(SNAPSHOTS_DIR);
  const matching = files
    .filter((f) => f.startsWith(agentId) && f.endsWith('.json'))
    .sort()
    .reverse();

  const snapshots = await Promise.all(
    matching.map(async (f) => {
      const raw = await fs.readFile(path.join(SNAPSHOTS_DIR, f), 'utf8');
      const s = JSON.parse(raw);
      return { filename: f, createdAt: s.createdAt, label: s.label, agentName: s.agent?.name };
    })
  );
  return snapshots;
}

/**
 * Restore an agent's LLM tools from a snapshot file.
 *
 * @param {{ agentId: string, filename: string, dryRun?: boolean }} opts
 * @param {Function} emit
 */
export async function restoreSnapshot({ agentId, filename, dryRun = false }, emit) {
  const filepath = path.join(SNAPSHOTS_DIR, filename);
  emit('info', `Loading snapshot: ${filename}`);

  let snapshot;
  try {
    const raw = await fs.readFile(filepath, 'utf8');
    snapshot = JSON.parse(raw);
  } catch {
    throw new Error(`Snapshot file not found: ${filename}`);
  }

  emit('info', `Snapshot from: ${snapshot.createdAt} — "${snapshot.label}"`);

  const tgtMeta = await getAgentMeta(agentId);
  assertRetellLlm(tgtMeta, 'target', emit);

  const restoredTools = snapshot.llm?.general_tools ?? [];
  emit('info', `Will restore ${restoredTools.length} tool(s) to ${tgtMeta.name}`);

  if (!dryRun) {
    await setLlmTools(tgtMeta.llmId, restoredTools);
    emit('success', `✔ Restored ${restoredTools.length} tool(s) to ${tgtMeta.name}`);
  } else {
    emit('info', `(dry-run) Would restore ${restoredTools.length} tool(s)`);
  }
}

// ─── 4. AGENT LIST ───────────────────────────────────────────────────────────

/**
 * List all agents accessible with the current API key.
 * @returns {Promise<Array>}
 */
export async function listAgents() {
  const agents = await getClient().agent.list();
  return (agents ?? []).map((a) => ({
    id: a.agent_id,
    name: a.agent_name ?? a.agent_id,
    engineType: a.response_engine?.type ?? 'unknown',
    llmId: a.response_engine?.llm_id ?? null,
  }));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function assertRetellLlm(meta, label, emit) {
  if (meta.engineType !== 'retell-llm') {
    const msg = `${label} agent "${meta.name}" uses engine "${meta.engineType}" — only retell-llm is supported`;
    emit('error', msg);
    throw new Error(msg);
  }
}
