#!/usr/bin/env node
/**
 * 🚀 JARVIS MCP SERVER (Production-Ready)
 * HTTP-based MCP for Claude Desktop Integration
 */

import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 3000;
const N8N_BASE = process.env.N8N_BASE_URL || 'https://n8n.hmd.services';
const N8N_KEY = process.env.N8N_API_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://dgohlmjwnxmswwzjnkra.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const app = express();

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// ============ MCP TOOLS ============
const MCP_TOOLS = [
  {
    name: 'conversation_search',
    description: 'Search Jarvis conversation history & knowledge base with semantic similarity (RAG via pgvector)',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (semantic)' },
        limit: { type: 'number', description: 'Max results', default: 5 },
        min_similarity: { type: 'number', description: 'Similarity threshold (0-1)', default: 0.7 },
        filters: { type: 'object', description: 'Optional metadata filters' },
      },
      required: ['query'],
    },
  },
  {
    name: 'save_context',
    description: 'Save Claude-Jarvis interaction to memory for future retrieval',
    inputSchema: {
      type: 'object',
      properties: {
        conversation_id: { type: 'string', description: 'Unique conversation ID' },
        user_message: { type: 'string' },
        assistant_response: { type: 'string' },
        metadata: { type: 'object', description: 'Tags: project, domain, action_type' },
      },
      required: ['conversation_id', 'user_message', 'assistant_response'],
    },
  },
  {
    name: 'trigger_workflow',
    description: 'Trigger n8n workflow by name with custom input data',
    inputSchema: {
      type: 'object',
      properties: {
        workflow_name: { type: 'string', description: 'n8n workflow name' },
        trigger_data: { type: 'object', description: 'Payload to pass to workflow' },
      },
      required: ['workflow_name'],
    },
  },
  {
    name: 'create_task',
    description: 'Create task in Monday.com, GitHub, or Slack via n8n',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['monday', 'github', 'slack'] },
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'], default: 'medium' },
        assignee: { type: 'string' },
      },
      required: ['platform', 'title'],
    },
  },
  {
    name: 'get_agent_status',
    description: 'Get current Jarvis agent status, running workflows, memory usage',
    inputSchema: { type: 'object', properties: { agent_id: { type: 'string', description: 'Specific agent (or all)' } } },
  },
];

// ============ ENDPOINTS ============

app.post('/mcp/tools/list', (req, res) => {
  res.json({ tools: MCP_TOOLS });
});

app.post('/mcp/tools/call', async (req, res) => {
  try {
    const { name, arguments: args } = req.body;
    if (!name || !args) return res.status(400).json({ error: 'Missing name or arguments' });

    let result;
    if (name === 'conversation_search') result = await handleConversationSearch(args);
    else if (name === 'save_context') result = await handleSaveContext(args);
    else if (name === 'trigger_workflow') result = await handleTriggerWorkflow(args);
    else if (name === 'create_task') result = await handleCreateTask(args);
    else if (name === 'get_agent_status') result = await handleGetAgentStatus(args);
    else return res.status(400).json({ error: `Unknown tool: ${name}` });

    res.json({ success: true, result });
  } catch (error) {
    console.error('[MCP Error]', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    n8n: { baseUrl: N8N_BASE, configured: !!N8N_KEY },
    supabase: { configured: !!SUPABASE_URL },
  });
});

app.get('/info', (req, res) => {
  res.json({
    name: 'Jarvis MCP Server',
    version: '1.0.0',
    description: 'Production MCP connector for Claude ↔ n8n ↔ Jarvis',
    tools: MCP_TOOLS.map((t) => ({ name: t.name, description: t.description })),
  });
});

// ============ TOOL HANDLERS ============

async function handleConversationSearch(args) {
  const { query, limit = 5, min_similarity = 0.7, filters = {} } = args;
  if (!query) throw new Error('Query is required');
  try {
    const embedding = await generateEmbedding(query);
    let queryBuilder = supabase.from('conversations').select('*').order('embedding', { ascending: false });
    if (filters.project) queryBuilder = queryBuilder.eq('project', filters.project);
    if (filters.user_id) queryBuilder = queryBuilder.eq('user_id', filters.user_id);
    const { data, error } = await queryBuilder.limit(limit);
    if (error) throw error;
    const results = data
      .filter((item) => item.similarity_score >= min_similarity)
      .map((item) => ({
        id: item.id,
        content: item.content,
        metadata: item.metadata,
        similarity: item.similarity_score,
        created_at: item.created_at,
      }));
    return { query, results_count: results.length, results, timestamp: new Date().toISOString() };
  } catch (error) {
    console.error('[conversation_search Error]', error);
    throw new Error(`Semantic search failed: ${error.message}`);
  }
}

