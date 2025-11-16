import Anthropic from "@anthropic-ai/sdk";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface WorkflowPlan {
  name: string;
  description: string;
  triggers: string[];
  steps: WorkflowStep[];
  expectedOutputs: string[];
}

interface WorkflowStep {
  id: string;
  name: string;
  type: string; // 'http', 'ai', 'database', 'conditional', etc.
  config: Record<string, string | number | boolean>;
}

interface N8NWorkflow {
  name: string;
  active: boolean;
  nodes: N8NNode[];
  connections: Record<string, N8NConnection[]>;
}

interface N8NNode {
  id: string;
  type: string;
  typeVersion?: number;
  position: [number, number];
  parameters: Record<string, unknown>;
}

interface N8NConnection {
  node: string;
  type: string;
  index: number;
}

/**
 * CHAT2N8N CONVERTER
 *
 * Turns natural language requests in chats into executable n8n workflows
 * Example: "Create a workflow that sends me a daily email summary of unread emails and calendar events"
 * -> Generates n8n workflow with Gmail trigger, Calendar node, AI summarizer, Email sender
 */

async function analyzeWorkflowRequest(userRequest: string): Promise<{
  intent: string;
  requiredServices: string[];
  complexity: "simple" | "moderate" | "complex";
  plan: WorkflowPlan;
}> {
  const analysisPrompt = `Analyze this workflow request and create a detailed implementation plan:

"${userRequest}"

Respond with JSON containing:
{
  "intent": "clear description of what this workflow should do",
  "requiredServices": ["list of external services needed - gmail, slack, http, etc"],
  "complexity": "simple|moderate|complex",
  "plan": {
    "name": "workflow name",
    "description": "detailed description",
    "triggers": ["what initiates this workflow"],
    "steps": [
      {
        "id": "step_1",
        "name": "step name",
        "type": "http|ai|database|conditional|email|slack|etc",
        "config": {
          "description": "step configuration parameters"
        }
      }
    ],
    "expectedOutputs": ["what this workflow produces"]
  }
}`;

  const response = await anthropic.messages.create({
    model: "claude-opus-4-1-20250805",
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: analysisPrompt,
      },
    ],
  });

  const analysisText =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Extract JSON from response
  const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Could not extract workflow plan from Claude response");
  }

  const analysis = JSON.parse(jsonMatch[0]);

  return {
    intent: analysis.intent,
    requiredServices: analysis.requiredServices,
    complexity: analysis.complexity,
    plan: analysis.plan,
  };
}

function generateN8NWorkflow(plan: WorkflowPlan): N8NWorkflow {
  const nodes: N8NNode[] = [];
  const connections: Record<string, N8NConnection[]> = {};

  let yOffset = 0;

  // Trigger node
  if (plan.triggers.length > 0) {
    const triggerType = plan.triggers[0].toLowerCase();
    nodes.push({
      id: "trigger",
      type: getTriggerNodeType(triggerType),
      position: [0, yOffset],
      parameters: buildTriggerConfig(triggerType),
    });
    yOffset += 150;
  }

  // Action nodes
  plan.steps.forEach((step, index) => {
    const nodeId = `node_${index}`;
    nodes.push({
      id: nodeId,
      type: getN8NNodeType(step.type),
      position: [400, yOffset],
      parameters: step.config,
    });

    // Connect to previous node
    if (index === 0 && plan.triggers.length > 0) {
      connections["trigger"] = [{ node: nodeId, type: "main", index: 0 }];
    } else if (index > 0) {
      connections[`node_${index - 1}`] = [
        { node: nodeId, type: "main", index: 0 },
      ];
    }

    yOffset += 150;
  });

  return {
    name: plan.name,
    active: false, // Start inactive for review
    nodes,
    connections,
  };
}

function getTriggerNodeType(trigger: string): string {
  const triggerMap: Record<string, string> = {
    email: "n8n-nodes-base.emailTrigger",
    schedule: "n8n-nodes-base.scheduleTrigger",
    webhook: "n8n-nodes-base.webhookTrigger",
    slack: "n8n-nodes-slack.slackTrigger",
    github: "n8n-nodes-github.githubTrigger",
    manual: "n8n-nodes-base.manualTrigger",
  };
  return triggerMap[trigger] || "n8n-nodes-base.webhookTrigger";
}

