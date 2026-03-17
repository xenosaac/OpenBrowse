import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { InMemoryPreferenceStore } from "../packages/memory-store/dist/index.js";

/**
 * Tests for T60: Saved task templates CRUD logic.
 * These test the same logic the IPC handlers use (PreferenceStore with "templates" namespace).
 */

/** Simulate the IPC handler logic for templates:save */
async function saveTemplate(store, template) {
  const id = `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const name = template.name?.trim() || template.goal.slice(0, 60);
  const record = {
    id,
    name,
    goal: template.goal,
    createdAt: new Date().toISOString(),
  };
  await store.upsert({
    id,
    namespace: "templates",
    key: id,
    value: JSON.stringify(record),
    capturedAt: record.createdAt,
  });
  return record;
}

/** Simulate the IPC handler logic for templates:list */
async function listTemplates(store) {
  const entries = await store.list("templates");
  return entries
    .map((e) => {
      try { return JSON.parse(e.value); }
      catch { return null; }
    })
    .filter(Boolean);
}

/** Simulate the IPC handler logic for templates:delete */
async function deleteTemplate(store, templateId) {
  await store.deleteByKey("templates", templateId);
  return { ok: true };
}

describe("Task Templates (T60)", () => {
  let store;

  beforeEach(() => {
    store = new InMemoryPreferenceStore();
  });

  it("saves a template and retrieves it via list", async () => {
    const saved = await saveTemplate(store, { goal: "look up Bitcoin price" });
    assert.ok(saved.id.startsWith("tpl_"));
    assert.strictEqual(saved.goal, "look up Bitcoin price");
    assert.strictEqual(saved.name, "look up Bitcoin price");
    assert.ok(saved.createdAt);

    const templates = await listTemplates(store);
    assert.strictEqual(templates.length, 1);
    assert.strictEqual(templates[0].goal, "look up Bitcoin price");
  });

  it("saves a template with a custom name", async () => {
    const saved = await saveTemplate(store, { goal: "search for flights SNA to SEA", name: "SNA-SEA Flights" });
    assert.strictEqual(saved.name, "SNA-SEA Flights");
    assert.strictEqual(saved.goal, "search for flights SNA to SEA");
  });

  it("truncates name to 60 chars from goal when name is not provided", async () => {
    const longGoal = "a".repeat(100);
    const saved = await saveTemplate(store, { goal: longGoal });
    assert.strictEqual(saved.name.length, 60);
  });

  it("lists multiple templates", async () => {
    await saveTemplate(store, { goal: "task one" });
    await saveTemplate(store, { goal: "task two" });
    await saveTemplate(store, { goal: "task three" });

    const templates = await listTemplates(store);
    assert.strictEqual(templates.length, 3);
  });

  it("deletes a template by ID", async () => {
    const t1 = await saveTemplate(store, { goal: "keep me" });
    const t2 = await saveTemplate(store, { goal: "delete me" });

    const result = await deleteTemplate(store, t2.id);
    assert.deepStrictEqual(result, { ok: true });

    const templates = await listTemplates(store);
    assert.strictEqual(templates.length, 1);
    assert.strictEqual(templates[0].goal, "keep me");
  });

  it("list returns empty array when no templates exist", async () => {
    const templates = await listTemplates(store);
    assert.deepStrictEqual(templates, []);
  });

  it("templates do not interfere with other namespaces", async () => {
    await saveTemplate(store, { goal: "my template" });
    await store.upsert({
      id: "kb_1",
      namespace: "keybindings",
      key: "submit",
      value: "Ctrl+Enter",
      capturedAt: new Date().toISOString(),
    });

    const templates = await listTemplates(store);
    assert.strictEqual(templates.length, 1);
    assert.strictEqual(templates[0].goal, "my template");

    const keybindings = await store.list("keybindings");
    assert.strictEqual(keybindings.length, 1);
  });
});
