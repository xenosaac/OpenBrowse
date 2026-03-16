import type Database from "better-sqlite3";
import type { SqliteDatabase } from "./SqliteDatabase.js";
import type { SessionTrackingStore, TrackedBrowserSession } from "./MemoryStore.js";

export class SqliteSessionTrackingStore implements SessionTrackingStore {
  private readonly stmtCreate: Database.Statement;
  private readonly stmtTerminate: Database.Statement;
  private readonly stmtGet: Database.Statement;
  private readonly stmtListByRun: Database.Statement;
  private readonly stmtListActive: Database.Statement;
  private readonly stmtListActiveByRun: Database.Statement;
  private readonly stmtDeleteByRun: Database.Statement;

  constructor(private readonly sqlite: SqliteDatabase) {
    this.stmtCreate = sqlite.db.prepare(
      `INSERT OR REPLACE INTO browser_sessions (id, run_id, profile_id, state, created_at, terminated_at, termination_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    this.stmtTerminate = sqlite.db.prepare(
      `UPDATE browser_sessions SET state = 'terminated', terminated_at = ?, termination_reason = ? WHERE id = ?`
    );
    this.stmtGet = sqlite.db.prepare("SELECT * FROM browser_sessions WHERE id = ?");
    this.stmtListByRun = sqlite.db.prepare("SELECT * FROM browser_sessions WHERE run_id = ?");
    this.stmtListActive = sqlite.db.prepare("SELECT * FROM browser_sessions WHERE state != 'terminated'");
    this.stmtListActiveByRun = sqlite.db.prepare(
      "SELECT * FROM browser_sessions WHERE run_id = ? AND state != 'terminated'"
    );
    this.stmtDeleteByRun = sqlite.db.prepare("DELETE FROM browser_sessions WHERE run_id = ?");
  }

  async create(session: TrackedBrowserSession): Promise<void> {
    this.stmtCreate.run(
      session.id, session.runId ?? null, session.profileId ?? null,
      session.state, session.createdAt,
      session.terminatedAt ?? null, session.terminationReason ?? null
    );
  }

  async terminate(sessionId: string, reason: string): Promise<void> {
    this.stmtTerminate.run(new Date().toISOString(), reason, sessionId);
  }

  async get(sessionId: string): Promise<TrackedBrowserSession | null> {
    const row = this.stmtGet.get(sessionId) as SessionRow | undefined;
    return row ? rowToSession(row) : null;
  }

  async listByRun(runId: string): Promise<TrackedBrowserSession[]> {
    return (this.stmtListByRun.all(runId) as SessionRow[]).map(rowToSession);
  }

  async listActive(): Promise<TrackedBrowserSession[]> {
    return (this.stmtListActive.all() as SessionRow[]).map(rowToSession);
  }

  async listActiveByRun(runId: string): Promise<TrackedBrowserSession[]> {
    return (this.stmtListActiveByRun.all(runId) as SessionRow[]).map(rowToSession);
  }

  async deleteByRun(runId: string): Promise<number> {
    return this.stmtDeleteByRun.run(runId).changes;
  }
}

interface SessionRow {
  id: string;
  run_id: string | null;
  profile_id: string | null;
  state: string;
  created_at: string;
  terminated_at: string | null;
  termination_reason: string | null;
}

function rowToSession(row: SessionRow): TrackedBrowserSession {
  return {
    id: row.id,
    runId: row.run_id ?? undefined,
    profileId: row.profile_id ?? undefined,
    state: row.state,
    createdAt: row.created_at,
    terminatedAt: row.terminated_at ?? undefined,
    terminationReason: row.termination_reason ?? undefined,
  };
}
