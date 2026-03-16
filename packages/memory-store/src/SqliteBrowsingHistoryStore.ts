import type Database from "better-sqlite3";
import type { SqliteDatabase } from "./SqliteDatabase.js";
import type { BrowsingHistoryEntry, BrowsingHistoryStore } from "./MemoryStore.js";

export class SqliteBrowsingHistoryStore implements BrowsingHistoryStore {
  private readonly stmtRecord: Database.Statement;
  private readonly stmtListRecent: Database.Statement;
  private readonly stmtListByDateRange: Database.Statement;
  private readonly stmtSearch: Database.Statement;
  private readonly stmtDeleteByDateRange: Database.Statement;
  private readonly stmtDeleteAll: Database.Statement;

  constructor(private readonly sqlite: SqliteDatabase) {
    this.stmtRecord = sqlite.db.prepare(
      `INSERT INTO browsing_history (id, url, title, profile_id, run_id, visited_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    this.stmtListRecent = sqlite.db.prepare(
      "SELECT * FROM browsing_history ORDER BY visited_at DESC LIMIT ?"
    );
    this.stmtListByDateRange = sqlite.db.prepare(
      "SELECT * FROM browsing_history WHERE visited_at >= ? AND visited_at <= ? ORDER BY visited_at DESC"
    );
    this.stmtSearch = sqlite.db.prepare(
      "SELECT * FROM browsing_history WHERE title LIKE ? OR url LIKE ? ORDER BY visited_at DESC"
    );
    this.stmtDeleteByDateRange = sqlite.db.prepare(
      "DELETE FROM browsing_history WHERE visited_at >= ? AND visited_at <= ?"
    );
    this.stmtDeleteAll = sqlite.db.prepare("DELETE FROM browsing_history");
  }

  async record(entry: BrowsingHistoryEntry): Promise<void> {
    this.stmtRecord.run(
      entry.id, entry.url, entry.title,
      entry.profileId ?? null, entry.runId ?? null, entry.visitedAt
    );
  }

  async listRecent(limit: number): Promise<BrowsingHistoryEntry[]> {
    return (this.stmtListRecent.all(limit) as HistoryRow[]).map(rowToEntry);
  }

  async listByDateRange(from: string, to: string): Promise<BrowsingHistoryEntry[]> {
    return (this.stmtListByDateRange.all(from, to) as HistoryRow[]).map(rowToEntry);
  }

  async search(query: string): Promise<BrowsingHistoryEntry[]> {
    const like = `%${query}%`;
    return (this.stmtSearch.all(like, like) as HistoryRow[]).map(rowToEntry);
  }

  async deleteByDateRange(from: string, to: string): Promise<number> {
    return this.stmtDeleteByDateRange.run(from, to).changes;
  }

  async deleteAll(): Promise<number> {
    return this.stmtDeleteAll.run().changes;
  }
}

interface HistoryRow {
  id: string;
  url: string;
  title: string;
  profile_id: string | null;
  run_id: string | null;
  visited_at: string;
}

function rowToEntry(row: HistoryRow): BrowsingHistoryEntry {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    profileId: row.profile_id ?? undefined,
    runId: row.run_id ?? undefined,
    visitedAt: row.visited_at,
  };
}