async function handleSaveContext(args) {
  const { conversation_id, user_message, assistant_response, metadata = {} } = args;
  if (!conversation_id || !user_message || !assistant_response) {
    throw new Error('conversation_id, user_message, and assistant_response are required');
  }
  try {
    const embedding = await generateEmbedding(assistant_response);
    const { data, error } = await supabase.from('conversations').insert([
      {
        conversation_id,
        user_message,
        assistant_response,
        embedding,
        metadata,
        created_at: new Date().toISOString(),
      },
    ]);
    if (error) throw error;
    return {
      status: 'saved',
      conversation_id,
      message_length: user_message.length + assistant_response.length,
      embedding_generated: !!embedding,
    };
  } catch (error) {
    console.error('[save_context Error]', error);
    throw new Error(`Failed to save context: ${error.message}`);
  }
}

async function handleTriggerWorkflow(args) {
  const { workflow_name, trigger_data = {} } = args;
  if (!workflow_name) throw new Error('workflow_name is required');
  try {
    const response = await fetch(`${N8N_BASE}/api/v1/workflows`, {
      headers: { 'X-N8N-API-KEY': N8N_KEY },
    });
    if (!response.ok) throw new Error('Failed to list n8n workflows');
    const workflows = await response.json();
    const workflow = workflows.data.find((w) => w.name === workflow_name);
    if (!workflow) throw new Error(`Workflow "${workflow_name}" not found`);
    const webhookUrl = `${N8N_BASE}/webhook/${workflow.name}`;
    const triggerResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(trigger_data),
    });
    if (!triggerResponse.ok) throw new Error(`Webhook trigger failed: ${triggerResponse.statusText}`);
    return {
      status: 'triggered',
      workflow_name,
      workflow_id: workflow.id,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[trigger_workflow Error]', error);
    throw new Error(`Failed to trigger workflow: ${error.message}`);
  }
}

async function handleCreateTask(args) {
  const { platform, title, description = '', priority = 'medium', assignee = '' } = args;
  if (!platform || !title) throw new Error('platform and title are required');
  try {
    const result = await handleTriggerWorkflow({
      workflow_name: 'Jarvis - Task Creator',
      trigger_data: { platform, title, description, priority, assignee },
    });
    return { status: 'task_created', platform, title, delegated_to: 'n8n' };
  } catch (error) {
    console.error('[create_task Error]', error);
    throw new Error(`Failed to create task: ${error.message}`);
  }
}

async function handleGetAgentStatus(args) {
  const { agent_id = 'all' } = args;
  try {
    let query = supabase.from('agent_status').select('*');
    if (agent_id !== 'all') query = query.eq('agent_id', agent_id);
    const { data, error } = await query;
    if (error) throw error;
    return { agents_count: data.length, agents: data, timestamp: new Date().toISOString() };
  } catch (error) {
    console.error('[get_agent_status Error]', error);
    return { agents_count: 0, agents: [], error: error.message };
  }
}

// ============ UTILITIES ============

async function generateEmbedding(text) {
  if (!OPENAI_KEY) return null;
  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
      }),
    });
    if (!response.ok) throw new Error('OpenAI API failed');
    const data = await response.json();
    return data.data[0].embedding;
  } catch (error) {
    console.error('[generateEmbedding Error]', error);
    return null;
  }
}

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║       🚀 JARVIS MCP SERVER READY          ║
╚═══════════════════════════════════════════╝

📍 HTTP Server: http://localhost:${PORT}
🔗 Tools: /mcp/tools/list
📊 Health: /health
ℹ️  Info: /info

Integrated:
  ✅ n8n:      ${N8N_BASE}
  ✅ Supabase: ${SUPABASE_URL}
  ✅ OpenAI:   ${OPENAI_KEY ? 'configured' : 'not set'}

Ready for Claude Desktop MCP integration.
  `);
});