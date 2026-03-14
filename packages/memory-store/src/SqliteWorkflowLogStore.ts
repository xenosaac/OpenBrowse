import type { WorkflowEvent } from "@openbrowse/contracts";
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
  constructor(private readonly sqlite: SqliteDatabase) {}

  async append(event: WorkflowEvent): Promise<void> {
    this.sqlite.db
      .prepare(
        `INSERT OR IGNORE INTO workflow_events (id, run_id, type, summary, created_at, payload)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.id,
        event.runId,
        event.type,
        event.summary,
        event.createdAt,
        JSON.stringify(event.payload)
      );
  }

  async listByRun(runId: string): Promise<WorkflowEvent[]> {
    const rows = this.sqlite.db
      .prepare(
        "SELECT id, run_id, type, summary, created_at, payload FROM workflow_events WHERE run_id = ? ORDER BY created_at, id"
      )
      .all(runId) as WorkflowEventRow[];

    return rows.map(rowToEvent);
  }

  async listRecent(limit: number): Promise<WorkflowEvent[]> {
    const rows = this.sqlite.db
      .prepare(
        "SELECT id, run_id, type, summary, created_at, payload FROM workflow_events ORDER BY created_at DESC, id DESC LIMIT ?"
      )
      .all(limit) as WorkflowEventRow[];

    return rows.map(rowToEvent);
  }

  async countByRun(runId: string): Promise<number> {
    const row = this.sqlite.db
      .prepare("SELECT COUNT(*) as cnt FROM workflow_events WHERE run_id = ?")
      .get(runId) as { cnt: number };

    return row.cnt;
  }

  async deleteByRun(runId: string): Promise<number> {
    const result = this.sqlite.db
      .prepare("DELETE FROM workflow_events WHERE run_id = ?")
      .run(runId);

    return result.changes;
  }
}
