import type Database from "better-sqlite3";

export const SCHEMA_VERSION = 3;

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
  }
};
