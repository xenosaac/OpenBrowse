import type Database from "better-sqlite3";
import type { SqliteDatabase } from "./SqliteDatabase.js";
import type { Bookmark, BookmarkStore } from "./MemoryStore.js";

export class SqliteBookmarkStore implements BookmarkStore {
  private readonly stmtCreate: Database.Statement;
  private readonly stmtUpdate: Database.Statement;
  private readonly stmtGet: Database.Statement;
  private readonly stmtGetByUrl: Database.Statement;
  private readonly stmtListByFolder: Database.Statement;
  private readonly stmtListAll: Database.Statement;
  private readonly stmtSearch: Database.Statement;
  private readonly stmtDelete: Database.Statement;

  constructor(private readonly sqlite: SqliteDatabase) {
    this.stmtCreate = sqlite.db.prepare(
      `INSERT OR REPLACE INTO bookmarks (id, url, title, folder, tags, favicon_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    this.stmtUpdate = sqlite.db.prepare(
      `UPDATE bookmarks SET url = COALESCE(?, url), title = COALESCE(?, title),
       folder = COALESCE(?, folder), tags = COALESCE(?, tags),
       favicon_url = COALESCE(?, favicon_url) WHERE id = ?`
    );
    this.stmtGet = sqlite.db.prepare("SELECT * FROM bookmarks WHERE id = ?");
    this.stmtGetByUrl = sqlite.db.prepare("SELECT * FROM bookmarks WHERE url = ? LIMIT 1");
    this.stmtListByFolder = sqlite.db.prepare("SELECT * FROM bookmarks WHERE folder = ? ORDER BY created_at DESC");
    this.stmtListAll = sqlite.db.prepare("SELECT * FROM bookmarks ORDER BY created_at DESC");
    this.stmtSearch = sqlite.db.prepare(
      "SELECT * FROM bookmarks WHERE title LIKE ? OR url LIKE ? ORDER BY created_at DESC"
    );
    this.stmtDelete = sqlite.db.prepare("DELETE FROM bookmarks WHERE id = ?");
  }

  async create(bookmark: Bookmark): Promise<void> {
    this.stmtCreate.run(
      bookmark.id, bookmark.url, bookmark.title,
      bookmark.folder ?? null, JSON.stringify(bookmark.tags),
      bookmark.faviconUrl ?? null, bookmark.createdAt
    );
  }

  async update(id: string, fields: Partial<Pick<Bookmark, "title" | "url" | "folder" | "tags" | "faviconUrl">>): Promise<void> {
    this.stmtUpdate.run(
      fields.url ?? null, fields.title ?? null,
      fields.folder ?? null, fields.tags ? JSON.stringify(fields.tags) : null,
      fields.faviconUrl ?? null, id
    );
  }

  async get(id: string): Promise<Bookmark | null> {
    const row = this.stmtGet.get(id) as BookmarkRow | undefined;
    return row ? rowToBookmark(row) : null;
  }

  async getByUrl(url: string): Promise<Bookmark | null> {
    const row = this.stmtGetByUrl.get(url) as BookmarkRow | undefined;
    return row ? rowToBookmark(row) : null;
  }

  async listByFolder(folder: string): Promise<Bookmark[]> {
    return (this.stmtListByFolder.all(folder) as BookmarkRow[]).map(rowToBookmark);
  }

  async listAll(): Promise<Bookmark[]> {
    return (this.stmtListAll.all() as BookmarkRow[]).map(rowToBookmark);
  }

  async search(query: string): Promise<Bookmark[]> {
    const like = `%${query}%`;
    return (this.stmtSearch.all(like, like) as BookmarkRow[]).map(rowToBookmark);
  }

  async delete(id: string): Promise<boolean> {
    return this.stmtDelete.run(id).changes > 0;
  }
}

interface BookmarkRow {
  id: string;
  url: string;
  title: string;
  folder: string | null;
  tags: string;
  favicon_url: string | null;
  created_at: string;
}

function rowToBookmark(row: BookmarkRow): Bookmark {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    folder: row.folder ?? undefined,
    tags: JSON.parse(row.tags) as string[],
    faviconUrl: row.favicon_url ?? undefined,
    createdAt: row.created_at,
  };
}
