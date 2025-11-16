import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const N8N_BASE_URL = process.env.N8N_BASE_URL || 'https://n8n.hmd.services';
const N8N_API_KEY = process.env.N8N_API_KEY || '';

const server = new Server(
  { name: 'jarvis-system', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// Tool: Save Context
server.setRequestHandler('tools/call', async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'save_context') {
      const { conversation_id, user_message, assistant_response } = args;
      const res = await fetch(`${N8N_BASE_URL}/webhook/jarvis/context/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id,
          user_message,
          assistant_response,
          metadata: { timestamp: new Date().toISOString(), source: 'claude-mcp' }
        })
      });
      if (!res.ok) throw new Error(`n8n: ${res.status}`);
      return { content: [{ type: 'text', text: 'Context saved to Jarvis memory' }] };
    }

    if (name === 'query_knowledge') {
      const { query, limit = 5 } = args;
      const res = await fetch(`${N8N_BASE_URL}/webhook/jarvis/knowledge/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit })
      });
      if (!res.ok) throw new Error(`n8n: ${res.status}`);
      const data = await res.json();
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }

    if (name === 'create_task') {
      const { title, description, priority, assignee, platform = 'all' } = args;
      const res = await fetch(`${N8N_BASE_URL}/webhook/jarvis/task/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, priority, assignee, platform })
      });
      if (!res.ok) throw new Error(`n8n: ${res.status}`);
      return { content: [{ type: 'text', text: 'Task created in all platforms' }] };
    }

    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `Error: ${error.message}` }] };
  }
});

// List tools
server.setRequestHandler('tools/list', async () => {
  return {
    tools: [
      {
        name: 'save_context',
        description: 'Save conversation to Jarvis memory',
        inputSchema: {
          type: 'object',
          properties: {
            conversation_id: { type: 'string' },
            user_message: { type: 'string' },
            assistant_response: { type: 'string' }
          },
          required: ['conversation_id', 'user_message', 'assistant_response']
        }
      },
      {
        name: 'query_knowledge',
        description: 'Search Jarvis knowledge base',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            limit: { type: 'number', default: 5 }
          },
          required: ['query']
        }
      },
      {
        name: 'create_task',
        description: 'Create task in Monday/Slack/GitHub',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            assignee: { type: 'string' },
            platform: { type: 'string', enum: ['all', 'monday', 'slack', 'github'], default: 'all' }
          },
          required: ['title', 'priority', 'assignee']
        }
      }
    ]
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.log('[Jarvis MCP] Ready');
