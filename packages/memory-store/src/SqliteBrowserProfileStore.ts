import type Database from "better-sqlite3";
import type { SqliteDatabase } from "./SqliteDatabase.js";
import type { BrowserProfileStore, StoredBrowserProfile } from "./MemoryStore.js";

export class SqliteBrowserProfileStore implements BrowserProfileStore {
  private readonly stmtSave: Database.Statement;
  private readonly stmtGet: Database.Statement;
  private readonly stmtListAll: Database.Statement;
  private readonly stmtDelete: Database.Statement;

  constructor(private readonly sqlite: SqliteDatabase) {
    this.stmtSave = sqlite.db.prepare(
      `INSERT OR REPLACE INTO browser_profiles (id, label, storage_path, is_managed, created_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    this.stmtGet = sqlite.db.prepare("SELECT * FROM browser_profiles WHERE id = ?");
    this.stmtListAll = sqlite.db.prepare("SELECT * FROM browser_profiles ORDER BY created_at ASC");
    this.stmtDelete = sqlite.db.prepare("DELETE FROM browser_profiles WHERE id = ?");
  }

  async save(profile: StoredBrowserProfile): Promise<void> {
    this.stmtSave.run(profile.id, profile.label, profile.storagePath, profile.isManaged ? 1 : 0, profile.createdAt);
  }

  async get(id: string): Promise<StoredBrowserProfile | null> {
    const row = this.stmtGet.get(id) as ProfileRow | undefined;
    return row ? rowToProfile(row) : null;
  }

  async listAll(): Promise<StoredBrowserProfile[]> {
    return (this.stmtListAll.all() as ProfileRow[]).map(rowToProfile);
  }

  async delete(id: string): Promise<boolean> {
    return this.stmtDelete.run(id).changes > 0;
  }
}

interface ProfileRow {
  id: string;
  label: string;
  storage_path: string;
  is_managed: number;
  created_at: string;
}

function rowToProfile(row: ProfileRow): StoredBrowserProfile {
  return {
    id: row.id,
    label: row.label,
    storagePath: row.storage_path,
    isManaged: row.is_managed === 1,
    createdAt: row.created_at,
  };
}
