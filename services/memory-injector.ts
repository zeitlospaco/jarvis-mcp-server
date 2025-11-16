import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

const anthropic = new Anthropic({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * MEMORY INJECTOR SERVICE
 * Automatically loads context from Supabase on each chat
 * - Retrieves relevant past interactions
 * - Injects Volkan profile (preferences, style, decisions)
 * - Creates session context snapshots
 */

interface ChatSession {
  id: string;
  sessionHash: string;
  createdAt: string;
  totalTokens: number;
}

interface ContextSnapshot {
  summary: string;
  keyDecisions: Record<string, string>[];
  activeGoals: string[];
}

async function generateSessionHash(): Promise<string> {
  return crypto.randomBytes(16).toString("hex");
}

async function getOrCreateSession(
  sessionHint?: string
): Promise<{ session: ChatSession; context: ContextSnapshot }> {
  // Try to find existing session from hint
  if (sessionHint) {
    const { data: existing } = await supabase
      .from("chat_sessions")
      .select("id, session_hash, created_at")
      .eq("status", "active")
      .limit(1)
      .single();

    if (existing) {
      const context = await getContextSnapshot(existing.id);
      return {
        session: {
          id: existing.id,
          sessionHash: existing.session_hash,
          createdAt: existing.created_at,
          totalTokens: 0,
        },
        context,
      };
    }
  }

  // Create new session
  const sessionHash = await generateSessionHash();
  const { data: newSession, error } = await supabase
    .from("chat_sessions")
    .insert([
      {
        session_hash: sessionHash,
        model_used: "claude-opus-4-1-20250805",
        status: "active",
      },
    ])
    .select()
    .single();

  if (error) throw error;

  return {
    session: {
      id: newSession.id,
      sessionHash: newSession.session_hash,
      createdAt: newSession.created_at,
      totalTokens: 0,
    },
    context: {
      summary: "New session started",
      keyDecisions: [],
      activeGoals: [],
    },
  };
}

async function getContextSnapshot(sessionId: string): Promise<ContextSnapshot> {
  // Get materialized recent context
  const { data: recentContext } = await supabase
    .from("recent_context")
    .select("summary, key_decisions, active_goals")
    .eq("session_id", sessionId)
    .single();

  if (recentContext) {
    return {
      summary: recentContext.summary || "",
      keyDecisions: recentContext.key_decisions || [],
      activeGoals: recentContext.active_goals || [],
    };
  }

  return {
    summary: "Starting fresh session",
    keyDecisions: [],
    activeGoals: [],
  };
}

async function getVolkanProfile(): Promise<Record<string, string>> {
  const { data: profile } = await supabase
    .from("volkan_agent_profile")
    .select("dimension, value, confidence")
    .gt("confidence", 0.7)
    .order("last_updated", { ascending: false });

  const profileObj: Record<string, string> = {};
  profile?.forEach((item: { dimension: string; value: string }) => {
    profileObj[item.dimension] = item.value;
  });

  return profileObj;
}

async function searchRelevantMemories(
  userMessage: string,
  sessionId: string,
  limit: number = 5
): Promise<string[]> {
  // Placeholder: in production this generates embedding via OpenAI
  // and does vector similarity search
  const { data: memories } = await supabase
    .from("chat_interactions")
    .select("content")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return memories?.map((m: { content: string }) => m.content) || [];
}

function buildContextInjection(
  context: ContextSnapshot,
  profile: Record<string, string>,
  relevantMemories: string[]
): string {
  const lines: string[] = [
    "=== JARVIS CONTEXT INJECTION ===",
    "",
    "SESSION STATUS:",
    `Summary: ${context.summary}`,
    `Active Goals: ${context.activeGoals.length > 0 ? context.activeGoals.join(", ") : "None"}`,
    "",
    "VOLKAN PREFERENCES:",
  ];

  Object.entries(profile).forEach(([key, value]) => {
    lines.push(`- ${key}: ${value}`);
  });

  if (relevantMemories.length > 0) {
    lines.push("");
    lines.push("RELEVANT PAST INTERACTIONS:");
    relevantMemories.forEach((mem, i) => {
      lines.push(`${i + 1}. ${mem.substring(0, 100)}...`);
    });
  }

  lines.push("");
  lines.push("=== END CONTEXT ===");

  return lines.join("\n");
}

async function storeInteraction(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  metadata: Record<string, string> = {}
): Promise<void> {
  const messageIndex = 0; // In production, count existing messages

  await supabase.from("chat_interactions").insert([
    {
      session_id: sessionId,
      message_index: messageIndex,
      role,
      content,
      metadata,
      tokens_used: Math.ceil(content.length / 4),
    },
  ]);
}

async function createContextSnapshot(
  sessionId: string,
  summary: string,
  decisions: Record<string, string>[],
  goals: string[]
): Promise<void> {
  await supabase
    .from("context_snapshots")
    .upsert([
      {
        session_id: sessionId,
        summary,
        key_decisions: decisions,
        active_goals: goals,
      },
    ]);
}

/**
 * MAIN: Chat with Memory Injection
 */
async function chatWithMemory(userMessage: string): Promise<void> {
  console.log("🧠 Initializing Memory Injector...\n");

  // Get or create session
  const { session, context } = await getOrCreateSession();
  console.log(`📍 Session: ${session.sessionHash}\n`);

  // Load Volkan profile
  const profile = await getVolkanProfile();
  console.log("📋 Loaded Volkan Profile:");
  Object.entries(profile).slice(0, 3).forEach(([k, v]) => {
    console.log(`   ${k}: ${v}`);
  });

  // Search for relevant past interactions
  const relevantMemories = await searchRelevantMemories(
    userMessage,
    session.id
  );

  // Build context injection
  const contextInjection = buildContextInjection(
    context,
    profile,
    relevantMemories
  );

  // Store user message
  await storeInteraction(
    session.id,
    "user",
    userMessage,
    { type: "user_input" }
  );

  // Build system prompt with context
  const systemPrompt = `Du bist Jarvis, der persönliche KI-Agent von Volkan.
  
${contextInjection}

Wichtig:
- Arbeite immer im Kontext der aktiven Ziele
- Beachte die Volkan-Präferenzen
- Integriere relevante Erkenntnisse aus vergangenen Interaktionen
- Schlage Verbesserungen vor, wenn nötig
`;

  // Call Claude
  const response = await anthropic.messages.create({
    model: "claude-opus-4-1-20250805",
    max_tokens: 2000,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: userMessage,
      },
    ],
  });

  const assistantMessage =
    response.content[0].type === "text" ? response.content[0].text : "";

  console.log("\n🤖 Jarvis Response:");
  console.log(assistantMessage);

  // Store assistant response
  await storeInteraction(
    session.id,
    "assistant",
    assistantMessage,
    { type: "response", tokens_used: response.usage.output_tokens }
  );

  // Extract and store key decisions/goals from response
  // (In production, use Claude to analyze the response)
  await createContextSnapshot(session.id, "Chat completed", [], []);

  console.log("\n✅ Interaction stored in memory");
}

// Example usage
const userInput =
  "Ich möchte heute ein neues Marketing-Workflow erstellen für unsere Q4-Kampagne. Was sollten wir berücksichtigen basierend auf meinen bisherigen Erfahrungen?";

chatWithMemory(userInput).catch(console.error);
