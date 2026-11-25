# Synapse CLI

Use `synapse --help` or `synapse <command> --help` for the installed version's exact options.

## Output

Add `--json` to machine-readable commands. JSON output is the preferred agent interface. Errors with `--json` are emitted as `{"error": {...}}`.

## Projects

```text
synapse projects list --json
synapse projects register <path> [--name NAME] [--index] [--json]
synapse projects status [reference] --json
```

`reference` can be a project id, slug, or root path. Most commands infer the project when only one is registered or the current directory is inside a registered project.

## Index

```text
synapse index [reference] [--full] [--workers N] [--json]
```

- Omit `--full` for incremental indexing.
- Use `--full` after parser or indexing configuration changes.
- `--workers` controls parse concurrency, from 1 to 32.

## Search and graph

```text
synapse search <query> [--project REF] [--limit N] [--mode keyword|hybrid]
  [--type TYPE] [--path-prefix PREFIX] [--graph-depth N] [--relation TYPE] [--json]

synapse related <node_id> [--limit N] [--relation TYPE]
  [--include code|docs|memory|other] [--json]

synapse explore <node_id> [--depth N] [--direction outgoing|incoming|both]
  [--relation TYPE] [--limit N] [--json]
```

- `--mode hybrid` is the default and combines full-text search with graph ranking.
- `--mode keyword` uses full-text search only.
- Semantic embedding retrieval is not available.
- Search results contain node ids. Use those ids with `related` and `explore`.

Example:

```powershell
synapse search "build application" --project my-repo --limit 5 --json
synapse related <node_id> --include code --json
synapse explore <node_id> --depth 2 --direction both --json
```

## Context

```text
synapse context <project> [--section SECTION] [--max-tokens N]
  [--query QUERY] [--json]
```

Use `--query` to rank context modules for the current task. The default token budget is 1200; allowed range is 100 to 20000.

Example:

```powershell
synapse context my-repo --query "add a CLI command" --max-tokens 1200 --json
```

## Memory

```text
synapse remember <project> <content|-> [--title TITLE]
  [--type fact|experience|decision|preference|summary]
  [--tag TAG] [--confidence N] [--json]

synapse recall <query> [--project REF] [--limit N] [--mode keyword|hybrid] [--json]
synapse memory-get <node_id> [--project REF] [--json]
```

- Use `-` as content to read memory text from stdin.
- `--confidence` is from 0 to 1; the default is 1.0.
- `--tag` can be repeated.
- Recall returns summaries and node ids. Use `memory-get` for full content.
- Memory is persistent. Do not store secrets or transient task state.

Example:

```powershell
synapse recall "database migration policy" --project my-repo --json
synapse remember my-repo "Use numbered SQL migrations under storage/sqlite/schema." `
  --type decision --title "Migration policy" --tag sqlite --json
synapse memory-get <memory_node_id> --project my-repo --json
```

## Diagnostics

```text
synapse doctor --json
synapse config show --json
synapse config init --json
synapse version
```

`doctor` checks database integrity, full-text index integrity, and the number of registered projects.
