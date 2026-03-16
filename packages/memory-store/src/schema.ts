import type Database from "better-sqlite3";

export const SCHEMA_VERSION = 4;

export const DDL = `
CREATE TABLE IF NOT EXISTS workflow_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_workflow_events_run_id ON workflow_events(run_id);
CREATE INDEX IF NOT EXISTS idx_workflow_events_type ON workflow_events(type);

CREATE TABLE IF NOT EXISTS run_checkpoints (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  goal TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_run_checkpoints_status ON run_checkpoints(status);

CREATE TABLE IF NOT EXISTS user_preferences (
  id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  captured_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_ns ON user_preferences(namespace);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_preferences_ns_key ON user_preferences(namespace, key);

CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS browser_sessions (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  profile_id TEXT,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  terminated_at TEXT,
  termination_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_browser_sessions_run_id ON browser_sessions(run_id);
CREATE INDEX IF NOT EXISTS idx_browser_sessions_state ON browser_sessions(state);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  run_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tone TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);

CREATE TABLE IF NOT EXISTS chat_session_runs (
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  PRIMARY KEY (session_id, run_id)
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  folder TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  favicon_url TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bookmarks_url ON bookmarks(url);
CREATE INDEX IF NOT EXISTS idx_bookmarks_folder ON bookmarks(folder);

CREATE TABLE IF NOT EXISTS browsing_history (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  profile_id TEXT,
  run_id TEXT,
  visited_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_browsing_history_visited_at ON browsing_history(visited_at DESC);
CREATE INDEX IF NOT EXISTS idx_browsing_history_url ON browsing_history(url);

CREATE TABLE IF NOT EXISTS browser_profiles (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  is_managed INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cookie_containers (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  color TEXT,
  icon TEXT,
  profile_id TEXT REFERENCES browser_profiles(id),
  partition_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_accounts (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  display_name TEXT,
  auth_provider TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS standalone_tabs (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  profile_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_bridge_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export type MigrationFn = (db: Database.Database) => void;

export const MIGRATIONS: Record<number, MigrationFn> = {
  2: (db) => {
    // V1 -> V2: Add indexed columns to run_checkpoints, add indexes
    db.exec(`ALTER TABLE run_checkpoints ADD COLUMN status TEXT NOT NULL DEFAULT 'queued'`);
    db.exec(`ALTER TABLE run_checkpoints ADD COLUMN goal TEXT NOT NULL DEFAULT ''`);
    db.exec(`ALTER TABLE run_checkpoints ADD COLUMN created_at TEXT NOT NULL DEFAULT ''`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_run_checkpoints_status ON run_checkpoints(status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_events_type ON workflow_events(type)`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_preferences_ns_key ON user_preferences(namespace, key)`);

    // Backfill status and goal from existing JSON data
    const rows = db.prepare("SELECT id, data FROM run_checkpoints").all() as Array<{ id: string; data: string }>;
    const update = db.prepare("UPDATE run_checkpoints SET status = ?, goal = ?, created_at = ? WHERE id = ?");
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.data) as { status?: string; goal?: string; createdAt?: string };
        update.run(parsed.status ?? "queued", parsed.goal ?? "", parsed.createdAt ?? "", row.id);
      } catch {
        // Skip rows with invalid JSON
      }
    }
  },
  3: (db) => {
    // V2 -> V3: Add created_at DESC index on workflow_events for listRecent() query
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_workflow_events_created_at ON workflow_events(created_at DESC, id DESC)`
    );
  },
  4: (db) => {
    // V3 -> V4: Add tables for session tracking, chat, bookmarks, history, profiles, containers, etc.
    db.exec(`
      CREATE TABLE IF NOT EXISTS browser_sessions (
        id TEXT PRIMARY KEY,
        run_id TEXT,
        profile_id TEXT,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        terminated_at TEXT,
        termination_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_browser_sessions_run_id ON browser_sessions(run_id);
      CREATE INDEX IF NOT EXISTS idx_browser_sessions_state ON browser_sessions(state);

      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        run_id TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tone TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);

      CREATE TABLE IF NOT EXISTS chat_session_runs (
        session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL,
        linked_at TEXT NOT NULL,
        PRIMARY KEY (session_id, run_id)
      );

      CREATE TABLE IF NOT EXISTS bookmarks (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        folder TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        favicon_url TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bookmarks_url ON bookmarks(url);
      CREATE INDEX IF NOT EXISTS idx_bookmarks_folder ON bookmarks(folder);

      CREATE TABLE IF NOT EXISTS browsing_history (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        profile_id TEXT,
        run_id TEXT,
        visited_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_browsing_history_visited_at ON browsing_history(visited_at DESC);
      CREATE INDEX IF NOT EXISTS idx_browsing_history_url ON browsing_history(url);

      CREATE TABLE IF NOT EXISTS browser_profiles (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        is_managed INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cookie_containers (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        color TEXT,
        icon TEXT,
        profile_id TEXT REFERENCES browser_profiles(id),
        partition_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_accounts (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE,
        display_name TEXT,
        auth_provider TEXT,
        role TEXT NOT NULL DEFAULT 'user',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS standalone_tabs (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        profile_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chat_bridge_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }
};
