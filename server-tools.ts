import express, { Request, Response } from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";
import * as crypto from "crypto";

const app = express();
const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_KEY || ""
);

app.use(cors());
app.use(express.json());

/**
 * MCP TOOLS EXPOSED FOR CLAUDE
 * These are callable from Claude chats to:
 * 1. Create workflows from natural language
 * 2. Query planning tasks
 * 3. Inject memory context
 * 4. Trigger n8n workflows
 */

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required: string[];
  };
}

const AVAILABLE_TOOLS: MCPTool[] = [
  {
    name: "create_workflow_from_chat",
    description:
      "Convert natural language request into an n8n workflow and save to planning tasks",
    inputSchema: {
      type: "object",
      properties: {
        user_request: {
          type: "string",
          description: "Natural language description of desired workflow",
        },
        priority: {
          type: "number",
          description: "Priority (1-10)",
          default: 5,
        },
      },
      required: ["user_request"],
    },
  },
  {
    name: "get_planning_status",
    description: "Get current status of all planning tasks and active goals",
    inputSchema: {
      type: "object",
      properties: {
        status_filter: {
          type: "string",
          description: 'Filter by status: "all", "in_progress", "backlog", "done"',
          enum: ["all", "in_progress", "backlog", "done"],
        },
      },
      required: [],
    },
  },
  {
    name: "inject_context",
    description:
      "Load memory context for current session (relevant past interactions, Volkan profile, active goals)",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID (optional - uses latest if not provided)",
        },
      },
      required: [],
    },
  },
  {
    name: "save_task",
    description:
      "Save a new task to the planning database with automatic priority/status",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Task title",
        },
        description: {
          type: "string",
          description: "Detailed description",
        },
        category: {
          type: "string",
          enum: ["infrastructure", "agent", "workflow", "integration", "optimization"],
        },
        priority: {
          type: "number",
          description: "Priority 1-10",
        },
      },
      required: ["title", "category"],
    },
  },
  {
    name: "trigger_workflow",
    description: "Trigger an n8n workflow by name and pass data",
    inputSchema: {
      type: "object",
      properties: {
        workflow_name: {
          type: "string",
          description: "Name of the workflow to trigger",
        },
        data: {
          type: "object",
          description: "Input data for the workflow",
        },
      },
      required: ["workflow_name"],
    },
  },
  {
    name: "search_memory",
    description:
      "Semantic search through past interactions and decisions (vector search)",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What to search for",
        },
        limit: {
          type: "number",
          description: "Number of results",
          default: 5,
        },
      },
      required: ["query"],
    },
  },
];

