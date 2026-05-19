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
  getAgentMetaAny,
  getAgentCustomTools,
  setLlmTools,
  getAgent,
  getLlmForAgent,
  getConvFlowData,
  updateConvFlow,
  getClient,
  getAgentPostCallData,
  updateAgentPostCallData,
  getFlowNodes,
  updateFlowNodeInstruction,
  INSTRUCTION_NODE_TYPES,
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

// ─── 1b. SYNC VARS + TOOLS (cross-engine: retell-llm → any) ─────────────────

/**
 * Sync default_dynamic_variables and/or custom tools from a retell-llm source
 * agent to one or more target agents (retell-llm OR conversation-flow).
 *
 * @param {object} opts
 * @param {string}          opts.from          Source agent ID (must be retell-llm)
 * @param {string[]}        opts.to            Target agent ID(s)
 * @param {'merge'|'replace'} opts.mode        merge = upsert, replace = overwrite
 * @param {boolean}         opts.syncTools     Include custom tools
 * @param {boolean}         opts.syncVars      Include dynamic variables
 * @param {Set<string>|null} opts.toolFilter   Tool names to sync (null = all)
 * @param {Set<string>|null} opts.varFilter    Var keys to sync (null = all)
 * @param {boolean}         opts.dryRun
 * @param {Function}        emit
 */
export async function syncVarsAndTools(
  { from, to, mode = 'merge', syncTools = true, syncVars = true, toolFilter = null, varFilter = null, dryRun = false },
  emit
) {
  if (!syncTools && !syncVars) {
    emit('warn', 'Nothing to sync — both syncTools and syncVars are false');
    return [];
  }

  // ── Read source (must be retell-llm) ────────────────────────────────────────
  emit('info', `Fetching source agent…`);
  const srcMeta = await getAgentMeta(from);
  assertRetellLlm(srcMeta, 'source', emit);
  emit('info', `Source: ${srcMeta.name}  (LLM: ${srcMeta.llmId})`);

  const srcData = await getAgentCustomTools(from);
  const { llm: srcLlm } = await getLlmForAgent(from);
  const srcVars = srcLlm.default_dynamic_variables ?? {};

  // Apply filters to source
  let toolsToSync = srcData.customTools;
  if (syncTools && toolFilter?.size > 0) {
    toolsToSync = toolsToSync.filter((t) => toolFilter.has(t.name));
    if (toolsToSync.length === 0) {
      emit('warn', `No tools matched filter [${[...toolFilter].join(', ')}]. Available: ${srcData.customTools.map(t => t.name).join(', ') || '(none)'}`);
    }
  }

  let varsToSync = { ...srcVars };
  if (syncVars && varFilter?.size > 0) {
    varsToSync = Object.fromEntries(
      Object.entries(srcVars).filter(([k]) => varFilter.has(k))
    );
    if (Object.keys(varsToSync).length === 0) {
      emit('warn', `No vars matched filter [${[...varFilter].join(', ')}]. Available: ${Object.keys(srcVars).join(', ') || '(none)'}`);
    }
  }

  emit('info', `Source has ${srcData.customTools.length} custom tool(s), ${Object.keys(srcVars).length} dynamic variable(s)`);
  if (syncTools) emit('info', `  → syncing ${toolsToSync.length} tool(s)${toolFilter ? ' (filtered)' : ''}`);
  if (syncVars)  emit('info', `  → syncing ${Object.keys(varsToSync).length} variable(s)${varFilter ? ' (filtered)' : ''}`);

  const results = [];

  for (const targetId of to) {
    emit('info', `\n── Target: ${targetId}`);
    try {
      const result = await _syncVarsAndToolsToTarget(
        { targetId, toolsToSync, varsToSync, mode, syncTools, syncVars, dryRun },
        emit
      );
      results.push({ targetId, ...result });
    } catch (err) {
      emit('error', `Failed for ${targetId}: ${err.message}`);
      results.push({ targetId, success: false, error: err.message });
    }
  }

  return results;
}

/**
 * Convert an LLM custom tool object to the ConversationFlow custom tool format.
 *
 * Key differences:
 * - CF uses field name `tools` (not `general_tools`)
 * - CF requires `tool_id` — a stable unique identifier per tool
 * - CF does not accept LLM-specific fields (speak_after_execution, etc.)
 *
 * tool_id is derived deterministically from the tool name so repeated syncs
 * produce the same id and don't create duplicates.
 */
