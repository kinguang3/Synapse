---
name: synapse
description: Use when an agent needs local code knowledge graph search, project context, related code, graph exploration, or persistent project memory for a repository. Prefer Synapse MCP tools when available; otherwise use the synapse CLI with JSON output.
---

# Synapse

Synapse is a local-first code knowledge graph, context builder, and project memory service. It stores indexed code, documentation, graph relations, and explicit memories in a local SQLite database.

## Choose the interface

1. If Synapse MCP tools are available, use them first.
2. Otherwise, use the `synapse` CLI with `--json`.
3. Do not use the browser GUI or editor sidebar as an agent API. They are human-facing interfaces.

Common MCP tool to CLI mapping:

| MCP tool | CLI fallback |
| --- | --- |
| `synapse_projects_list` | `synapse projects list --json` |
| `synapse_project_status` | `synapse projects status <project> --json` |
| `synapse_search` | `synapse search "<query>" --project <project> --json` |
| `synapse_context` | `synapse context <project> --query "<task>" --json` |
| `synapse_related` | `synapse related <node_id> --json` |
| `synapse_explore_graph` | `synapse explore <node_id> --json` |
| `synapse_remember` | `synapse remember <project> "<content>" --json` |
| `synapse_recall` | `synapse recall "<query>" --project <project> --json` |
| `synapse_memory_get` | `synapse memory-get <node_id> --project <project> --json` |

## Preflight

```powershell
synapse version
synapse projects list --json
```

If the command is missing, install it:

```powershell
uv tool install synapse-knowledge
```

Or run it without a persistent install:

```powershell
uvx --from synapse-knowledge synapse projects list --json
```

Use `scripts/check.ps1` to verify the CLI and MCP entry points. Add `-Deep` to also list registered projects.

## First use in a repository

Register and index the current project once:

```powershell
synapse projects register . --name <name> --index --json
```

For later changes, refresh the index:

```powershell
synapse index --json
```

Use `--full` only when parser behavior or indexing configuration changed, because it reparses every file.

## Working workflow

1. Discover the project with `synapse projects list --json`.
2. For a task, build compact context with `synapse context <project> --query "<task>" --json`.
3. Search for symbols or concepts with `synapse search "<query>" --project <project> --json`.
4. Use the returned `node_id` values with `synapse related` or `synapse explore`.
5. Before storing memory, use `synapse recall` to check for an existing memory.
6. Store durable decisions or conventions with `synapse remember`; read full content with `synapse memory-get`.

## Rules

- Pass an explicit project reference for every project-scoped operation when multiple projects are registered.
- Prefer `--json` for CLI calls and parse the structured fields instead of scraping human-readable tables.
- Treat `mode: hybrid` as full-text search plus graph ranking. Semantic embedding retrieval is not available.
- Do not store secrets, credentials, large source dumps, or transient task state in memory.
- Only write memory when the user asks, or when a durable project decision or convention is clearly worth keeping.
- Indexing is local and can take time. Prefer incremental indexing; avoid concurrent index runs against the same project.

## References

- `references/cli.md`: CLI commands, options, and JSON workflows.
- `references/mcp.md`: MCP server setup and tool parameters.
- `scripts/check.ps1`: verify installed entry points.
- `scripts/install.ps1`: install this skill into a project or user skill directory.
