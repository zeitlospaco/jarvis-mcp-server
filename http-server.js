import express from 'express';
import fetch from 'node-fetch';

const app = express();
app.use(express.json());

const N8N_URL = process.env.N8N_URL || 'https://n8n.hmd.services';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://dgohlmjwnxmswwzjnkra.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const PORT = process.env.PORT || 3000;

// MCP Tools Definition
const TOOLS = [
  {
    name: 'save_context',
    description: 'Save conversation context to Jarvis memory (Supabase + embeddings)',
    inputSchema: {
      type: 'object',
      properties: {
        conversation_id: { type: 'string', description: 'Unique conversation ID' },
        user_message: { type: 'string', description: 'User message' },
        assistant_response: { type: 'string', description: 'Assistant response' }
      },
      required: ['conversation_id', 'user_message', 'assistant_response']
    }
  },
  {
    name: 'query_knowledge',
    description: 'Semantic search through Jarvis knowledge base (RAG)',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results', default: 5 },
        threshold: { type: 'number', description: 'Similarity threshold', default: 0.7 }
      },
      required: ['query']
    }
  },
  {
    name: 'create_task',
    description: 'Create task in Monday.com, Slack, GitHub (multi-platform)',
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
  },
  {
    name: 'get_memory',
    description: 'Retrieve conversation memory summary',
    inputSchema: {
      type: 'object',
      properties: {
        conversation_id: { type: 'string' }
      },
      required: ['conversation_id']
    }
  }
];

// MCP Protocol Handler
app.post('/mcp/tools/list', (req, res) => {
  res.json({ tools: TOOLS });
});

app.post('/mcp/tools/call', async (req, res) => {
  const { name, arguments: args } = req.body;

  try {
    switch (name) {
      case 'save_context': {
        const response = await fetch(`${N8N_URL}/webhook/jarvis/context/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...args,
            metadata: {
              timestamp: new Date().toISOString(),
              source: 'claude-mcp-http'
            }
          })
        });

        if (!response.ok) throw new Error(`n8n error: ${response.status}`);
        const data = await response.json();

        res.json({
          success: true,
          message: 'Context saved to memory',
          memory_id: data.memory_id || 'saved'
        });
        break;
      }

      case 'query_knowledge': {
        const response = await fetch(`${N8N_URL}/webhook/jarvis/knowledge/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args)
        });

        if (!response.ok) throw new Error(`n8n error: ${response.status}`);
        const data = await response.json();

        res.json({
          success: true,
          results: data,
          count: data.length || 0
        });
        break;
      }

      case 'create_task': {
        const response = await fetch(`${N8N_URL}/webhook/jarvis/task/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...args,
            created_by: 'claude-mcp-http'
          })
        });

        if (!response.ok) throw new Error(`n8n error: ${response.status}`);
        const data = await response.json();

        res.json({
          success: true,
          message: 'Task created in all platforms',
          task_id: data.task_id
        });
        break;
      }

      case 'get_memory': {
        const { conversation_id } = args;

        const response = await fetch(
          `${N8N_URL}/webhook/jarvis/context/get?conversation_id=${conversation_id}`,
          { method: 'GET', headers: { 'Content-Type': 'application/json' } }
        );

        if (!response.ok) throw new Error(`n8n error: ${response.status}`);
        const data = await response.json();

        res.json({
          success: true,
          memory: data
        });
        break;
      }

      default:
        res.status(400).json({ error: `Unknown tool: ${name}` });
    }
  } catch (error) {
    res.status(500).json({
      error: error.message,
      tool: name
    });
  }
});

// Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'jarvis-mcp-server',
    timestamp: new Date().toISOString(),
    n8n: N8N_URL,
    supabase: SUPABASE_URL
  });
});

// Info Endpoint
app.get('/info', (req, res) => {
  res.json({
    name: 'Jarvis MCP Server',
    version: '1.0.0',
    type: 'http',
    protocol: 'MCP',
    tools: TOOLS.length,
    endpoints: {
      'POST /mcp/tools/list': 'List available tools',
      'POST /mcp/tools/call': 'Call a tool',
      'GET /health': 'Health check',
      'GET /info': 'Server info'
    }
  });
});

// Claude Desktop Config Helper
app.get('/claude-config', (req, res) => {
  const url = `${req.protocol}://${req.get('host')}`;
  res.json({
    mcpServers: {
      jarvis: {
        command: 'curl',
        args: ['-X', 'POST', `${url}/mcp/tools/list`],
        env: {
          MCP_SERVER_URL: url
        }
      }
    }
  });
});

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║     Jarvis MCP Server (HTTP)               ║
║     Running on port ${PORT}                    ║
╚════════════════════════════════════════════╝

📍 Endpoints:
  - POST /mcp/tools/list
  - POST /mcp/tools/call
  - GET  /health
  - GET  /info

🔗 Integration:
  N8N:      ${N8N_URL}
  Supabase: ${SUPABASE_URL}

✅ Ready for Claude Desktop
  `);
});
