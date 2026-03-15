import type { WorkflowEvent } from "@openbrowse/contracts";
import type Database from "better-sqlite3";
import type { SqliteDatabase } from "./SqliteDatabase.js";
import type { WorkflowLogStore } from "./MemoryStore.js";

interface WorkflowEventRow {
  id: string;
  run_id: string;
  type: string;
  summary: string;
  created_at: string;
  payload: string;
}

function rowToEvent(r: WorkflowEventRow): WorkflowEvent {
  return {
    id: r.id,
    runId: r.run_id,
    type: r.type as WorkflowEvent["type"],
    summary: r.summary,
    createdAt: r.created_at,
    payload: JSON.parse(r.payload) as Record<string, string>
  };
}

export class SqliteWorkflowLogStore implements WorkflowLogStore {
  private readonly stmtAppend: Database.Statement;
  private readonly stmtListByRun: Database.Statement;
  private readonly stmtListRecent: Database.Statement;
  private readonly stmtCountByRun: Database.Statement;
  private readonly stmtDeleteByRun: Database.Statement;

  constructor(private readonly sqlite: SqliteDatabase) {
    this.stmtAppend = sqlite.db.prepare(
      `INSERT OR IGNORE INTO workflow_events (id, run_id, type, summary, created_at, payload)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    this.stmtListByRun = sqlite.db.prepare(
      "SELECT id, run_id, type, summary, created_at, payload FROM workflow_events WHERE run_id = ? ORDER BY created_at, id"
    );
    this.stmtListRecent = sqlite.db.prepare(
      "SELECT id, run_id, type, summary, created_at, payload FROM workflow_events ORDER BY created_at DESC, id DESC LIMIT ?"
    );
    this.stmtCountByRun = sqlite.db.prepare(
      "SELECT COUNT(*) as cnt FROM workflow_events WHERE run_id = ?"
    );
    this.stmtDeleteByRun = sqlite.db.prepare(
      "DELETE FROM workflow_events WHERE run_id = ?"
    );
  }

  async append(event: WorkflowEvent): Promise<void> {
    this.stmtAppend.run(
      event.id,
      event.runId,
      event.type,
      event.summary,
      event.createdAt,
      JSON.stringify(event.payload)
    );
  }

  async listByRun(runId: string): Promise<WorkflowEvent[]> {
    const rows = this.stmtListByRun.all(runId) as WorkflowEventRow[];
    return rows.map(rowToEvent);
  }

  async listRecent(limit: number): Promise<WorkflowEvent[]> {
    const rows = this.stmtListRecent.all(limit) as WorkflowEventRow[];
    return rows.map(rowToEvent);
  }

  async countByRun(runId: string): Promise<number> {
    const row = this.stmtCountByRun.get(runId) as { cnt: number };
    return row.cnt;
  }

  async deleteByRun(runId: string): Promise<number> {
    const result = this.stmtDeleteByRun.run(runId);
    return result.changes;
  }
}
