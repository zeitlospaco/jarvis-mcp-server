-- ============================================
-- JARVIS MEMORY & PLANNING SCHEMA
-- (Supabase PostgreSQL + pgvector)
-- ============================================

-- 1. CHAT MEMORY LAYER (unbegrenzt, semantisch durchsuchbar)
CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_hash TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  last_accessed TIMESTAMP DEFAULT NOW(),
  model_used TEXT DEFAULT 'claude-opus-4-1-20250805',
  status TEXT DEFAULT 'active' -- active, archived, paused
);

CREATE TABLE IF NOT EXISTS chat_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  message_index INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  tokens_used INTEGER,
  embedding vector(1536), -- OpenAI embedding
  embedding_model TEXT DEFAULT 'text-embedding-3-small',
  created_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb -- tags, intent, action_type, etc.
);

CREATE INDEX idx_chat_interactions_session ON chat_interactions(session_id);
CREATE INDEX idx_chat_interactions_embedding ON chat_interactions USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 2. CONTEXT SNAPSHOTS (komprimierte Session-Summaries für schnelles Laden)
CREATE TABLE IF NOT EXISTS context_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  key_decisions JSONB, -- Array of decisions made in this snapshot
  active_goals JSONB, -- Current goals/tasks
  created_at TIMESTAMP DEFAULT NOW(),
  valid_until TIMESTAMP, -- Invalidate old snapshots
  UNIQUE(session_id)
);

-- 3. PLANNING DATABASE (zentrale Agenda aller Vorhaben)
CREATE TABLE IF NOT EXISTS planning_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL CHECK (category IN ('infrastructure', 'agent', 'workflow', 'integration', 'optimization')),
  status TEXT NOT NULL DEFAULT 'backlog' CHECK (status IN ('backlog', 'in_progress', 'blocked', 'done', 'paused')),
  priority INTEGER DEFAULT 5 CHECK (priority BETWEEN 1 AND 10), -- 10 = urgent
  owner TEXT, -- Agent name or 'manual'
  created_at TIMESTAMP DEFAULT NOW(),
  due_date TIMESTAMP,
  completed_at TIMESTAMP,
  dependencies TEXT[], -- Array of task IDs this depends on
  metadata JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_planning_tasks_status ON planning_tasks(status);
CREATE INDEX idx_planning_tasks_priority ON planning_tasks(priority DESC);

-- 4. WORKFLOWS REGISTRY (alle n8n Workflows + ihre Konfiguration)
CREATE TABLE IF NOT EXISTS workflow_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_name TEXT NOT NULL UNIQUE,
  n8n_workflow_id INTEGER,
  description TEXT,
  trigger_type TEXT CHECK (trigger_type IN ('manual', 'scheduled', 'webhook', 'event', 'chat')),
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'testing', 'paused')),
  created_at TIMESTAMP DEFAULT NOW(),
  last_modified TIMESTAMP DEFAULT NOW(),
  config JSONB DEFAULT '{}'::jsonb, -- n8n config snapshot
  related_tasks TEXT[], -- links to planning_tasks
  metrics JSONB DEFAULT '{"executions": 0, "success_rate": 0}'::jsonb
);

CREATE INDEX idx_workflow_registry_status ON workflow_registry(status);

-- 5. AGENTS REGISTRY (alle aktiven Agenten + ihr State)
CREATE TABLE IF NOT EXISTS agent_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name TEXT NOT NULL UNIQUE,
  agent_type TEXT NOT NULL CHECK (agent_type IN ('marketing', 'finance', 'operations', 'technical', 'personal')),
  framework TEXT DEFAULT 'crewai' CHECK (framework IN ('crewai', 'langgraph', 'autogen')),
  status TEXT DEFAULT 'initialized' CHECK (status IN ('initialized', 'active', 'learning', 'paused', 'error')),
  capabilities TEXT[] NOT NULL, -- e.g., ['email_processing', 'report_generation']
  last_execution TIMESTAMP,
  execution_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  config JSONB DEFAULT '{}'::jsonb,
  performance_metrics JSONB DEFAULT '{"success_rate": 0, "avg_response_time": 0}'::jsonb
);

