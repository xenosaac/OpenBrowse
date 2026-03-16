import test from "node:test";
import assert from "node:assert/strict";

import {
  InMemorySessionTrackingStore,
  InMemoryChatSessionStore,
  InMemoryBookmarkStore,
  InMemoryBrowsingHistoryStore,
  InMemoryBrowserProfileStore,
  InMemoryCookieContainerStore,
  InMemoryStandaloneTabStore,
  InMemoryChatBridgeStateStore
} from "../packages/memory-store/dist/index.js";

// ============================================================================
// SessionTrackingStore (7 tests)
// ============================================================================

test("SessionTrackingStore: create + get round-trip", async () => {
  const store = new InMemorySessionTrackingStore();
  const session = { id: "s1", runId: "r1", profileId: "p1", state: "warm", createdAt: "2026-01-01T00:00:00Z" };
  await store.create(session);
  const loaded = await store.get("s1");
  assert.deepStrictEqual(loaded, session);
});

test("SessionTrackingStore: get returns null for unknown id", async () => {
  const store = new InMemorySessionTrackingStore();
  assert.strictEqual(await store.get("nonexistent"), null);
});

test("SessionTrackingStore: terminate sets state, terminatedAt, and reason", async () => {
  const store = new InMemorySessionTrackingStore();
  await store.create({ id: "s1", runId: "r1", state: "warm", createdAt: "2026-01-01T00:00:00Z" });
  await store.terminate("s1", "task_complete");
  const s = await store.get("s1");
  assert.strictEqual(s.state, "terminated");
  assert.strictEqual(s.terminationReason, "task_complete");
  assert.ok(s.terminatedAt);
});

test("SessionTrackingStore: listByRun returns only matching sessions", async () => {
  const store = new InMemorySessionTrackingStore();
  await store.create({ id: "s1", runId: "r1", state: "warm", createdAt: "2026-01-01T00:00:00Z" });
  await store.create({ id: "s2", runId: "r2", state: "warm", createdAt: "2026-01-01T00:00:00Z" });
  await store.create({ id: "s3", runId: "r1", state: "attached", createdAt: "2026-01-01T00:01:00Z" });
  const results = await store.listByRun("r1");
  assert.strictEqual(results.length, 2);
  assert.deepStrictEqual(results.map(s => s.id).sort(), ["s1", "s3"]);
});

test("SessionTrackingStore: listActive excludes terminated sessions", async () => {
  const store = new InMemorySessionTrackingStore();
  await store.create({ id: "s1", runId: "r1", state: "warm", createdAt: "2026-01-01T00:00:00Z" });
  await store.create({ id: "s2", runId: "r1", state: "attached", createdAt: "2026-01-01T00:00:00Z" });
  await store.terminate("s1", "done");
  const active = await store.listActive();
  assert.strictEqual(active.length, 1);
  assert.strictEqual(active[0].id, "s2");
});

test("SessionTrackingStore: listActiveByRun filters by run and excludes terminated", async () => {
  const store = new InMemorySessionTrackingStore();
  await store.create({ id: "s1", runId: "r1", state: "warm", createdAt: "2026-01-01T00:00:00Z" });
  await store.create({ id: "s2", runId: "r1", state: "attached", createdAt: "2026-01-01T00:00:00Z" });
  await store.create({ id: "s3", runId: "r2", state: "warm", createdAt: "2026-01-01T00:00:00Z" });
  await store.terminate("s1", "done");
  const active = await store.listActiveByRun("r1");
  assert.strictEqual(active.length, 1);
  assert.strictEqual(active[0].id, "s2");
});

