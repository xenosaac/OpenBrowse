import type Database from "better-sqlite3";
import type { SqliteDatabase } from "./SqliteDatabase.js";
import type { StandaloneTab, StandaloneTabStore } from "./MemoryStore.js";

export class SqliteStandaloneTabStore implements StandaloneTabStore {
  private readonly stmtSave: Database.Statement;
  private readonly stmtGet: Database.Statement;
  private readonly stmtListAll: Database.Statement;
  private readonly stmtDelete: Database.Statement;

  constructor(private readonly sqlite: SqliteDatabase) {
    this.stmtSave = sqlite.db.prepare(
      `INSERT OR REPLACE INTO standalone_tabs (id, url, profile_id, created_at) VALUES (?, ?, ?, ?)`
    );
    this.stmtGet = sqlite.db.prepare("SELECT * FROM standalone_tabs WHERE id = ?");
    this.stmtListAll = sqlite.db.prepare("SELECT * FROM standalone_tabs ORDER BY created_at ASC");
    this.stmtDelete = sqlite.db.prepare("DELETE FROM standalone_tabs WHERE id = ?");
  }

  async save(tab: StandaloneTab): Promise<void> {
    this.stmtSave.run(tab.id, tab.url, tab.profileId ?? null, tab.createdAt);
  }

  async get(id: string): Promise<StandaloneTab | null> {
    const row = this.stmtGet.get(id) as TabRow | undefined;
    return row ? rowToTab(row) : null;
  }

  async listAll(): Promise<StandaloneTab[]> {
    return (this.stmtListAll.all() as TabRow[]).map(rowToTab);
  }

  async delete(id: string): Promise<boolean> {
    return this.stmtDelete.run(id).changes > 0;
  }
}

interface TabRow {
  id: string;
  url: string;
  profile_id: string | null;
  created_at: string;
}

function rowToTab(row: TabRow): StandaloneTab {
  return {
    id: row.id,
    url: row.url,
    profileId: row.profile_id ?? undefined,
    createdAt: row.created_at,
  };
}
