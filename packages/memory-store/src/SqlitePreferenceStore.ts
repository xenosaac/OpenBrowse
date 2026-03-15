import type { UserPreference } from "@openbrowse/contracts";
import type Database from "better-sqlite3";
import type { SqliteDatabase } from "./SqliteDatabase.js";
import type { PreferenceStore } from "./MemoryStore.js";

interface PreferenceRow {
  id: string;
  namespace: string;
  key: string;
  value: string;
  captured_at: string;
}

function rowToPreference(r: PreferenceRow): UserPreference {
  return {
    id: r.id,
    namespace: r.namespace,
    key: r.key,
    value: r.value,
    capturedAt: r.captured_at
  };
}

export class SqlitePreferenceStore implements PreferenceStore {
  private readonly stmtUpsert: Database.Statement;
  private readonly stmtGet: Database.Statement;
  private readonly stmtList: Database.Statement;
  private readonly stmtDelete: Database.Statement;
  private readonly stmtDeleteByKey: Database.Statement;

  constructor(private readonly sqlite: SqliteDatabase) {
    this.stmtUpsert = sqlite.db.prepare(
      `INSERT INTO user_preferences (id, namespace, key, value, captured_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(namespace, key) DO UPDATE SET
         id = excluded.id,
         value = excluded.value,
         captured_at = excluded.captured_at`
    );
    this.stmtGet = sqlite.db.prepare(
      "SELECT id, namespace, key, value, captured_at FROM user_preferences WHERE namespace = ? AND key = ?"
    );
    this.stmtList = sqlite.db.prepare(
      "SELECT id, namespace, key, value, captured_at FROM user_preferences WHERE namespace = ?"
    );
    this.stmtDelete = sqlite.db.prepare(
      "DELETE FROM user_preferences WHERE id = ?"
    );
    this.stmtDeleteByKey = sqlite.db.prepare(
      "DELETE FROM user_preferences WHERE namespace = ? AND key = ?"
    );
  }

  async upsert(preference: UserPreference): Promise<void> {
    this.stmtUpsert.run(
      preference.id,
      preference.namespace,
      preference.key,
      preference.value,
      preference.capturedAt
    );
  }

  async get(namespace: string, key: string): Promise<UserPreference | null> {
    const row = this.stmtGet.get(namespace, key) as PreferenceRow | undefined;
    return row ? rowToPreference(row) : null;
  }

  async list(namespace: string): Promise<UserPreference[]> {
    const rows = this.stmtList.all(namespace) as PreferenceRow[];
    return rows.map(rowToPreference);
  }

  async delete(id: string): Promise<boolean> {
    const result = this.stmtDelete.run(id);
    return result.changes > 0;
  }

  async deleteByKey(namespace: string, key: string): Promise<boolean> {
    const result = this.stmtDeleteByKey.run(namespace, key);
    return result.changes > 0;
  }

  async saveNamespaceSettings(namespace: string, entries: Array<{ key: string; value: string }>): Promise<void> {
    const now = new Date().toISOString();
    this.sqlite.transaction(() => {
      for (const { key, value } of entries) {
        const trimmed = value.trim();
        if (!trimmed) {
          this.stmtDeleteByKey.run(namespace, key);
        } else {
          this.stmtUpsert.run(`pref_${key}`, namespace, key, trimmed, now);
        }
      }
    });
  }
}
