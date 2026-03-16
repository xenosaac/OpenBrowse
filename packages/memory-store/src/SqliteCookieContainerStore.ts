import type Database from "better-sqlite3";
import type { SqliteDatabase } from "./SqliteDatabase.js";
import type { CookieContainer, CookieContainerStore } from "./MemoryStore.js";

export class SqliteCookieContainerStore implements CookieContainerStore {
  private readonly stmtCreate: Database.Statement;
  private readonly stmtUpdate: Database.Statement;
  private readonly stmtGet: Database.Statement;
  private readonly stmtListAll: Database.Statement;
  private readonly stmtListByProfile: Database.Statement;
  private readonly stmtDelete: Database.Statement;

  constructor(private readonly sqlite: SqliteDatabase) {
    this.stmtCreate = sqlite.db.prepare(
      `INSERT OR REPLACE INTO cookie_containers (id, label, color, icon, profile_id, partition_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    this.stmtUpdate = sqlite.db.prepare(
      `UPDATE cookie_containers SET label = COALESCE(?, label), color = COALESCE(?, color), icon = COALESCE(?, icon) WHERE id = ?`
    );
    this.stmtGet = sqlite.db.prepare("SELECT * FROM cookie_containers WHERE id = ?");
    this.stmtListAll = sqlite.db.prepare("SELECT * FROM cookie_containers ORDER BY created_at ASC");
    this.stmtListByProfile = sqlite.db.prepare(
      "SELECT * FROM cookie_containers WHERE profile_id = ? ORDER BY created_at ASC"
    );
    this.stmtDelete = sqlite.db.prepare("DELETE FROM cookie_containers WHERE id = ?");
  }

  async create(container: CookieContainer): Promise<void> {
    this.stmtCreate.run(
      container.id, container.label, container.color ?? null,
      container.icon ?? null, container.profileId ?? null,
      container.partitionKey, container.createdAt
    );
  }

  async update(id: string, fields: Partial<Pick<CookieContainer, "label" | "color" | "icon">>): Promise<void> {
    this.stmtUpdate.run(fields.label ?? null, fields.color ?? null, fields.icon ?? null, id);
  }

  async get(id: string): Promise<CookieContainer | null> {
    const row = this.stmtGet.get(id) as ContainerRow | undefined;
    return row ? rowToContainer(row) : null;
  }

  async listAll(): Promise<CookieContainer[]> {
    return (this.stmtListAll.all() as ContainerRow[]).map(rowToContainer);
  }

  async listByProfile(profileId: string): Promise<CookieContainer[]> {
    return (this.stmtListByProfile.all(profileId) as ContainerRow[]).map(rowToContainer);
  }

  async delete(id: string): Promise<boolean> {
    return this.stmtDelete.run(id).changes > 0;
  }
}

interface ContainerRow {
  id: string;
  label: string;
  color: string | null;
  icon: string | null;
  profile_id: string | null;
  partition_key: string;
  created_at: string;
}

function rowToContainer(row: ContainerRow): CookieContainer {
  return {
    id: row.id,
    label: row.label,
    color: row.color ?? undefined,
    icon: row.icon ?? undefined,
    profileId: row.profile_id ?? undefined,
    partitionKey: row.partition_key,
    createdAt: row.created_at,
  };
}