function getN8NNodeType(stepType: string): string {
  const typeMap: Record<string, string> = {
    http: "n8n-nodes-base.httpRequest",
    ai: "n8n-nodes-openai.chatGPT",
    database: "n8n-nodes-postgres.postgres",
    email: "n8n-nodes-base.emailSend",
    slack: "n8n-nodes-slack.slack",
    conditional: "n8n-nodes-base.if",
    code: "n8n-nodes-base.code",
  };
  return typeMap[stepType] || "n8n-nodes-base.httpRequest";
}

function buildTriggerConfig(
  trigger: string
): Record<string, unknown> {
  switch (trigger) {
    case "schedule":
      return {
        interval: [1],
        unit: "hours",
      };
    case "webhook":
      return {
        path: "workflow-trigger",
        responseMode: "onReceived",
      };
    default:
      return {};
  }
}

async function saveWorkflowPlan(
  plan: WorkflowPlan,
  n8nWorkflow: N8NWorkflow
): Promise<void> {
  await supabase.from("workflow_registry").insert([
    {
      workflow_name: plan.name,
      description: plan.description,
      trigger_type: plan.triggers[0] || "manual",
      status: "draft",
      config: n8nWorkflow,
      related_tasks: [],
    },
  ]);
}

async function createPlanningTasks(plan: WorkflowPlan): Promise<void> {
  const tasks = [
    {
      title: `Review workflow: ${plan.name}`,
      description: plan.description,
      category: "workflow",
      status: "in_progress",
      priority: 7,
      metadata: { workflow_plan: plan },
    },
    ...plan.steps.map((step) => ({
      title: `Configure: ${step.name}`,
      description: `Set up ${step.type} node for workflow`,
      category: "workflow",
      status: "backlog",
      priority: 5,
      metadata: { step_id: step.id },
    })),
  ];

  for (const task of tasks) {
    await supabase.from("planning_tasks").insert([task]);
  }
}

async function chat2Workflow(userRequest: string): Promise<void> {
  console.log("🔄 Converting chat request to workflow...\n");
  console.log(`Request: "${userRequest}"\n`);

  try {
    // Step 1: Analyze the request
    console.log("📊 Analyzing request...");
    const analysis = await analyzeWorkflowRequest(userRequest);

    console.log(`Intent: ${analysis.intent}`);
    console.log(`Required Services: ${analysis.requiredServices.join(", ")}`);
    console.log(`Complexity: ${analysis.complexity}\n`);

    // Step 2: Generate n8n workflow
    console.log("🏗️  Generating n8n workflow...");
    const n8nWorkflow = generateN8NWorkflow(analysis.plan);

    console.log(`Workflow: ${n8nWorkflow.name}`);
    console.log(`Nodes: ${n8nWorkflow.nodes.length}`);
    console.log(`Connections: ${Object.keys(n8nWorkflow.connections).length}\n`);

    // Step 3: Save to database
    console.log("💾 Saving workflow plan...");
    await saveWorkflowPlan(analysis.plan, n8nWorkflow);

    console.log("✅ Workflow plan saved\n");

    // Step 4: Create planning tasks
    console.log("📋 Creating planning tasks...");
    await createPlanningTasks(analysis.plan);

    console.log("✅ Planning tasks created\n");

    // Step 5: Print workflow summary
    console.log("=== WORKFLOW SUMMARY ===");
    console.log(`Name: ${analysis.plan.name}`);
    console.log(`Triggers: ${analysis.plan.triggers.join(", ")}`);
    console.log("Steps:");
    analysis.plan.steps.forEach((step, i) => {
      console.log(
        `  ${i + 1}. [${step.type}] ${step.name}`
      );
    });
    console.log(`Outputs: ${analysis.plan.expectedOutputs.join(", ")}`);
    console.log("======================\n");

    console.log(
      "📌 Workflow is now in 'draft' status. Review in dashboard then activate."
    );
  } catch (error) {
    console.error("❌ Error:", error);
    throw error;
  }
}

// Example usage
const chatRequest =
  "I want to create a workflow that monitors our GitHub repo, pulls new issues every morning, summarizes them with AI, and sends a Slack message to #operations. If the issue is marked urgent, also send it to my email.";

chat2Workflow(chatRequest).catch(console.error);
