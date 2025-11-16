import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

interface Tool {
  name: string;
  description: string;
  input_schema: {
    type: string;
    properties: Record<string, unknown>;
    required: string[];
  };
}

// Minimal in-memory tool definitions
const tools: Tool[] = [
  {
    name: "query_postgres",
    description: "Execute read-only SQL queries on Jarvis Supabase database",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "SQL SELECT query",
        },
        limit: {
          type: "number",
          description: "Result limit (default 100)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "search_vectors",
    description:
      "Semantic search via pgvector on Jarvis knowledge base or memory",
    input_schema: {
      type: "object",
      properties: {
        table: {
          type: "string",
          description: "Table name (e.g., 'documents', 'interactions')",
        },
        query_text: {
          type: "string",
          description: "Text to search for (will be embedded)",
        },
        top_k: {
          type: "number",
          description: "Number of results to return",
        },
      },
      required: ["table", "query_text"],
    },
  },
];

// Simulated tool execution
async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<string> {
  console.log(`\n> Tool: ${toolName}`);
  console.log("Input:", JSON.stringify(toolInput, null, 2));

  // In production, this would connect to actual Supabase
  if (toolName === "query_postgres") {
    return `Query executed: ${toolInput.query}\n(Results would be returned from Supabase)`;
  } else if (toolName === "search_vectors") {
    return `Semantic search in ${toolInput.table} for "${toolInput.query_text}"\n(Top ${toolInput.top_k || 5} results would be returned)`;
  }

  return "Tool not found";
}

async function main() {
  console.log("=== Jarvis PostgreSQL MCP Agent Demo ===\n");

  const userMessage =
    "Search for any interactions about budget planning in my memory, then summarize what decisions I made";

  console.log("User:", userMessage);

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: userMessage,
    },
  ];

  let continueLoop = true;

  while (continueLoop) {
    const response = await client.messages.create({
      model: "claude-opus-4-1-20250805",
      max_tokens: 1024,
      tools: tools as Anthropic.Tool[],
      messages,
    });

    console.log("\n--- Claude Response ---");
    console.log("Stop Reason:", response.stop_reason);

    // Process response content
    for (const block of response.content) {
      if (block.type === "text") {
        console.log("\nText:", block.text);
      } else if (block.type === "tool_use") {
        console.log(`\n[Tool Use: ${block.name}]`);

        const toolResult = await executeTool(
          block.name,
          block.input as Record<string, unknown>
        );
        console.log("Result:", toolResult);

        // Add tool result to messages
        messages.push({
          role: "assistant",
          content: response.content,
        });

        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: block.id,
              content: toolResult,
            },
          ],
        });
      }
    }

    // Check if we should continue
    if (response.stop_reason === "tool_use") {
      // Continue loop to process tool results
      continueLoop = true;
    } else {
      // End of conversation
      continueLoop = false;
    }
  }

  console.log("\n=== Demo Complete ===");
}

main().catch(console.error);