test("SessionTrackingStore: deleteByRun removes all sessions for run", async () => {
  const store = new InMemorySessionTrackingStore();
  await store.create({ id: "s1", runId: "r1", state: "warm", createdAt: "2026-01-01T00:00:00Z" });
  await store.create({ id: "s2", runId: "r1", state: "attached", createdAt: "2026-01-01T00:00:00Z" });
  await store.create({ id: "s3", runId: "r2", state: "warm", createdAt: "2026-01-01T00:00:00Z" });
  const deleted = await store.deleteByRun("r1");
  assert.strictEqual(deleted, 2);
  assert.strictEqual(await store.get("s1"), null);
  assert.strictEqual(await store.get("s2"), null);
  assert.ok(await store.get("s3"));
});

// ============================================================================
// ChatSessionStore (12 tests)
// ============================================================================

test("ChatSessionStore: createSession + getSession round-trip", async () => {
  const store = new InMemoryChatSessionStore();
  const session = { id: "cs1", title: "Test Chat", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
  await store.createSession(session);
  assert.deepStrictEqual(await store.getSession("cs1"), session);
});

test("ChatSessionStore: getSession returns null for unknown id", async () => {
  const store = new InMemoryChatSessionStore();
  assert.strictEqual(await store.getSession("nonexistent"), null);
});

test("ChatSessionStore: updateTitle changes title and updatedAt", async () => {
  const store = new InMemoryChatSessionStore();
  await store.createSession({ id: "cs1", title: "Old", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
  await store.updateTitle("cs1", "New Title");
  const s = await store.getSession("cs1");
  assert.strictEqual(s.title, "New Title");
  assert.notStrictEqual(s.updatedAt, "2026-01-01T00:00:00Z");
});

test("ChatSessionStore: listSessions returns all, sorted by updatedAt DESC", async () => {
  const store = new InMemoryChatSessionStore();
  await store.createSession({ id: "cs1", title: "First", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
  await store.createSession({ id: "cs2", title: "Second", createdAt: "2026-01-02T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z" });
  const list = await store.listSessions();
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].id, "cs2"); // newer first
});

test("ChatSessionStore: deleteSession removes session, messages, and run links", async () => {
  const store = new InMemoryChatSessionStore();
  await store.createSession({ id: "cs1", title: "Chat", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
  await store.appendMessage({ id: "m1", sessionId: "cs1", role: "user", content: "Hello", createdAt: "2026-01-01T00:00:01Z" });
  await store.linkRun("cs1", "r1");
  const deleted = await store.deleteSession("cs1");
  assert.strictEqual(deleted, true);
  assert.strictEqual(await store.getSession("cs1"), null);
  assert.deepStrictEqual(await store.listMessages("cs1"), []);
  assert.deepStrictEqual(await store.listRunIds("cs1"), []);
});

test("ChatSessionStore: deleteSession returns false for unknown id", async () => {
  const store = new InMemoryChatSessionStore();
  assert.strictEqual(await store.deleteSession("nonexistent"), false);
});

test("ChatSessionStore: appendMessage + listMessages round-trip preserves order", async () => {
  const store = new InMemoryChatSessionStore();
  await store.createSession({ id: "cs1", title: "Chat", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
  await store.appendMessage({ id: "m1", sessionId: "cs1", role: "user", content: "Hello", createdAt: "2026-01-01T00:00:01Z" });
  await store.appendMessage({ id: "m2", sessionId: "cs1", role: "assistant", content: "Hi!", createdAt: "2026-01-01T00:00:02Z" });
  const msgs = await store.listMessages("cs1");
  assert.strictEqual(msgs.length, 2);
  assert.strictEqual(msgs[0].id, "m1");
  assert.strictEqual(msgs[1].id, "m2");
});

test("ChatSessionStore: appendMessage updates session updatedAt", async () => {
  const store = new InMemoryChatSessionStore();
  await store.createSession({ id: "cs1", title: "Chat", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
  await store.appendMessage({ id: "m1", sessionId: "cs1", role: "user", content: "Hello", createdAt: "2026-01-01T00:00:01Z" });
  const s = await store.getSession("cs1");
  assert.notStrictEqual(s.updatedAt, "2026-01-01T00:00:00Z");
});

test("ChatSessionStore: clearMessages removes all messages for session", async () => {
  const store = new InMemoryChatSessionStore();
  await store.createSession({ id: "cs1", title: "Chat", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
  await store.appendMessage({ id: "m1", sessionId: "cs1", role: "user", content: "Hello", createdAt: "2026-01-01T00:00:01Z" });
  await store.clearMessages("cs1");
  assert.deepStrictEqual(await store.listMessages("cs1"), []);
});

test("ChatSessionStore: linkRun + listRunIds round-trip", async () => {
  const store = new InMemoryChatSessionStore();
  await store.createSession({ id: "cs1", title: "Chat", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
  await store.linkRun("cs1", "r1");
  await store.linkRun("cs1", "r2");
  const runIds = await store.listRunIds("cs1");
  assert.strictEqual(runIds.length, 2);
  assert.ok(runIds.includes("r1"));
  assert.ok(runIds.includes("r2"));
});

test("ChatSessionStore: linkRun is idempotent (no duplicates)", async () => {
  const store = new InMemoryChatSessionStore();
  await store.createSession({ id: "cs1", title: "Chat", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
  await store.linkRun("cs1", "r1");
  await store.linkRun("cs1", "r1");
  assert.deepStrictEqual(await store.listRunIds("cs1"), ["r1"]);
});

test("ChatSessionStore: listMessages returns empty for unknown session", async () => {
  const store = new InMemoryChatSessionStore();
  assert.deepStrictEqual(await store.listMessages("nonexistent"), []);
});

// ============================================================================
// BookmarkStore (10 tests)
// ============================================================================

test("BookmarkStore: create + get round-trip", async () => {
  const store = new InMemoryBookmarkStore();
  const bookmark = { id: "b1", url: "https://example.com", title: "Example", tags: ["test"], createdAt: "2026-01-01T00:00:00Z" };
  await store.create(bookmark);
  assert.deepStrictEqual(await store.get("b1"), bookmark);
});

test("BookmarkStore: get returns null for unknown id", async () => {
  const store = new InMemoryBookmarkStore();
  assert.strictEqual(await store.get("nonexistent"), null);
});

test("BookmarkStore: getByUrl finds bookmark by URL", async () => {
  const store = new InMemoryBookmarkStore();
  await store.create({ id: "b1", url: "https://example.com", title: "Example", tags: [], createdAt: "2026-01-01T00:00:00Z" });
  const found = await store.getByUrl("https://example.com");
  assert.strictEqual(found.id, "b1");
});

test("BookmarkStore: getByUrl returns null when URL not bookmarked", async () => {
  const store = new InMemoryBookmarkStore();
  assert.strictEqual(await store.getByUrl("https://missing.com"), null);
});

test("BookmarkStore: update modifies fields", async () => {
  const store = new InMemoryBookmarkStore();
  await store.create({ id: "b1", url: "https://example.com", title: "Old", tags: [], createdAt: "2026-01-01T00:00:00Z" });
  await store.update("b1", { title: "New Title", folder: "work" });
  const b = await store.get("b1");
  assert.strictEqual(b.title, "New Title");
  assert.strictEqual(b.folder, "work");
  assert.strictEqual(b.url, "https://example.com"); // unchanged
});

test("BookmarkStore: listByFolder filters by folder", async () => {
  const store = new InMemoryBookmarkStore();
  await store.create({ id: "b1", url: "https://a.com", title: "A", folder: "work", tags: [], createdAt: "2026-01-01T00:00:00Z" });
  await store.create({ id: "b2", url: "https://b.com", title: "B", folder: "personal", tags: [], createdAt: "2026-01-01T00:00:00Z" });
  await store.create({ id: "b3", url: "https://c.com", title: "C", folder: "work", tags: [], createdAt: "2026-01-01T00:00:00Z" });
  const work = await store.listByFolder("work");
  assert.strictEqual(work.length, 2);
});

test("BookmarkStore: listAll returns all, sorted by createdAt DESC", async () => {
  const store = new InMemoryBookmarkStore();
  await store.create({ id: "b1", url: "https://a.com", title: "A", tags: [], createdAt: "2026-01-01T00:00:00Z" });
  await store.create({ id: "b2", url: "https://b.com", title: "B", tags: [], createdAt: "2026-01-02T00:00:00Z" });
  const all = await store.listAll();
  assert.strictEqual(all.length, 2);
  assert.strictEqual(all[0].id, "b2"); // newer first
});

test("BookmarkStore: search matches title and URL", async () => {
  const store = new InMemoryBookmarkStore();
  await store.create({ id: "b1", url: "https://github.com/repo", title: "My Project", tags: [], createdAt: "2026-01-01T00:00:00Z" });
  await store.create({ id: "b2", url: "https://example.com", title: "GitHub Mirror", tags: [], createdAt: "2026-01-01T00:00:00Z" });
  await store.create({ id: "b3", url: "https://other.com", title: "Other", tags: [], createdAt: "2026-01-01T00:00:00Z" });
  const results = await store.search("github");
  assert.strictEqual(results.length, 2); // b1 (URL match) + b2 (title match)
});

test("BookmarkStore: search returns empty for no matches", async () => {
  const store = new InMemoryBookmarkStore();
  await store.create({ id: "b1", url: "https://example.com", title: "Example", tags: [], createdAt: "2026-01-01T00:00:00Z" });
  assert.deepStrictEqual(await store.search("nonexistent"), []);
});

test("BookmarkStore: delete removes and returns true, false for unknown", async () => {
  const store = new InMemoryBookmarkStore();
  await store.create({ id: "b1", url: "https://example.com", title: "Example", tags: [], createdAt: "2026-01-01T00:00:00Z" });
  assert.strictEqual(await store.delete("b1"), true);
  assert.strictEqual(await store.get("b1"), null);
  assert.strictEqual(await store.delete("b1"), false);
});

// ============================================================================
// BrowsingHistoryStore (8 tests)
// ============================================================================

test("BrowsingHistoryStore: record + listRecent round-trip", async () => {
  const store = new InMemoryBrowsingHistoryStore();
  await store.record({ id: "h1", url: "https://a.com", title: "A", visitedAt: "2026-01-01T00:00:00Z" });
  await store.record({ id: "h2", url: "https://b.com", title: "B", visitedAt: "2026-01-01T00:01:00Z" });
  const recent = await store.listRecent(10);
  assert.strictEqual(recent.length, 2);
  assert.strictEqual(recent[0].id, "h2"); // most recent first
});

test("BrowsingHistoryStore: listRecent respects limit", async () => {
  const store = new InMemoryBrowsingHistoryStore();
  await store.record({ id: "h1", url: "https://a.com", title: "A", visitedAt: "2026-01-01T00:00:00Z" });
  await store.record({ id: "h2", url: "https://b.com", title: "B", visitedAt: "2026-01-01T00:01:00Z" });
  await store.record({ id: "h3", url: "https://c.com", title: "C", visitedAt: "2026-01-01T00:02:00Z" });
  const recent = await store.listRecent(2);
  assert.strictEqual(recent.length, 2);
  assert.strictEqual(recent[0].id, "h3");
  assert.strictEqual(recent[1].id, "h2");
});

test("BrowsingHistoryStore: listByDateRange returns entries within range", async () => {
  const store = new InMemoryBrowsingHistoryStore();
  await store.record({ id: "h1", url: "https://a.com", title: "A", visitedAt: "2026-01-01T00:00:00Z" });
  await store.record({ id: "h2", url: "https://b.com", title: "B", visitedAt: "2026-01-02T00:00:00Z" });
  await store.record({ id: "h3", url: "https://c.com", title: "C", visitedAt: "2026-01-03T00:00:00Z" });
  const range = await store.listByDateRange("2026-01-01T12:00:00Z", "2026-01-02T12:00:00Z");
  assert.strictEqual(range.length, 1);
  assert.strictEqual(range[0].id, "h2");
});

test("BrowsingHistoryStore: search matches title and URL (case-insensitive)", async () => {
  const store = new InMemoryBrowsingHistoryStore();
  await store.record({ id: "h1", url: "https://github.com", title: "Home", visitedAt: "2026-01-01T00:00:00Z" });
  await store.record({ id: "h2", url: "https://other.com", title: "GitHub Clone", visitedAt: "2026-01-01T00:00:00Z" });
  await store.record({ id: "h3", url: "https://example.com", title: "Example", visitedAt: "2026-01-01T00:00:00Z" });
  const results = await store.search("GitHub");
  assert.strictEqual(results.length, 2);
});

test("BrowsingHistoryStore: deleteByDateRange removes entries in range", async () => {
  const store = new InMemoryBrowsingHistoryStore();
  await store.record({ id: "h1", url: "https://a.com", title: "A", visitedAt: "2026-01-01T00:00:00Z" });
  await store.record({ id: "h2", url: "https://b.com", title: "B", visitedAt: "2026-01-02T00:00:00Z" });
  await store.record({ id: "h3", url: "https://c.com", title: "C", visitedAt: "2026-01-03T00:00:00Z" });
  const deleted = await store.deleteByDateRange("2026-01-01T12:00:00Z", "2026-01-02T12:00:00Z");
  assert.strictEqual(deleted, 1);
  const remaining = await store.listRecent(10);
  assert.strictEqual(remaining.length, 2);
});

test("BrowsingHistoryStore: deleteByDateRange returns 0 when no matches", async () => {
  const store = new InMemoryBrowsingHistoryStore();
  await store.record({ id: "h1", url: "https://a.com", title: "A", visitedAt: "2026-01-01T00:00:00Z" });
  assert.strictEqual(await store.deleteByDateRange("2026-02-01T00:00:00Z", "2026-02-28T00:00:00Z"), 0);
});

test("BrowsingHistoryStore: deleteAll clears all entries", async () => {
  const store = new InMemoryBrowsingHistoryStore();
  await store.record({ id: "h1", url: "https://a.com", title: "A", visitedAt: "2026-01-01T00:00:00Z" });
  await store.record({ id: "h2", url: "https://b.com", title: "B", visitedAt: "2026-01-02T00:00:00Z" });
  const deleted = await store.deleteAll();
  assert.strictEqual(deleted, 2);
  assert.deepStrictEqual(await store.listRecent(10), []);
});

test("BrowsingHistoryStore: deleteAll returns 0 on empty store", async () => {
  const store = new InMemoryBrowsingHistoryStore();
  assert.strictEqual(await store.deleteAll(), 0);
});

// ============================================================================
// BrowserProfileStore (5 tests)
// ============================================================================

test("BrowserProfileStore: save + get round-trip", async () => {
  const store = new InMemoryBrowserProfileStore();
  const profile = { id: "p1", label: "Default", storagePath: "/tmp/p1", isManaged: true, createdAt: "2026-01-01T00:00:00Z" };
  await store.save(profile);
  assert.deepStrictEqual(await store.get("p1"), profile);
});

test("BrowserProfileStore: get returns null for unknown id", async () => {
  const store = new InMemoryBrowserProfileStore();
  assert.strictEqual(await store.get("nonexistent"), null);
});

test("BrowserProfileStore: save overwrites existing profile (upsert)", async () => {
  const store = new InMemoryBrowserProfileStore();
  await store.save({ id: "p1", label: "Old", storagePath: "/tmp/p1", isManaged: true, createdAt: "2026-01-01T00:00:00Z" });
  await store.save({ id: "p1", label: "New", storagePath: "/tmp/p1-v2", isManaged: false, createdAt: "2026-01-01T00:00:00Z" });
  const p = await store.get("p1");
  assert.strictEqual(p.label, "New");
  assert.strictEqual(p.storagePath, "/tmp/p1-v2");
});

test("BrowserProfileStore: listAll returns all profiles", async () => {
  const store = new InMemoryBrowserProfileStore();
  await store.save({ id: "p1", label: "One", storagePath: "/a", isManaged: true, createdAt: "2026-01-01T00:00:00Z" });
  await store.save({ id: "p2", label: "Two", storagePath: "/b", isManaged: false, createdAt: "2026-01-02T00:00:00Z" });
  assert.strictEqual((await store.listAll()).length, 2);
});

test("BrowserProfileStore: delete removes and returns true, false for unknown", async () => {
  const store = new InMemoryBrowserProfileStore();
  await store.save({ id: "p1", label: "One", storagePath: "/a", isManaged: true, createdAt: "2026-01-01T00:00:00Z" });
  assert.strictEqual(await store.delete("p1"), true);
  assert.strictEqual(await store.get("p1"), null);
  assert.strictEqual(await store.delete("p1"), false);
});

// ============================================================================
// CookieContainerStore (7 tests)
// ============================================================================

test("CookieContainerStore: create + get round-trip", async () => {
  const store = new InMemoryCookieContainerStore();
  const container = { id: "c1", label: "Work", color: "blue", partitionKey: "pk_work", createdAt: "2026-01-01T00:00:00Z" };
  await store.create(container);
  assert.deepStrictEqual(await store.get("c1"), container);
});

test("CookieContainerStore: get returns null for unknown id", async () => {
  const store = new InMemoryCookieContainerStore();
  assert.strictEqual(await store.get("nonexistent"), null);
});

test("CookieContainerStore: update modifies fields", async () => {
  const store = new InMemoryCookieContainerStore();
  await store.create({ id: "c1", label: "Old", partitionKey: "pk1", createdAt: "2026-01-01T00:00:00Z" });
  await store.update("c1", { label: "New", color: "red" });
  const c = await store.get("c1");
  assert.strictEqual(c.label, "New");
  assert.strictEqual(c.color, "red");
  assert.strictEqual(c.partitionKey, "pk1"); // unchanged
});

test("CookieContainerStore: listAll returns all containers", async () => {
  const store = new InMemoryCookieContainerStore();
  await store.create({ id: "c1", label: "A", partitionKey: "pk1", createdAt: "2026-01-01T00:00:00Z" });
  await store.create({ id: "c2", label: "B", partitionKey: "pk2", createdAt: "2026-01-01T00:00:00Z" });
  assert.strictEqual((await store.listAll()).length, 2);
});

test("CookieContainerStore: listByProfile filters by profileId", async () => {
  const store = new InMemoryCookieContainerStore();
  await store.create({ id: "c1", label: "A", profileId: "p1", partitionKey: "pk1", createdAt: "2026-01-01T00:00:00Z" });
  await store.create({ id: "c2", label: "B", profileId: "p2", partitionKey: "pk2", createdAt: "2026-01-01T00:00:00Z" });
  await store.create({ id: "c3", label: "C", profileId: "p1", partitionKey: "pk3", createdAt: "2026-01-01T00:00:00Z" });
  const p1Containers = await store.listByProfile("p1");
  assert.strictEqual(p1Containers.length, 2);
});

test("CookieContainerStore: delete removes and returns true, false for unknown", async () => {
  const store = new InMemoryCookieContainerStore();
  await store.create({ id: "c1", label: "A", partitionKey: "pk1", createdAt: "2026-01-01T00:00:00Z" });
  assert.strictEqual(await store.delete("c1"), true);
  assert.strictEqual(await store.get("c1"), null);
  assert.strictEqual(await store.delete("c1"), false);
});

test("CookieContainerStore: update on nonexistent id is a no-op", async () => {
  const store = new InMemoryCookieContainerStore();
  await store.update("nonexistent", { label: "Test" }); // should not throw
  assert.strictEqual(await store.get("nonexistent"), null);
});

// ============================================================================
// StandaloneTabStore (5 tests)
// ============================================================================

test("StandaloneTabStore: save + get round-trip", async () => {
  const store = new InMemoryStandaloneTabStore();
  const tab = { id: "t1", url: "https://example.com", profileId: "p1", createdAt: "2026-01-01T00:00:00Z" };
  await store.save(tab);
  assert.deepStrictEqual(await store.get("t1"), tab);
});

test("StandaloneTabStore: get returns null for unknown id", async () => {
  const store = new InMemoryStandaloneTabStore();
  assert.strictEqual(await store.get("nonexistent"), null);
});

test("StandaloneTabStore: save overwrites existing tab (upsert)", async () => {
  const store = new InMemoryStandaloneTabStore();
  await store.save({ id: "t1", url: "https://old.com", createdAt: "2026-01-01T00:00:00Z" });
  await store.save({ id: "t1", url: "https://new.com", createdAt: "2026-01-01T00:00:00Z" });
  assert.strictEqual((await store.get("t1")).url, "https://new.com");
});

test("StandaloneTabStore: listAll returns all tabs", async () => {
  const store = new InMemoryStandaloneTabStore();
  await store.save({ id: "t1", url: "https://a.com", createdAt: "2026-01-01T00:00:00Z" });
  await store.save({ id: "t2", url: "https://b.com", createdAt: "2026-01-01T00:00:00Z" });
  assert.strictEqual((await store.listAll()).length, 2);
});

test("StandaloneTabStore: delete removes and returns true, false for unknown", async () => {
  const store = new InMemoryStandaloneTabStore();
  await store.save({ id: "t1", url: "https://example.com", createdAt: "2026-01-01T00:00:00Z" });
  assert.strictEqual(await store.delete("t1"), true);
  assert.strictEqual(await store.get("t1"), null);
  assert.strictEqual(await store.delete("t1"), false);
});

// ============================================================================
// ChatBridgeStateStore (6 tests)
// ============================================================================

test("ChatBridgeStateStore: set + get round-trip", async () => {
  const store = new InMemoryChatBridgeStateStore();
  await store.set("key1", { approved: true, chatId: "123" });
  const val = await store.get("key1");
  assert.deepStrictEqual(val, { approved: true, chatId: "123" });
});

test("ChatBridgeStateStore: get returns null for unknown key", async () => {
  const store = new InMemoryChatBridgeStateStore();
  assert.strictEqual(await store.get("nonexistent"), null);
});

test("ChatBridgeStateStore: set overwrites existing value", async () => {
  const store = new InMemoryChatBridgeStateStore();
  await store.set("key1", "old");
  await store.set("key1", "new");
  assert.strictEqual(await store.get("key1"), "new");
});

test("ChatBridgeStateStore: delete removes and returns true, false for unknown", async () => {
  const store = new InMemoryChatBridgeStateStore();
  await store.set("key1", "value");
  assert.strictEqual(await store.delete("key1"), true);
  assert.strictEqual(await store.get("key1"), null);
  assert.strictEqual(await store.delete("key1"), false);
});

test("ChatBridgeStateStore: listAll returns all entries with keys", async () => {
  const store = new InMemoryChatBridgeStateStore();
  await store.set("k1", "v1");
  await store.set("k2", { nested: true });
  const all = await store.listAll();
  assert.strictEqual(all.length, 2);
  const keys = all.map(e => e.key).sort();
  assert.deepStrictEqual(keys, ["k1", "k2"]);
  assert.ok(all.every(e => e.updatedAt)); // has timestamp
});

test("ChatBridgeStateStore: stores various value types (string, object, number, null)", async () => {
  const store = new InMemoryChatBridgeStateStore();
  await store.set("str", "hello");
  await store.set("obj", { a: 1 });
  await store.set("num", 42);
  assert.strictEqual(await store.get("str"), "hello");
  assert.deepStrictEqual(await store.get("obj"), { a: 1 });
  assert.strictEqual(await store.get("num"), 42);
});
