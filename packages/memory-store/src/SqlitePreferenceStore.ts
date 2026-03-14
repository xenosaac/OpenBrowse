import type { UserPreference } from "@openbrowse/contracts";
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
  constructor(private readonly sqlite: SqliteDatabase) {}

  async upsert(preference: UserPreference): Promise<void> {
    this.sqlite.db
      .prepare(
        `INSERT INTO user_preferences (id, namespace, key, value, captured_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(namespace, key) DO UPDATE SET
           id = excluded.id,
           value = excluded.value,
           captured_at = excluded.captured_at`
      )
      .run(
        preference.id,
        preference.namespace,
        preference.key,
        preference.value,
        preference.capturedAt
      );
  }

  async get(namespace: string, key: string): Promise<UserPreference | null> {
    const row = this.sqlite.db
      .prepare(
        "SELECT id, namespace, key, value, captured_at FROM user_preferences WHERE namespace = ? AND key = ?"
      )
      .get(namespace, key) as PreferenceRow | undefined;

    return row ? rowToPreference(row) : null;
  }

  async list(namespace: string): Promise<UserPreference[]> {
    const rows = this.sqlite.db
      .prepare(
        "SELECT id, namespace, key, value, captured_at FROM user_preferences WHERE namespace = ?"
      )
      .all(namespace) as PreferenceRow[];

    return rows.map(rowToPreference);
  }

  async delete(id: string): Promise<boolean> {
    const result = this.sqlite.db
      .prepare("DELETE FROM user_preferences WHERE id = ?")
      .run(id);

    return result.changes > 0;
  }
}
