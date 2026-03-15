import type { TaskRun, TaskStatus } from "@openbrowse/contracts";
import type Database from "better-sqlite3";
import type { SqliteDatabase } from "./SqliteDatabase.js";
import type { RunCheckpointStore } from "./MemoryStore.js";

export class SqliteRunCheckpointStore implements RunCheckpointStore {
  private readonly stmtSave: Database.Statement;
  private readonly stmtLoad: Database.Statement;
  private readonly stmtListByStatus: Database.Statement;
  private readonly stmtListAll: Database.Statement;
  private readonly stmtDelete: Database.Statement;

  constructor(private readonly sqlite: SqliteDatabase) {
    this.stmtSave = sqlite.db.prepare(
      `INSERT OR REPLACE INTO run_checkpoints (id, status, goal, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    this.stmtLoad = sqlite.db.prepare(
      "SELECT data FROM run_checkpoints WHERE id = ?"
    );
    this.stmtListByStatus = sqlite.db.prepare(
      "SELECT data FROM run_checkpoints WHERE status = ? ORDER BY updated_at DESC"
    );
    this.stmtListAll = sqlite.db.prepare(
      "SELECT data FROM run_checkpoints ORDER BY updated_at DESC"
    );
    this.stmtDelete = sqlite.db.prepare(
      "DELETE FROM run_checkpoints WHERE id = ?"
    );
  }

  async save(run: TaskRun): Promise<void> {
    this.stmtSave.run(run.id, run.status, run.goal, JSON.stringify(run), run.createdAt, run.updatedAt);
  }

  async load(runId: string): Promise<TaskRun | null> {
    const row = this.stmtLoad.get(runId) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as TaskRun) : null;
  }

  async listByStatus(status: TaskStatus): Promise<TaskRun[]> {
    const rows = this.stmtListByStatus.all(status) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as TaskRun);
  }

  async listAll(): Promise<TaskRun[]> {
    const rows = this.stmtListAll.all() as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as TaskRun);
  }

  async delete(runId: string): Promise<boolean> {
    const result = this.stmtDelete.run(runId);
    return result.changes > 0;
  }
}
