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

// ─── Post Call Analysis helpers ──────────────────────────────────────────────

/**
 * Read the Post Call Data Retrieval configuration from an agent.
 *
 * post_call_analysis_data is stored directly on the agent object (not the LLM
 * or conversation flow), so this works for ANY engine type.
 *
 * @param {string} agentId
 * @returns {Promise<{ fields: Array, model: string|null, agentName: string }>}
 */
export async function getAgentPostCallData(agentId) {
  const agent = await getAgent(agentId);
  return {
    fields:    agent.post_call_analysis_data  ?? [],
    model:     agent.post_call_analysis_model ?? null,
    agentName: agent.agent_name ?? agentId,
  };
}

/**
 * Write Post Call Data Retrieval configuration to an agent.
 *
 * @param {string} agentId
 * @param {object} params  — { post_call_analysis_data?, post_call_analysis_model? }
 * @returns {Promise<object>} updated agent
 */
export async function updateAgentPostCallData(agentId, params) {
  try {
    return await getClient().agent.update(agentId, params);
  } catch (err) {
    throw wrapError(`Failed to update post call data for agent "${agentId}"`, err);
  }
}

// ─── Conversation-Flow helpers ───────────────────────────────────────────────

/**
 * Fetch the conversation flow object associated with a conversation-flow agent.
 *
 * @param {string} agentId
 * @returns {Promise<{ flow: object, flowId: string }>}
 */
export async function getConvFlowForAgent(agentId) {
  const agent = await getAgent(agentId);
  const engine = agent.response_engine ?? {};
  if (engine.type !== 'conversation-flow') {
    throw new Error(
      `Agent "${agent.agent_name ?? agentId}" uses engine "${engine.type}" — expected "conversation-flow"`
    );
  }
  const flowId = engine.conversation_flow_id;
  if (!flowId) throw new Error(`Agent "${agentId}" has no conversation_flow_id`);
  try {
    const flow = await getClient().conversationFlow.retrieve(flowId);
    return { flow, flowId };
  } catch (err) {
    throw wrapError(`Failed to retrieve conversation flow "${flowId}"`, err);
  }
}

/**
 * Get tools and dynamic variables from a conversation-flow agent.
 *
 * NOTE: conversation-flow uses the field name `tools` (not `general_tools`).
 * The `tools` array contains only custom tools — end_call / transfer_call are
 * separate node types in conversation-flow and are NOT stored here.
 *
 * @param {string} agentId
 * @returns {Promise<{ customTools: Array, dynamicVars: object, flowId: string }>}
 */
export async function getConvFlowData(agentId) {
  const { flow, flowId } = await getConvFlowForAgent(agentId);
  return {
    customTools: (flow.tools ?? []).filter((t) => t.type === 'custom'),
    dynamicVars: flow.default_dynamic_variables ?? {},
    flowId,
  };
}

/**
 * Patch a conversation flow with the given fields.
 *
 * @param {string} flowId
 * @param {object} params  — e.g. { general_tools, default_dynamic_variables }
 * @returns {Promise<object>} updated flow
 */
export async function updateConvFlow(flowId, params) {
  try {
    return await getClient().conversationFlow.update(flowId, params);
  } catch (err) {
    throw wrapError(`Failed to update conversation flow "${flowId}"`, err);
  }
}

/**
 * Resolve agent metadata for ANY engine type (retell-llm or conversation-flow).
 * Returns a unified meta object so sync logic can branch on engineType.
 *
 * @param {string} agentId
 * @returns {Promise<{ id, name, engineType, llmId, flowId }>}
 */
export async function getAgentMetaAny(agentId) {
  const agent = await getAgent(agentId);
  const engine = agent.response_engine ?? {};
  return {
    id:         agent.agent_id ?? agentId,
    name:       agent.agent_name ?? agentId,
    engineType: engine.type ?? 'unknown',
    llmId:      engine.llm_id ?? null,
    flowId:     engine.conversation_flow_id ?? null,
  };
}

// ─── Conversation-Flow node helpers ─────────────────────────────────────────

/** Node types that carry a user-editable instruction text. */
const INSTRUCTION_NODE_TYPES = new Set([
  'conversation', 'subagent', 'end', 'function', 'transfer_call',
  'agent_swap', 'bridge_transfer', 'cancel_transfer', 'mcp', 'code',
]);

/**
 * Fetch all nodes from a conversation-flow agent.
 *
 * @param {string} agentId
 * @returns {Promise<{ nodes: Array, flowId: string, agentName: string }>}
 */
export async function getFlowNodes(agentId) {
  const { flow, flowId } = await getConvFlowForAgent(agentId);
  const agent = await getAgent(agentId);
  return {
    nodes:     flow.nodes ?? [],
    flowId,
    agentName: agent.agent_name ?? agentId,
  };
}

/**
 * Update a single node's instruction inside a conversation flow.
 * Fetches the current full nodes array, patches the target node, then writes
 * the whole array back (the API has no single-node patch endpoint).
 *
 * @param {string} agentId
 * @param {string} nodeId
 * @param {string} text          New instruction text
 * @param {'prompt'|'static_text'} instructionType
 * @returns {Promise<{ flowId: string, nodeName: string }>}
 */
export async function updateFlowNodeInstruction(agentId, nodeId, text, instructionType = 'prompt') {
  const { nodes, flowId } = await getFlowNodes(agentId);

  const idx = nodes.findIndex((n) => n.id === nodeId);
  if (idx === -1) throw new Error(`Node "${nodeId}" not found in flow`);

  const node = nodes[idx];
  if (!INSTRUCTION_NODE_TYPES.has(node.type)) {
    throw new Error(`Node type "${node.type}" does not support instruction editing`);
  }

  // Deep-clone to avoid mutating the fetched object
  const updatedNodes = nodes.map((n, i) =>
    i === idx ? { ...n, instruction: { type: instructionType, text } } : n
  );

  try {
    await getClient().conversationFlow.update(flowId, { nodes: updatedNodes });
  } catch (err) {
    throw wrapError(`Failed to update node "${nodeId}" in flow "${flowId}"`, err);
  }

  return { flowId, nodeName: node.name ?? nodeId };
}

export { INSTRUCTION_NODE_TYPES };

// ─── Internal helpers ────────────────────────────────────────────────────────

function wrapError(msg, cause) {
  const err = new Error(msg);
  err.cause = cause;
  if (cause?.status)  err.status  = cause.status;
  if (cause?.message) err.message += `: ${cause.message}`;
  return err;
}
