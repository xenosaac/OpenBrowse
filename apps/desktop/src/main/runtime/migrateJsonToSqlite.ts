import fs from "node:fs/promises";
import type { RuntimeServices } from "@openbrowse/runtime-core";

interface MigrationPaths {
  profilesJsonPath: string;
  standaloneTabsJsonPath: string;
  telegramStateJsonPath: string;
}

export async function migrateJsonToSqlite(
  services: RuntimeServices,
  paths: MigrationPaths
): Promise<void> {
  await migrateProfiles(services, paths.profilesJsonPath);
  await migrateStandaloneTabs(services, paths.standaloneTabsJsonPath);
  await migrateTelegramState(services, paths.telegramStateJsonPath);
}

async function migrateProfiles(services: RuntimeServices, jsonPath: string): Promise<void> {
  const store = services.browserProfileStore;
  if (!store) return;

  try {
    const existing = await store.listAll();
    if (existing.length > 0) return;

    const raw = await fs.readFile(jsonPath, "utf-8");
    const profiles = JSON.parse(raw) as Array<{
      id: string;
      label: string;
      storagePath: string;
      isManaged: boolean;
    }>;

    let mtime: string;
    try {
      const stat = await fs.stat(jsonPath);
      mtime = stat.mtime.toISOString();
    } catch {
      mtime = new Date().toISOString();
    }

    for (const profile of profiles) {
      await store.save({
        id: profile.id,
        label: profile.label,
        storagePath: profile.storagePath,
        isManaged: profile.isManaged,
        createdAt: mtime
      });
    }
    console.log(`[migration] Migrated ${profiles.length} browser profile(s) from JSON to SQLite`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    console.warn("[migration] Failed to migrate profiles:", err);
  }
}

async function migrateStandaloneTabs(services: RuntimeServices, jsonPath: string): Promise<void> {
  const store = services.standaloneTabStore;
  if (!store) return;

  try {
    const existing = await store.listAll();
    if (existing.length > 0) return;

    const raw = await fs.readFile(jsonPath, "utf-8");
    const tabs = JSON.parse(raw) as Array<{
      id: string;
      url: string;
      profileId?: string;
    }>;

    let mtime: string;
    try {
      const stat = await fs.stat(jsonPath);
      mtime = stat.mtime.toISOString();
    } catch {
      mtime = new Date().toISOString();
    }

    for (const tab of tabs) {
      await store.save({
        id: tab.id,
        url: tab.url,
        profileId: tab.profileId,
        createdAt: mtime
      });
    }
    console.log(`[migration] Migrated ${tabs.length} standalone tab(s) from JSON to SQLite`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    console.warn("[migration] Failed to migrate standalone tabs:", err);
  }
}

async function migrateTelegramState(services: RuntimeServices, jsonPath: string): Promise<void> {
  const store = services.chatBridgeStateStore;
  if (!store) return;

  try {
    const existing = await store.listAll();
    if (existing.length > 0) return;

    const raw = await fs.readFile(jsonPath, "utf-8");
    const state = JSON.parse(raw) as Record<string, unknown>;

    let count = 0;
    for (const [key, value] of Object.entries(state)) {
      await store.set(key, value);
      count++;
    }
    console.log(`[migration] Migrated ${count} chat bridge state key(s) from JSON to SQLite`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    console.warn("[migration] Failed to migrate telegram state:", err);
  }
}
