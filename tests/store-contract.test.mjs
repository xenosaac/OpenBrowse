import test from "node:test";
import assert from "node:assert/strict";

import {
  InMemoryRunCheckpointStore,
  InMemoryWorkflowLogStore,
  InMemoryPreferenceStore
} from "../packages/memory-store/dist/index.js";

// ---- Factories ----

function makeRun(overrides = {}) {
  return {
    id: "run_intent_1",
    taskIntentId: "intent_1",
    status: "running",
    goal: "Test goal",
    source: "desktop",
    constraints: [],
    metadata: {},
    createdAt: "2026-03-15T00:00:00Z",
    updatedAt: "2026-03-15T00:00:00Z",
    checkpoint: {
      summary: "Run started.",
      notes: [],
      stepCount: 0,
      actionHistory: [],
      consecutiveSoftFailures: 0
    },
    ...overrides
  };
}

function makeEvent(overrides = {}) {
  return {
    id: `event_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    runId: "run_1",
    type: "page_modeled",
    summary: "Captured page",
    createdAt: new Date().toISOString(),
    payload: {},
    ...overrides
  };
}

function makePreference(overrides = {}) {
  return {
    id: "pref_theme",
    namespace: "settings",
    key: "theme",
    value: "dark",
    capturedAt: new Date().toISOString(),
    ...overrides
  };
}

// ============================================================================
// RunCheckpointStore (10 tests)
// ============================================================================

test("RunCheckpointStore: save + load round-trip preserves all fields", async () => {
  const store = new InMemoryRunCheckpointStore();
  const run = makeRun({
    checkpoint: {
      summary: "Complex checkpoint",
      notes: [{ question: "When?", answer: "Tomorrow", answeredAt: "2026-03-15T01:00:00Z" }],
      stepCount: 5,
      actionHistory: [
        { step: 1, type: "navigate", description: "Go", ok: true, createdAt: "2026-03-15T00:01:00Z" }
      ],
      consecutiveSoftFailures: 2,
      lastKnownUrl: "https://example.com",
      lastPageTitle: "Example",
      lastPageSummary: "A summary",
      lastPageModelSnapshot: {
        title: "Example",
        summary: "A summary",
        visibleText: "Hello",
        formValues: { field_1: "value" },
        scrollY: 300
      }
    }
  });

  await store.save(run);
  const loaded = await store.load(run.id);
  assert.deepEqual(loaded, run);
});

test("RunCheckpointStore: save overwrites existing checkpoint (upsert)", async () => {
  const store = new InMemoryRunCheckpointStore();
  const run = makeRun();
  await store.save(run);

  const updated = { ...run, status: "completed", updatedAt: "2026-03-15T01:00:00Z", outcome: { summary: "Done" } };
  await store.save(updated);

  const loaded = await store.load(run.id);
  assert.equal(loaded.status, "completed");
  assert.equal(loaded.outcome.summary, "Done");
});

test("RunCheckpointStore: load returns null for nonexistent runId", async () => {
  const store = new InMemoryRunCheckpointStore();
  const result = await store.load("nonexistent_id");
  assert.equal(result, null);
});

test("RunCheckpointStore: listByStatus returns only matching runs", async () => {
  const store = new InMemoryRunCheckpointStore();
  await store.save(makeRun({ id: "r1", status: "running", updatedAt: "2026-03-15T00:00:00Z" }));
  await store.save(makeRun({ id: "r2", status: "completed", updatedAt: "2026-03-15T00:01:00Z" }));
  await store.save(makeRun({ id: "r3", status: "failed", updatedAt: "2026-03-15T00:02:00Z" }));

  const running = await store.listByStatus("running");
  assert.equal(running.length, 1);
  assert.equal(running[0].id, "r1");
});

test("RunCheckpointStore: listByStatus returns empty array for no matches", async () => {
  const store = new InMemoryRunCheckpointStore();
  await store.save(makeRun({ id: "r1", status: "running" }));
  const cancelled = await store.listByStatus("cancelled");
  assert.equal(cancelled.length, 0);
});

test("RunCheckpointStore: listAll returns all saved runs", async () => {
  const store = new InMemoryRunCheckpointStore();
  await store.save(makeRun({ id: "r1", updatedAt: "2026-03-15T00:00:00Z" }));
  await store.save(makeRun({ id: "r2", updatedAt: "2026-03-15T00:01:00Z" }));
  await store.save(makeRun({ id: "r3", updatedAt: "2026-03-15T00:02:00Z" }));

  const all = await store.listAll();
  assert.equal(all.length, 3);
});

test("RunCheckpointStore: listAll returns runs ordered by updatedAt DESC", async () => {
  const store = new InMemoryRunCheckpointStore();
  await store.save(makeRun({ id: "r_old", updatedAt: "2026-03-14T00:00:00Z" }));
  await store.save(makeRun({ id: "r_mid", updatedAt: "2026-03-15T00:00:00Z" }));
  await store.save(makeRun({ id: "r_new", updatedAt: "2026-03-15T12:00:00Z" }));

  const all = await store.listAll();
  assert.equal(all[0].id, "r_new");
  assert.equal(all[1].id, "r_mid");
  assert.equal(all[2].id, "r_old");
});

test("RunCheckpointStore: delete removes run and returns true", async () => {
  const store = new InMemoryRunCheckpointStore();
  await store.save(makeRun({ id: "r1" }));
  const result = await store.delete("r1");
  assert.equal(result, true);
  const loaded = await store.load("r1");
  assert.equal(loaded, null);
});

test("RunCheckpointStore: delete returns false for nonexistent runId", async () => {
  const store = new InMemoryRunCheckpointStore();
  const result = await store.delete("nonexistent");
  assert.equal(result, false);
});

test("RunCheckpointStore: deleted run not in listAll or listByStatus", async () => {
  const store = new InMemoryRunCheckpointStore();
  await store.save(makeRun({ id: "r1", status: "running", updatedAt: "2026-03-15T00:00:00Z" }));
  await store.delete("r1");

  const all = await store.listAll();
  assert.equal(all.length, 0);

  const running = await store.listByStatus("running");
  assert.equal(running.length, 0);
});

// ============================================================================
// WorkflowLogStore (9 tests)
// ============================================================================

test("WorkflowLogStore: append + listByRun round-trip", async () => {
  const store = new InMemoryWorkflowLogStore();
  const e1 = makeEvent({ id: "e1", runId: "run_A" });
  const e2 = makeEvent({ id: "e2", runId: "run_A" });
  const e3 = makeEvent({ id: "e3", runId: "run_A" });

  await store.append(e1);
  await store.append(e2);
  await store.append(e3);

  const events = await store.listByRun("run_A");
  assert.equal(events.length, 3);
  assert.equal(events[0].id, "e1");
  assert.equal(events[1].id, "e2");
  assert.equal(events[2].id, "e3");
});

test("WorkflowLogStore: listByRun returns events in append order", async () => {
  const store = new InMemoryWorkflowLogStore();
  await store.append(makeEvent({ id: "e1", runId: "run_A", createdAt: "2026-03-15T00:00:00Z" }));
  await store.append(makeEvent({ id: "e2", runId: "run_A", createdAt: "2026-03-15T00:01:00Z" }));
  await store.append(makeEvent({ id: "e3", runId: "run_A", createdAt: "2026-03-15T00:02:00Z" }));

  const events = await store.listByRun("run_A");
  assert.equal(events[0].id, "e1");
  assert.equal(events[2].id, "e3");
});

test("WorkflowLogStore: listByRun returns empty for unknown runId", async () => {
  const store = new InMemoryWorkflowLogStore();
  const events = await store.listByRun("unknown_run");
  assert.equal(events.length, 0);
});

test("WorkflowLogStore: listRecent returns N most recent in reverse order", async () => {
  const store = new InMemoryWorkflowLogStore();
  await store.append(makeEvent({ id: "e1", runId: "run_A", createdAt: "2026-03-15T00:00:00Z" }));
  await store.append(makeEvent({ id: "e2", runId: "run_A", createdAt: "2026-03-15T00:01:00Z" }));
  await store.append(makeEvent({ id: "e3", runId: "run_B", createdAt: "2026-03-15T00:02:00Z" }));
  await store.append(makeEvent({ id: "e4", runId: "run_A", createdAt: "2026-03-15T00:03:00Z" }));
  await store.append(makeEvent({ id: "e5", runId: "run_B", createdAt: "2026-03-15T00:04:00Z" }));

  const recent = await store.listRecent(3);
  assert.equal(recent.length, 3);
  assert.equal(recent[0].id, "e5"); // most recent
  assert.equal(recent[1].id, "e4");
  assert.equal(recent[2].id, "e3");
});

test("WorkflowLogStore: countByRun returns correct count", async () => {
  const store = new InMemoryWorkflowLogStore();
  await store.append(makeEvent({ id: "e1", runId: "run_A" }));
  await store.append(makeEvent({ id: "e2", runId: "run_A" }));
  await store.append(makeEvent({ id: "e3", runId: "run_A" }));
  await store.append(makeEvent({ id: "e4", runId: "run_A" }));
  await store.append(makeEvent({ id: "e5", runId: "run_B" }));
  await store.append(makeEvent({ id: "e6", runId: "run_B" }));

  assert.equal(await store.countByRun("run_A"), 4);
  assert.equal(await store.countByRun("run_B"), 2);
});

test("WorkflowLogStore: countByRun returns 0 for unknown runId", async () => {
  const store = new InMemoryWorkflowLogStore();
  assert.equal(await store.countByRun("nonexistent"), 0);
});

test("WorkflowLogStore: deleteByRun removes all events for a run, preserves others", async () => {
  const store = new InMemoryWorkflowLogStore();
  await store.append(makeEvent({ id: "e1", runId: "run_A" }));
  await store.append(makeEvent({ id: "e2", runId: "run_A" }));
  await store.append(makeEvent({ id: "e3", runId: "run_A" }));
  await store.append(makeEvent({ id: "e4", runId: "run_B" }));
  await store.append(makeEvent({ id: "e5", runId: "run_B" }));

  const deleted = await store.deleteByRun("run_A");
  assert.equal(deleted, 3);

  const remaining = await store.listByRun("run_A");
  assert.equal(remaining.length, 0);

  const preserved = await store.listByRun("run_B");
  assert.equal(preserved.length, 2);

  const recent = await store.listRecent(10);
  assert.equal(recent.length, 2);
});

test("WorkflowLogStore: deleteByRun returns 0 for unknown runId", async () => {
  const store = new InMemoryWorkflowLogStore();
  const deleted = await store.deleteByRun("unknown_run");
  assert.equal(deleted, 0);
});

test("WorkflowLogStore: append with duplicate id is idempotent", async () => {
  const store = new InMemoryWorkflowLogStore();
  const event = makeEvent({ id: "dup_event", runId: "run_A" });

  await store.append(event);
  await store.append({ ...event }); // same id

  // INSERT OR IGNORE semantics: only 1 stored
  assert.equal(await store.countByRun("run_A"), 1);
});

// ============================================================================
// PreferenceStore (11 tests)
// ============================================================================

test("PreferenceStore: upsert + get round-trip", async () => {
  const store = new InMemoryPreferenceStore();
  const pref = makePreference();
  await store.upsert(pref);

  const loaded = await store.get("settings", "theme");
  assert.equal(loaded.id, "pref_theme");
  assert.equal(loaded.namespace, "settings");
  assert.equal(loaded.key, "theme");
  assert.equal(loaded.value, "dark");
});

test("PreferenceStore: get returns null for nonexistent key", async () => {
  const store = new InMemoryPreferenceStore();
  const result = await store.get("settings", "nonexistent");
  assert.equal(result, null);
});

test("PreferenceStore: list returns all in namespace", async () => {
  const store = new InMemoryPreferenceStore();
  await store.upsert(makePreference({ id: "p1", key: "theme", value: "dark" }));
  await store.upsert(makePreference({ id: "p2", key: "lang", value: "en" }));
  await store.upsert(makePreference({ id: "p3", key: "font", value: "mono" }));
  await store.upsert(makePreference({ id: "p4", namespace: "other", key: "x", value: "y" }));

  const settings = await store.list("settings");
  assert.equal(settings.length, 3);
});

test("PreferenceStore: list returns empty for unknown namespace", async () => {
  const store = new InMemoryPreferenceStore();
  const result = await store.list("nonexistent_ns");
  assert.equal(result.length, 0);
});

test("PreferenceStore: upsert overwrites existing key (same namespace+key)", async () => {
  const store = new InMemoryPreferenceStore();
  await store.upsert(makePreference({ key: "theme", value: "dark" }));
  await store.upsert(makePreference({ key: "theme", value: "light" }));

  const loaded = await store.get("settings", "theme");
  assert.equal(loaded.value, "light");

  const all = await store.list("settings");
  assert.equal(all.length, 1);
});

test("PreferenceStore: delete by id returns true and removes", async () => {
  const store = new InMemoryPreferenceStore();
  await store.upsert(makePreference({ id: "p1", key: "theme" }));

  const result = await store.delete("p1");
  assert.equal(result, true);

  const loaded = await store.get("settings", "theme");
  assert.equal(loaded, null);
});

test("PreferenceStore: delete by id returns false for nonexistent", async () => {
  const store = new InMemoryPreferenceStore();
  const result = await store.delete("nonexistent_id");
  assert.equal(result, false);
});

test("PreferenceStore: deleteByKey removes by namespace+key", async () => {
  const store = new InMemoryPreferenceStore();
  await store.upsert(makePreference({ key: "theme" }));

  const result = await store.deleteByKey("settings", "theme");
  assert.equal(result, true);

  const loaded = await store.get("settings", "theme");
  assert.equal(loaded, null);
});

test("PreferenceStore: saveNamespaceSettings batch upsert", async () => {
  const store = new InMemoryPreferenceStore();
  await store.saveNamespaceSettings("settings", [
    { key: "a", value: "1" },
    { key: "b", value: "2" },
    { key: "c", value: "3" }
  ]);

  const all = await store.list("settings");
  assert.equal(all.length, 3);

  const a = await store.get("settings", "a");
  assert.equal(a.value, "1");
  assert.equal(a.id, "pref_a");

  const b = await store.get("settings", "b");
  assert.equal(b.value, "2");

  const c = await store.get("settings", "c");
  assert.equal(c.value, "3");
});

test("PreferenceStore: saveNamespaceSettings empty value deletes the key", async () => {
  const store = new InMemoryPreferenceStore();
  await store.upsert(makePreference({ key: "a", value: "1" }));

  await store.saveNamespaceSettings("settings", [{ key: "a", value: "" }]);

  const loaded = await store.get("settings", "a");
  assert.equal(loaded, null);
});

test("PreferenceStore: saveNamespaceSettings whitespace-only value treated as empty", async () => {
  const store = new InMemoryPreferenceStore();
  await store.upsert(makePreference({ key: "a", value: "1" }));

  await store.saveNamespaceSettings("settings", [{ key: "a", value: "   " }]);

  const loaded = await store.get("settings", "a");
  assert.equal(loaded, null);
});