// ============ ENDPOINT: List Tools ============
app.get("/mcp/tools/list", (req: Request, res: Response) => {
  res.json({
    tools: AVAILABLE_TOOLS,
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

// ============ ENDPOINT: Execute Tool ============
app.post("/mcp/tools/call", async (req: Request, res: Response) => {
  try {
    const { tool_name, arguments: toolArgs } = req.body;

    console.log(`🔧 Calling tool: ${tool_name}`);

    let result: Record<string, unknown> = {};

    switch (tool_name) {
      case "create_workflow_from_chat":
        result = await handleCreateWorkflow(
          toolArgs.user_request,
          toolArgs.priority || 5
        );
        break;

      case "get_planning_status":
        result = await handleGetPlanningStatus(toolArgs.status_filter);
        break;

      case "inject_context":
        result = await handleInjectContext(toolArgs.session_id);
        break;

      case "save_task":
        result = await handleSaveTask(toolArgs);
        break;

      case "trigger_workflow":
        result = await handleTriggerWorkflow(
          toolArgs.workflow_name,
          toolArgs.data
        );
        break;

      case "search_memory":
        result = await handleSearchMemory(toolArgs.query, toolArgs.limit || 5);
        break;

      default:
        throw new Error(`Unknown tool: ${tool_name}`);
    }

    res.json({
      success: true,
      result,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(400).json({
      success: false,
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
  }
});

// ============ HANDLERS ============

async function handleCreateWorkflow(
  request: string,
  priority: number
): Promise<Record<string, unknown>> {
  // In production, this calls the chat2workflow service
  const { data, error } = await supabase
    .from("workflow_registry")
    .insert([
      {
        workflow_name: `workflow_${crypto.randomUUID().slice(0, 8)}`,
        description: `Auto-generated: ${request}`,
        trigger_type: "manual",
        status: "draft",
        config: { prompt: request },
      },
    ])
    .select();

  if (error) throw error;

  // Create planning task
  await supabase.from("planning_tasks").insert([
    {
      title: `Workflow: ${request.substring(0, 50)}...`,
      description: `Generate and configure: ${request}`,
      category: "workflow",
      priority,
      status: "in_progress",
      metadata: { workflow_id: data?.[0]?.id },
    },
  ]);

  return {
    success: true,
    workflow_id: data?.[0]?.id,
    message: `Workflow created and added to planning tasks at priority ${priority}`,
  };
}

async function handleGetPlanningStatus(
  statusFilter: string
): Promise<Record<string, unknown>> {
  let query = supabase.from("planning_tasks").select("*");

  if (statusFilter && statusFilter !== "all") {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query.order("priority", { ascending: false });

  if (error) throw error;

  return {
    total: data?.length || 0,
    tasks: data,
    statuses: {
      backlog: data?.filter((t) => t.status === "backlog").length || 0,
      in_progress: data?.filter((t) => t.status === "in_progress").length || 0,
      done: data?.filter((t) => t.status === "done").length || 0,
    },
  };
}

async function handleInjectContext(
  sessionId?: string
): Promise<Record<string, unknown>> {
  // Get recent context
  const { data: context } = await supabase
    .from("recent_context")
    .select("*")
    .limit(1)
    .single();

  // Get Volkan profile
  const { data: profile } = await supabase
    .from("volkan_agent_profile")
    .select("dimension, value, confidence")
    .gt("confidence", 0.7);

  // Get active goals
  const { data: activeTasks } = await supabase
    .from("planning_tasks")
    .select("title, priority")
    .eq("status", "in_progress")
    .order("priority", { ascending: false })
    .limit(5);

  return {
    session_summary: context?.summary || "Starting fresh session",
    volkan_preferences: profile?.map((p) => ({
      [p.dimension]: p.value,
    })),
    active_goals: activeTasks?.map((t) => t.title),
    context_ready: true,
  };
}

async function handleSaveTask(
  taskData: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from("planning_tasks")
    .insert([
      {
        title: taskData.title,
        description: taskData.description,
        category: taskData.category,
        priority: taskData.priority || 5,
        status: "backlog",
      },
    ])
    .select();

  if (error) throw error;

  return {
    success: true,
    task_id: data?.[0]?.id,
    message: `Task saved: ${taskData.title}`,
  };
}

async function handleTriggerWorkflow(
  workflowName: string,
  data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  // Get workflow from n8n
  const n8nUrl = process.env.N8N_URL || "https://n8n.hmd.services";

  try {
    const response = await fetch(
      `${n8nUrl}/api/v1/workflows?filter={"name":"${workflowName}"}`,
      {
        headers: {
          "X-N8N-API-KEY": process.env.N8N_API_KEY || "",
        },
      }
    );

    const workflows = (await response.json()) as { data: Array<{ id: string; webhookPath: string }> };

    if (workflows.data.length === 0) {
      throw new Error(`Workflow not found: ${workflowName}`);
    }

    // Trigger via webhook
    const webhookUrl = `${n8nUrl}/webhook-test/${workflows.data[0].webhookPath}`;
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    return {
      success: true,
      workflow_id: workflows.data[0].id,
      message: `Workflow triggered: ${workflowName}`,
    };
  } catch (error) {
    throw new Error(`Failed to trigger workflow: ${String(error)}`);
  }
}

async function handleSearchMemory(
  query: string,
  limit: number
): Promise<Record<string, unknown>> {
  // Placeholder: in production, this generates embedding and does pgvector search
  const { data, error } = await supabase
    .from("chat_interactions")
    .select("content, role, created_at")
    .textSearch("content", query)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return {
    query,
    results: data,
    count: data?.length || 0,
  };
}

// ============ HEALTH CHECK ============
app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ============ START SERVER ============
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Jarvis MCP Tools Server listening on port ${PORT}`);
  console.log(`📋 Tools endpoint: http://localhost:${PORT}/mcp/tools/list`);
});