function _toLlmToCfTool(t) {
  // Prefer existing tool_id (if source already has one), otherwise derive from name.
  // Format: lowercase alphanumeric + underscores, prefixed with "tool_".
  const toolId = t.tool_id ?? ('tool_' + t.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'));
  const out = { tool_id: toolId, name: t.name, type: 'custom', url: t.url };
  if (t.args_at_root       != null) out.args_at_root       = t.args_at_root;
  if (t.description        != null) out.description        = t.description;
  if (t.headers            != null) out.headers            = t.headers;
  if (t.method             != null) out.method             = t.method;
  if (t.parameters         != null) out.parameters         = t.parameters;
  if (t.query_params       != null) out.query_params       = t.query_params;
  if (t.response_variables != null) out.response_variables = t.response_variables;
  if (t.timeout_ms         != null) out.timeout_ms         = t.timeout_ms;
  return out;
}

/** Stable signature for diff comparison — strips fields that vary per-engine. */
function _toolSig(t) {
  return JSON.stringify({ url: t.url, parameters: t.parameters, description: t.description, args_at_root: t.args_at_root });
}

async function _syncVarsAndToolsToTarget(
  { targetId, toolsToSync, varsToSync, mode, syncTools, syncVars, dryRun },
  emit
) {
  const tgtMeta = await getAgentMetaAny(targetId);
  emit('info', `  Name: ${tgtMeta.name}  (engine: ${tgtMeta.engineType})`);

  const isConvFlow = tgtMeta.engineType === 'conversation-flow';
  const isLlm      = tgtMeta.engineType === 'retell-llm';

  if (!isConvFlow && !isLlm) {
    throw new Error(`Unsupported engine type "${tgtMeta.engineType}" for target "${tgtMeta.name}"`);
  }

  // ── Read current target state ────────────────────────────────────────────────
  let tgtCustomTools = [], tgtAllTools = [], tgtVars = {}, tgtLlmId, tgtFlowId;

  if (isLlm) {
    const d = await getAgentCustomTools(targetId);
    tgtCustomTools = d.customTools;
    tgtAllTools    = d.allTools;
    tgtVars        = (await getLlmForAgent(targetId)).llm.default_dynamic_variables ?? {};
    tgtLlmId       = tgtMeta.llmId;
  } else {
    const d = await getConvFlowData(targetId);
    tgtCustomTools = d.customTools;   // already CF-format, custom-only
    tgtVars        = d.dynamicVars;
    tgtFlowId      = d.flowId;
  }

  const patch = {};

  // ── Tools diff ───────────────────────────────────────────────────────────────
  if (syncTools) {
    // Normalise source tools to the target's format before comparing/writing
    const normalisedToSync = isConvFlow
      ? toolsToSync.map(_toLlmToCfTool)
      : toolsToSync;   // LLM → LLM: keep as-is

    const tgtNames  = new Set(tgtCustomTools.map((t) => t.name));
    const syncNames = new Set(normalisedToSync.map((t) => t.name));

    const added   = normalisedToSync.filter((t) => !tgtNames.has(t.name));
    const updated = normalisedToSync.filter((t) => {
      if (!tgtNames.has(t.name)) return false;
      const existing = tgtCustomTools.find((e) => e.name === t.name);
      return _toolSig(existing) !== _toolSig(t);
    });
    const removed = mode === 'replace'
      ? tgtCustomTools.filter((t) => !syncNames.has(t.name))
      : [];

    if (added.length || updated.length || removed.length) {
      for (const t of added)   emit('diff', { op: 'add',    name: t.name, description: t.description });
      for (const t of updated) emit('diff', { op: 'update', name: t.name, description: t.description });
      for (const t of removed) emit('diff', { op: 'remove', name: t.name });

      let newCustomTools;
      if (mode === 'replace') {
        newCustomTools = normalisedToSync;
      } else {
        const tgtMap = new Map(tgtCustomTools.map((t) => [t.name, t]));
        for (const t of normalisedToSync) tgtMap.set(t.name, t);
        newCustomTools = [...tgtMap.values()];
      }

      if (isLlm) {
        // LLM: general_tools = non-custom tools + updated custom tools
        const nonCustomTools = tgtAllTools.filter((t) => t.type !== 'custom');
        patch.general_tools = [...nonCustomTools, ...newCustomTools];
      } else {
        // Conversation-flow: `tools` field is custom-only
        patch.tools = newCustomTools;
      }
    } else {
      emit('info', '  Tools: no changes needed');
    }
  }

  // ── Variables diff ───────────────────────────────────────────────────────────
  if (syncVars) {
    const newVars = mode === 'replace'
      ? { ...varsToSync }
      : { ...tgtVars, ...varsToSync };

    const addedKeys   = Object.keys(varsToSync).filter((k) => !(k in tgtVars));
    const updatedKeys = Object.keys(varsToSync).filter((k) => (k in tgtVars) && tgtVars[k] !== varsToSync[k]);
    const removedKeys = mode === 'replace'
      ? Object.keys(tgtVars).filter((k) => !(k in varsToSync))
      : [];

    if (addedKeys.length || updatedKeys.length || removedKeys.length) {
      for (const k of addedKeys)   emit('diff', { op: 'add',    name: `[var] ${k}`, description: String(varsToSync[k]).slice(0, 60) });
      for (const k of updatedKeys) emit('diff', { op: 'update', name: `[var] ${k}`, description: `${String(tgtVars[k]).slice(0,30)} → ${String(varsToSync[k]).slice(0,30)}` });
      for (const k of removedKeys) emit('diff', { op: 'remove', name: `[var] ${k}` });
      patch.default_dynamic_variables = newVars;
    } else {
      emit('info', '  Variables: no changes needed');
    }
  }

  if (Object.keys(patch).length === 0) {
    emit('info', '  No changes needed');
    return { success: true, noChange: true };
  }

  if (!dryRun) {
    if (isLlm) {
      await getClient().llm.update(tgtLlmId, patch);
    } else {
      await updateConvFlow(tgtFlowId, patch);
    }
    const parts = [patch.general_tools || patch.tools ? 'tools' : null, patch.default_dynamic_variables ? 'vars' : null].filter(Boolean);
    emit('success', `  ✔ Applied: ${parts.join(' + ')}`);
  } else {
    emit('info', `  (dry-run) Would patch: ${Object.keys(patch).join(', ')}`);
  }

  return { success: true };
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

// ─── 3b. SYNC POST CALL DATA ──────────────────────────────────────────────────

/**
 * Sync Post Call Data Retrieval configuration from one agent to one or more targets.
 *
 * post_call_analysis_data lives on the agent object itself (not on the LLM or
 * conversation flow), so this works for ANY engine type on both ends.
 *
 * @param {object} opts
 * @param {string}          opts.from         Source agent ID (any engine type)
 * @param {string[]}        opts.to           Target agent ID(s)
 * @param {'merge'|'replace'} opts.mode       merge = upsert by field name; replace = overwrite all
 * @param {Set<string>|null} opts.filter      Field names to sync (null = all)
 * @param {boolean}         opts.syncModel    Also sync post_call_analysis_model (default false)
 * @param {boolean}         opts.dryRun
 * @param {Function}        emit
 * @returns {Promise<object[]>}  Per-target results
 */
export async function syncPostCallData(
  { from, to, mode = 'merge', filter = null, syncModel = false, dryRun = false },
  emit
) {
  // ── Read source ──────────────────────────────────────────────────────────────
  emit('info', 'Fetching source agent…');
  const src = await getAgentPostCallData(from);
  emit('info', `Source: ${src.agentName}  (${src.fields.length} field(s), model: ${src.model ?? 'default'})`);

  // Apply filter
  let fieldsToSync = src.fields;
  if (filter && filter.size > 0) {
    fieldsToSync = src.fields.filter((f) => filter.has(f.name));
    if (fieldsToSync.length === 0) {
      emit('warn', `No fields matched filter [${[...filter].join(', ')}]. Available: ${src.fields.map(f => f.name).join(', ') || '(none)'}`);
      return [];
    }
    emit('info', `Filter applied → ${fieldsToSync.length} field(s)`);
  }

  const results = [];

  for (const targetId of to) {
    emit('info', `\n── Target: ${targetId}`);
    try {
      const result = await _syncPostCallDataToTarget(
        { targetId, fieldsToSync, srcModel: src.model, mode, filter, syncModel, dryRun },
        emit
      );
      results.push({ targetId, ...result });
    } catch (err) {
      emit('error', `Failed for target ${targetId}: ${err.message}`);
      results.push({ targetId, success: false, error: err.message });
    }
  }

  return results;
}

async function _syncPostCallDataToTarget(
  { targetId, fieldsToSync, srcModel, mode, filter, syncModel, dryRun },
  emit
) {
  const tgt = await getAgentPostCallData(targetId);
  emit('info', `  Name: ${tgt.agentName}  (${tgt.fields.length} existing field(s))`);

  const tgtMap    = new Map(tgt.fields.map((f) => [f.name, f]));
  const syncNames = new Set(fieldsToSync.map((f) => f.name));

  // Compute diff
  const added   = fieldsToSync.filter((f) => !tgtMap.has(f.name));
  const updated = fieldsToSync.filter((f) => {
    if (!tgtMap.has(f.name)) return false;
    return JSON.stringify(tgtMap.get(f.name)) !== JSON.stringify(f);
  });
  const removed = mode === 'replace'
    ? tgt.fields.filter((f) => {
        if (filter && filter.size > 0) return filter.has(f.name) && !syncNames.has(f.name);
        return !syncNames.has(f.name);
      })
    : [];

  for (const f of added)   emit('diff', { op: 'add',    name: f.name, description: `[${f.type}] ${f.description?.slice(0, 60) ?? ''}` });
  for (const f of updated) emit('diff', { op: 'update', name: f.name, description: `[${f.type}] ${f.description?.slice(0, 60) ?? ''}` });
  for (const f of removed) emit('diff', { op: 'remove', name: f.name });

  // Build new fields list
  let newFields;
  if (mode === 'replace') {
    if (filter && filter.size > 0) {
      // Keep fields outside the filter, replace those inside it with the source's
      const kept = tgt.fields.filter((f) => !filter.has(f.name));
      newFields  = [...kept, ...fieldsToSync];
    } else {
      newFields = fieldsToSync;
    }
  } else {
    // merge: upsert by name
    for (const f of fieldsToSync) tgtMap.set(f.name, f);
    newFields = [...tgtMap.values()];
  }

  // Model change
  let modelChanged = false;
  if (syncModel && srcModel && srcModel !== tgt.model) {
    emit('diff', { op: tgt.model ? 'update' : 'add', name: '[model]', description: `${tgt.model ?? 'default'} → ${srcModel}` });
    modelChanged = true;
  }

  if (added.length === 0 && updated.length === 0 && removed.length === 0 && !modelChanged) {
    emit('info', '  No changes needed');
    return { success: true, noChange: true };
  }

  const patch = { post_call_analysis_data: newFields };
  if (modelChanged) patch.post_call_analysis_model = srcModel;

  if (!dryRun) {
    await updateAgentPostCallData(targetId, patch);
    emit('success', `  ✔ Applied: +${added.length} ~${updated.length} -${removed.length}${modelChanged ? ' + model' : ''}`);
  } else {
    emit('info', `  (dry-run) Would apply: +${added.length} ~${updated.length} -${removed.length}${modelChanged ? ' + model' : ''}`);
  }

  return { success: true, added: added.length, updated: updated.length, removed: removed.length };
}

// ─── 4. FLOW NODE EDITOR ─────────────────────────────────────────────────────

/**
 * Return all editable nodes (nodes that have an instruction field) from a
 * conversation-flow agent, in a UI-friendly shape.
 *
 * @param {string} agentId
 * @returns {Promise<{ agentName: string, flowId: string, nodes: Array }>}
 */
export async function listFlowNodes(agentId) {
  const { nodes, flowId, agentName } = await getFlowNodes(agentId);

  // Include all nodes of editable types, even those without an instruction yet
  // (conversation nodes always have instruction; end/function/transfer_call etc. make it optional)
  const editable = nodes
    .filter((n) => INSTRUCTION_NODE_TYPES.has(n.type))
    .map((n) => ({
      id:              n.id,
      name:            n.name ?? n.id,
      type:            n.type,
      instructionType: n.instruction?.type ?? 'prompt',
      text:            n.instruction?.text ?? '',
    }));

  return { agentName, flowId, nodes: editable };
}

/**
 * Update the instruction of a single node in a conversation-flow agent.
 *
 * @param {object} opts
 * @param {string}  opts.agentId
 * @param {string}  opts.nodeId
 * @param {string}  opts.text           New instruction text
 * @param {'prompt'|'static_text'} [opts.instructionType]
 * @param {boolean} [opts.dryRun]
 * @param {Function} emit
 */
export async function updateFlowNode({ agentId, nodeId, text, instructionType = 'prompt', dryRun = false }, emit) {
  emit('info', `Fetching flow for agent ${agentId}…`);
  const { nodes, agentName } = await listFlowNodes(agentId);

  const node = nodes.find((n) => n.id === nodeId);
  if (!node) {
    const msg = `Node "${nodeId}" not found (or not editable)`;
    emit('error', msg);
    throw new Error(msg);
  }

  emit('info', `Agent: ${agentName}`);
  emit('info', `Node:  ${node.name}  (${node.type})`);

  if (node.text === text && node.instructionType === instructionType) {
    emit('info', 'No changes needed — instruction is identical');
    return { success: true, noChange: true };
  }

  emit('diff', { op: 'update', name: node.name, description: `[${instructionType}] instruction updated` });

  if (!dryRun) {
    await updateFlowNodeInstruction(agentId, nodeId, text, instructionType);
    emit('success', `✔ Node "${node.name}" updated`);
  } else {
    emit('info', '(dry-run) Would update instruction');
  }

  return { success: true };
}

// ─── 5. AGENT LIST ───────────────────────────────────────────────────────────

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
