import type Database from "better-sqlite3";
import type { SqliteDatabase } from "./SqliteDatabase.js";
import type { ChatBridgeStateEntry, ChatBridgeStateStore } from "./MemoryStore.js";

export class SqliteChatBridgeStateStore implements ChatBridgeStateStore {
  private readonly stmtGet: Database.Statement;
  private readonly stmtSet: Database.Statement;
  private readonly stmtDelete: Database.Statement;
  private readonly stmtListAll: Database.Statement;

  constructor(private readonly sqlite: SqliteDatabase) {
    this.stmtGet = sqlite.db.prepare("SELECT value FROM chat_bridge_state WHERE key = ?");
    this.stmtSet = sqlite.db.prepare(
      `INSERT OR REPLACE INTO chat_bridge_state (key, value, updated_at) VALUES (?, ?, ?)`
    );
    this.stmtDelete = sqlite.db.prepare("DELETE FROM chat_bridge_state WHERE key = ?");
    this.stmtListAll = sqlite.db.prepare("SELECT * FROM chat_bridge_state ORDER BY key ASC");
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const row = this.stmtGet.get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : null;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.stmtSet.run(key, JSON.stringify(value), new Date().toISOString());
  }

  async delete(key: string): Promise<boolean> {
    return this.stmtDelete.run(key).changes > 0;
  }

  async listAll(): Promise<ChatBridgeStateEntry[]> {
    return (this.stmtListAll.all() as StateRow[]).map((row) => ({
      key: row.key,
      value: JSON.parse(row.value),
      updatedAt: row.updated_at,
    }));
  }
}

interface StateRow {
  key: string;
  value: string;
  updated_at: string;
}
