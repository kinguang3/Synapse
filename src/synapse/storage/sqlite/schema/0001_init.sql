CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  checksum   TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id              TEXT PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  root_path       TEXT NOT NULL,
  description     TEXT,
  config_json     TEXT NOT NULL DEFAULT '{}',
  metadata_json   TEXT NOT NULL DEFAULT '{}',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  last_indexed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_projects_root ON projects(root_path);

CREATE TABLE IF NOT EXISTS sources (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_type    TEXT NOT NULL,
  uri            TEXT NOT NULL,
  language       TEXT,
  content_hash   TEXT,
  size_bytes     INTEGER,
  mtime_ns       INTEGER,
  status         TEXT NOT NULL DEFAULT 'active',
  parser_name    TEXT,
  parser_version TEXT,
  indexed_at     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  metadata_json  TEXT NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sources_identity
  ON sources(project_id, source_type, uri);
CREATE INDEX IF NOT EXISTS ix_sources_hash ON sources(project_id, content_hash);
CREATE INDEX IF NOT EXISTS ix_sources_project_status ON sources(project_id, status);

CREATE TABLE IF NOT EXISTS nodes (
  pk                  INTEGER PRIMARY KEY AUTOINCREMENT,
  id                  TEXT NOT NULL UNIQUE,
  project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_id           TEXT REFERENCES sources(id) ON DELETE CASCADE,
  node_type           TEXT NOT NULL,
  node_key            TEXT NOT NULL,
  version             INTEGER NOT NULL DEFAULT 1,
  title               TEXT NOT NULL,
  content             TEXT NOT NULL DEFAULT '',
  search_text         TEXT NOT NULL DEFAULT '',
  tags                TEXT NOT NULL DEFAULT '',
  content_hash        TEXT NOT NULL,
  summary             TEXT,
  language            TEXT,
  path                TEXT,
  start_line          INTEGER,
  end_line            INTEGER,
  symbol_kind         TEXT,
  qualified_name      TEXT,
  qualified_name_norm TEXT,
  status              TEXT NOT NULL DEFAULT 'active',
  salience            REAL NOT NULL DEFAULT 0.5 CHECK (salience BETWEEN 0 AND 1),
  confidence          REAL NOT NULL DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
  memory_type         TEXT,
  provenance          TEXT NOT NULL DEFAULT 'ast',
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  accessed_at         TEXT,
  access_count        INTEGER NOT NULL DEFAULT 0,
  metadata_json       TEXT NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_nodes_key ON nodes(source_id, node_type, node_key);
CREATE INDEX IF NOT EXISTS ix_nodes_project_type ON nodes(project_id, node_type, status);
CREATE INDEX IF NOT EXISTS ix_nodes_qualified ON nodes(project_id, qualified_name);
CREATE INDEX IF NOT EXISTS ix_nodes_qualified_norm ON nodes(project_id, qualified_name_norm);
CREATE INDEX IF NOT EXISTS ix_nodes_path ON nodes(project_id, path);
CREATE INDEX IF NOT EXISTS ix_nodes_content_hash ON nodes(project_id, content_hash);

CREATE VIRTUAL TABLE IF NOT EXISTS node_fts USING fts5(
  title,
  search_text,
  tags,
  content='nodes',
  content_rowid='pk',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS nodes_fts_ai AFTER INSERT ON nodes BEGIN
  INSERT INTO node_fts(rowid, title, search_text, tags)
  VALUES (new.pk, new.title, new.search_text, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS nodes_fts_ad AFTER DELETE ON nodes BEGIN
  INSERT INTO node_fts(node_fts, rowid, title, search_text, tags)
  VALUES ('delete', old.pk, old.title, old.search_text, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS nodes_fts_au AFTER UPDATE OF title, search_text, tags ON nodes BEGIN
  INSERT INTO node_fts(node_fts, rowid, title, search_text, tags)
  VALUES ('delete', old.pk, old.title, old.search_text, old.tags);
  INSERT INTO node_fts(rowid, title, search_text, tags)
  VALUES (new.pk, new.title, new.search_text, new.tags);
END;

CREATE TABLE IF NOT EXISTS relations (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_node_id     TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  to_node_id       TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  relation_type    TEXT NOT NULL,
  confidence       REAL NOT NULL DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
  weight           REAL NOT NULL DEFAULT 1.0 CHECK (weight >= 0),
  provenance       TEXT NOT NULL,
  evidence_json    TEXT NOT NULL DEFAULT '[]',
  status           TEXT NOT NULL DEFAULT 'active',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  last_accessed_at TEXT,
  access_count     INTEGER NOT NULL DEFAULT 0,
  metadata_json    TEXT NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_relations_edge
  ON relations(from_node_id, to_node_id, relation_type);
CREATE INDEX IF NOT EXISTS ix_relations_from
  ON relations(from_node_id, relation_type, status);
CREATE INDEX IF NOT EXISTS ix_relations_to
  ON relations(to_node_id, relation_type, status);

CREATE TABLE IF NOT EXISTS unresolved_refs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_id        TEXT REFERENCES sources(id) ON DELETE CASCADE,
  from_node_id     TEXT REFERENCES nodes(id) ON DELETE CASCADE,
  ref_kind         TEXT NOT NULL,
  target_text      TEXT NOT NULL,
  target_path      TEXT,
  line             INTEGER,
  resolved_node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_unresolved_pending
  ON unresolved_refs(project_id, resolved_node_id);
CREATE INDEX IF NOT EXISTS ix_unresolved_target
  ON unresolved_refs(project_id, target_text);

CREATE TABLE IF NOT EXISTS tasks (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'queued',
  priority     INTEGER NOT NULL DEFAULT 0,
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  available_at TEXT NOT NULL,
  started_at   TEXT,
  finished_at  TEXT,
  last_error   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_tasks_claim
  ON tasks(status, available_at, priority DESC, created_at);

CREATE TABLE IF NOT EXISTS index_runs (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL,
  status      TEXT NOT NULL,
  stats_json  TEXT NOT NULL DEFAULT '{}',
  error       TEXT,
  started_at  TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_index_runs_project
  ON index_runs(project_id, started_at);
