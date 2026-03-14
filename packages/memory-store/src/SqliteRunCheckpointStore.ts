import type { TaskRun, TaskStatus } from "@openbrowse/contracts";
import type { SqliteDatabase } from "./SqliteDatabase.js";
import type { RunCheckpointStore } from "./MemoryStore.js";

export class SqliteRunCheckpointStore implements RunCheckpointStore {
  constructor(private readonly sqlite: SqliteDatabase) {}

  async save(run: TaskRun): Promise<void> {
    this.sqlite.db
      .prepare(
        `INSERT OR REPLACE INTO run_checkpoints (id, status, goal, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(run.id, run.status, run.goal, JSON.stringify(run), run.createdAt, run.updatedAt);
  }

  async load(runId: string): Promise<TaskRun | null> {
    const row = this.sqlite.db
      .prepare("SELECT data FROM run_checkpoints WHERE id = ?")
      .get(runId) as { data: string } | undefined;

    return row ? (JSON.parse(row.data) as TaskRun) : null;
  }

  async listByStatus(status: TaskStatus): Promise<TaskRun[]> {
    const rows = this.sqlite.db
      .prepare("SELECT data FROM run_checkpoints WHERE status = ? ORDER BY updated_at DESC")
      .all(status) as Array<{ data: string }>;

    return rows.map((r) => JSON.parse(r.data) as TaskRun);
  }

  async listAll(): Promise<TaskRun[]> {
    const rows = this.sqlite.db
      .prepare("SELECT data FROM run_checkpoints ORDER BY updated_at DESC")
      .all() as Array<{ data: string }>;

    return rows.map((r) => JSON.parse(r.data) as TaskRun);
  }

  async delete(runId: string): Promise<boolean> {
    const result = this.sqlite.db
      .prepare("DELETE FROM run_checkpoints WHERE id = ?")
      .run(runId);

    return result.changes > 0;
  }
}
