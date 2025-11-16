# Jarvis MCP Server

**Claude Desktop Integration für Jarvis AI System**

## Was macht der Server?

Claude kann direkt mit Jarvis kommunizieren:
- ✅ Kontexte im persistenten Memory speichern
- ✅ Knowledge Base semantisch durchsuchen
- ✅ Tasks in Monday/Slack/GitHub erstellen
- ✅ n8n Workflows orchestrieren

## Quick Start auf Replit

### 1. GitHub Fork + Replit Connect
- Gehe zu https://replit.com/new
- GitHub Repo verbinden: `zeitlospaco/jarvis-mcp-server`
- "Run" klicken

### 2. Secrets setzen (Replit Secrets Tab)
```
N8N_BASE_URL = https://n8n.hmd.services
N8N_API_KEY = [dein n8n api key]
```

### 3. Public URL kopieren
Replit zeigt dir: `https://[random].replit.dev`

### 4. Claude Desktop Config updaten

**File:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "jarvis": {
      "command": "node",
      "args": ["/path/to/mcp-server.js"],
      "env": {
        "N8N_BASE_URL": "https://n8n.hmd.services",
        "N8N_API_KEY": "your-key-here"
      }
    }
  }
}
```

Dann Claude Desktop neu starten → Tools sind verfügbar.

## Tools für Claude

### `save_context` 
Speichert Konversationen ins Memory.

### `query_knowledge`
Durchsucht die Knowledge Base.

### `create_task`
Erstellt Tasks in Monday/Slack/GitHub.

## Architektur

```
Claude Desktop
     ↓ (MCP)
Jarvis MCP Server (Replit)
     ↓ (HTTP)
n8n (n8n.hmd.services)
     ↓
Supabase | Monday | Slack | GitHub
```

---

**Status:** ✅ Production-Ready
