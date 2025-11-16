# 🚀 Jarvis MCP Server
**Production-Ready HTTP MCP Server für Claude Desktop Integration**

Verbindet **Claude** ↔ **n8n** ↔ **Supabase** für autonome Jarvis-Agenteneichung.

## ✨ Features

✅ **Semantic Search** – `conversation_search` via Supabase pgvector (RAG)  
✅ **Memory Management** – Persistente Speicherung aller Interactions  
✅ **Workflow Orchestration** – n8n-Integration für Task-Automatisierung  
✅ **Task Creation** – Multi-Platform (Monday.com, GitHub, Slack)  
✅ **Agent Monitoring** – Status & Health Checks  
✅ **Production Ready** – Zero-Downtime Deployment  

## 📚 Verfügbare MCP-Tools

### `conversation_search`
Semantic Search in Jarvis Knowledge Base (RAG via pgvector)

### `save_context`
Speichere Claude-Jarvis Interaktionen für Future Retrieval

### `trigger_workflow`
Starte n8n Workflows direkt

### `create_task`
Erstelle Tasks über Multiple Plattformen

### `get_agent_status`
Agenten-Monitoring & Health Checks

## 🚀 Replit Deployment

1. **GitHub Connection** (in Replit Settings)
2. **Set Secrets** (siehe .env.example)
3. **Run** – Auto-Deploy

## 🔌 Claude Desktop Config

```json
{
  "mcpServers": {
    "jarvis": {
      "command": "curl",
      "args": ["-X", "POST", "https://YOUR-REPLIT-URL/mcp/tools/call"],
      "env": {
        "MCP_SERVER_URL": "https://YOUR-REPLIT-URL"
      }
    }
  }
}
```

## 📖 Weitere Ressourcen

- [MCP Dokumentation](https://modelcontextprotocol.io/)
- [n8n API Doku](https://docs.n8n.io/api/)
- [Supabase pgvector](https://supabase.com/docs/guides/database/extensions/pgvector)

**Maintainer:** Volkan (HMD Services)  
**License:** MIT  
**Version:** 1.0.0