CREATE INDEX idx_agent_registry_status ON agent_registry(status);

-- 6. PERSONAL AGENT MEMORY (Volkan-Agent spezifisches Gedächtnis)
CREATE TABLE IF NOT EXISTS volkan_agent_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dimension TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  confidence FLOAT DEFAULT 0.8, -- 0-1, wie sicher sind wir
  last_updated TIMESTAMP DEFAULT NOW(),
  evidence JSONB DEFAULT '{}'::jsonb, -- where this came from
  embeddings vector(1536)
);

-- Examples: dimension='tone_preference', value='formal but slightly casual', etc.
CREATE INDEX idx_volkan_profile_embedding ON volkan_agent_profile USING ivfflat (embeddings vector_cosine_ops);

-- 7. FEEDBACK & LEARNING LOG (für kontinuierliche Verbesserung)
CREATE TABLE IF NOT EXISTS interaction_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interaction_id UUID REFERENCES chat_interactions(id),
  feedback_type TEXT NOT NULL CHECK (feedback_type IN ('quality', 'relevance', 'tone', 'accuracy', 'decision_quality')),
  score INTEGER CHECK (score BETWEEN 1 AND 10),
  comment TEXT,
  agent_corrected BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_feedback_interaction ON interaction_feedback(interaction_id);

-- 8. EXECUTION LOG (Audit trail für alle Aktionen)
CREATE TABLE IF NOT EXISTS execution_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type TEXT NOT NULL, -- 'workflow_executed', 'agent_created', 'decision_made'
  triggered_by TEXT, -- 'chat_id', 'webhook', 'schedule'
  workflow_id UUID REFERENCES workflow_registry(id),
  agent_id UUID REFERENCES agent_registry(id),
  status TEXT CHECK (status IN ('success', 'failed', 'partial')),
  result JSONB,
  error_message TEXT,
  execution_time_ms INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_execution_log_created ON execution_log(created_at DESC);

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_planning_tasks_update BEFORE UPDATE ON planning_tasks
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_workflow_registry_update BEFORE UPDATE ON workflow_registry
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- FULL-TEXT & SEMANTIC SEARCH HELPERS
-- ============================================

CREATE OR REPLACE FUNCTION search_chat_history(
  query_text TEXT,
  session_id UUID DEFAULT NULL,
  limit_count INT DEFAULT 10
)
RETURNS TABLE (
  interaction_id UUID,
  content TEXT,
  role TEXT,
  similarity FLOAT,
  created_at TIMESTAMP
) AS $$
BEGIN
  -- Generate embedding for search query (requires trigger/app to call OpenAI)
  -- For now, returning top matches by cosine similarity
  RETURN QUERY
  SELECT
    ci.id,
    ci.content,
    ci.role,
    1 - (ci.embedding <=> (SELECT embedding FROM chat_interactions WHERE id = $1 LIMIT 1)) as similarity,
    ci.created_at
  FROM chat_interactions ci
  WHERE (session_id IS NULL OR ci.session_id = session_id)
    AND ci.embedding IS NOT NULL
  ORDER BY similarity DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Materialize recent context for fast loading
CREATE MATERIALIZED VIEW recent_context AS
SELECT
  cs.session_hash,
  cs.created_at as session_start,
  COUNT(ci.id) as total_interactions,
  SUM(ci.tokens_used) as total_tokens,
  csn.summary,
  csn.key_decisions,
  csn.active_goals
FROM chat_sessions cs
LEFT JOIN chat_interactions ci ON cs.id = ci.session_id
LEFT JOIN context_snapshots csn ON cs.id = csn.session_id
WHERE cs.status = 'active'
GROUP BY cs.id, cs.session_hash, csn.summary, csn.key_decisions, csn.active_goals;

-- ============================================
-- ENABLE ROW-LEVEL SECURITY (optional for multi-tenant)
-- ============================================

ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_registry ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
