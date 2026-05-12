/**
 * src/api/retell-client.js
 *
 * Thin wrapper around the official Retell SDK.
 *
 * ── Architecture note ────────────────────────────────────────────────────────
 * In Retell, custom functions (tools) are NOT stored on the agent directly.
 * The chain is:
 *
 *   agent.response_engine
 *     └─ { type: 'retell-llm', llm_id }  →  client.llm.retrieve(llm_id)
 *          └─ llm.general_tools            →  CustomTool[]  (type === 'custom')
 *
 * Reading / writing tools therefore goes through the LLM object, not the agent.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Retell from 'retell-sdk';

let _client = null;

/** Singleton Retell client, keyed from RETELL_API_KEY env var. */
export function getClient() {
  if (!_client) {
    const apiKey = process.env.RETELL_API_KEY;
    if (!apiKey) {
      throw new Error(
        'RETELL_API_KEY is not set. Add it to your .env file or export it before running.'
      );
    }
    _client = new Retell({ apiKey });
  }
  return _client;
}

// ─── Agent helpers ───────────────────────────────────────────────────────────

/**
 * Fetch a full agent object by ID.
 * @param {string} agentId
 * @returns {Promise<object>}
 */
export async function getAgent(agentId) {
  try {
    return await getClient().agent.retrieve(agentId);
  } catch (err) {
    throw wrapError(`Failed to retrieve agent "${agentId}"`, err);
  }
}

/**
 * Fetch minimal agent metadata for display/logging.
 * Also resolves the associated llm_id (only for retell-llm agents).
 *
 * @param {string} agentId
 * @returns {Promise<{ id: string, name: string, llmId: string|null, engineType: string }>}
 */
export async function getAgentMeta(agentId) {
  const agent = await getAgent(agentId);
  const engine = agent.response_engine ?? {};
  return {
    id: agent.agent_id ?? agentId,
    name: agent.agent_name ?? agentId,
    engineType: engine.type ?? 'unknown',
    llmId: engine.llm_id ?? null,
  };
}

// ─── LLM / tool helpers ──────────────────────────────────────────────────────

/**
 * Fetch the Retell LLM object associated with an agent.
 * Throws if the agent uses a custom-llm (no llm_id to look up).
 *
 * @param {string} agentId
 * @returns {Promise<{ llm: object, llmId: string }>}
 */
export async function getLlmForAgent(agentId) {
  const meta = await getAgentMeta(agentId);

  if (meta.engineType !== 'retell-llm') {
    throw new Error(
      `Agent "${meta.name}" (${agentId}) uses engine type "${meta.engineType}". ` +
      `Only "retell-llm" agents have a managed LLM with general_tools.`
    );
  }
  if (!meta.llmId) {
    throw new Error(`Agent "${meta.name}" has no llm_id in its response_engine.`);
  }

  try {
    const llm = await getClient().llm.retrieve(meta.llmId);
    return { llm, llmId: meta.llmId };
  } catch (err) {
    throw wrapError(`Failed to retrieve LLM "${meta.llmId}" for agent "${agentId}"`, err);
  }
}

/**
 * Get all general_tools from an agent's LLM.
 * Returns the full array (all tool types), not just custom ones.
 *
 * @param {string} agentId
 * @returns {Promise<{ tools: Array, llmId: string }>}
 */
export async function getAgentTools(agentId) {
  const { llm, llmId } = await getLlmForAgent(agentId);
  return {
    tools: llm.general_tools ?? [],
    llmId,
  };
}

/**
 * Get only the CustomTool entries (type === 'custom') from an agent's LLM.
 *
 * @param {string} agentId
 * @returns {Promise<{ customTools: Array, allTools: Array, llmId: string }>}
 */
export async function getAgentCustomTools(agentId) {
  const { tools, llmId } = await getAgentTools(agentId);
  return {
    customTools: tools.filter((t) => t.type === 'custom'),
    allTools: tools,
    llmId,
  };
}

/**
 * Replace the general_tools on a target agent's LLM.
 * Accepts the full general_tools array (all tool types).
 *
 * @param {string} llmId
 * @param {Array}  tools  — full general_tools array to write
 * @returns {Promise<object>} updated LLM
 */
export async function setLlmTools(llmId, tools) {
  try {
    return await getClient().llm.update(llmId, { general_tools: tools });
  } catch (err) {
    throw wrapError(`Failed to update LLM "${llmId}"`, err);
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function wrapError(msg, cause) {
  const err = new Error(msg);
  err.cause = cause;
  if (cause?.status)  err.status  = cause.status;
  if (cause?.message) err.message += `: ${cause.message}`;
  return err;
}
