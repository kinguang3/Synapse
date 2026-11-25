# Synapse MCP

Synapse exposes a local stdio MCP server. The MCP client starts the server; the editor sidebar and GUI do not start it.

## Start

Installed entry point:

```powershell
synapse-mcp
```

Without a persistent install:

```powershell
uvx --from synapse-knowledge synapse-mcp
```

## Opencode configuration

Merge this into the existing `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "synapse": {
      "type": "local",
      "command": ["uvx", "--from", "synapse-knowledge", "synapse-mcp"],
      "enabled": true
    }
  }
}
```

If `synapse-mcp` is already on `PATH`, use `"command": ["synapse-mcp"]` instead.

## Required workflow

1. Call `synapse_projects_list` to discover registered projects.
2. Pass a project id, slug, or root path as `project` to every project-scoped tool.
3. Use `synapse_context` for compact task context.
4. Use `synapse_search` for symbol or concept lookup, then pass returned node ids to `synapse_related` or `synapse_explore_graph`.
5. Use `synapse_recall` before `synapse_remember` to avoid duplicate memories.
6. Use `synapse_memory_get` for full memory content.

## Tools

| Tool | Arguments |
| --- | --- |
| `synapse_projects_list` | none |
| `synapse_project_status` | `project` |
| `synapse_search` | `project`, `query`; optional `limit`, `mode`, `node_types`, `path_prefix`, `graph_depth`, `relation_types` |
| `synapse_related` | `project`, `node_id`; optional `limit`, `relation_types`, `include` |
| `synapse_explore_graph` | `project`, `node_id`; optional `depth`, `direction`, `relation_types`, `limit` |
| `synapse_context` | `project`; optional `sections`, `max_tokens`, `query` |
| `synapse_remember` | `project`, `content`; optional `title`, `memory_type`, `tags`, `confidence`, `idempotency_key` |
| `synapse_recall` | `project`, `query`; optional `limit`, `mode` |
| `synapse_memory_get` | `project`, `node_id` |

## Parameter notes

- `mode`: `keyword` or `hybrid`. `hybrid` combines full-text search with graph ranking.
- `node_types`: for example `function`, `class`, `document`, or another type present in the index.
- `include`: `code`, `docs`, `memory`, or `other`.
- `direction`: `outgoing`, `incoming`, or `both`.
- `memory_type`: `fact`, `experience`, `decision`, `preference`, or `summary`.
- `confidence`: 0 to 1.
- `max_tokens`: 100 to 20000, default 1200.
- `limit`: 1 to 50 for search and recall; 1 to 200 for graph exploration.

## Safety

- `synapse_remember` writes to the local SQLite database. Do not call it for transient task state.
- Never store secrets, credentials, tokens, or large source dumps in memory.
- Search and context tools are read-only.
- Tool errors are returned as JSON error payloads; surface the code and message rather than retrying blindly.
