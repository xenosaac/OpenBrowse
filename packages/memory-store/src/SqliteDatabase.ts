import Database from "better-sqlite3";
import { DDL, MIGRATIONS, SCHEMA_VERSION } from "./schema.js";

export class SqliteDatabase {
  readonly db: Database.Database;

  constructor(filePath: string) {
    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.migrate();
  }

  private migrate(): void {
    const initTransaction = this.db.transaction(() => {
      this.db.exec(DDL);
    });

    // Check if schema_meta exists before trying to read version
    const hasMeta = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta'")
      .get() as { name: string } | undefined;

    if (!hasMeta) {
      // Fresh database — run full DDL and stamp version
      initTransaction();
      this.db
        .prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('version', ?)")
        .run(String(SCHEMA_VERSION));
      return;
    }

    const row = this.db
      .prepare("SELECT value FROM schema_meta WHERE key = 'version'")
      .get() as { value: string } | undefined;

    const currentVersion = row ? Number(row.value) : 0;

    if (currentVersion === 0) {
      // Existing DB with schema_meta table but no version — treat as v1, run DDL then migrate
      initTransaction();
      this.runMigrations(1);
    } else if (currentVersion < SCHEMA_VERSION) {
      this.runMigrations(currentVersion);
    } else {
      // Current version — ensure DDL is up to date (IF NOT EXISTS is safe)
      initTransaction();
    }
  }

  private runMigrations(fromVersion: number): void {
    const migrationTransaction = this.db.transaction(() => {
      for (let v = fromVersion + 1; v <= SCHEMA_VERSION; v++) {
        const migrateFn = MIGRATIONS[v];
        if (migrateFn) {
          migrateFn(this.db);
        }
      }
      this.db
        .prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('version', ?)")
        .run(String(SCHEMA_VERSION));
    });

    migrationTransaction();
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  close(): void {
    this.db.close();
  }
}
