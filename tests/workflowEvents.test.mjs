import test from "node:test";
import assert from "node:assert/strict";

import {
  createWorkflowEventId,
  createWorkflowEvent,
  appendWorkflowEvent,
  shouldNotifyTaskStart,
} from "../packages/runtime-core/dist/workflowEvents.js";

// --- createWorkflowEventId ---

test("createWorkflowEventId starts with event_ prefix", () => {
  const id = createWorkflowEventId("run_123");
  assert.ok(id.startsWith("event_run_123_"), `Expected prefix, got: ${id}`);
});

test("createWorkflowEventId produces unique IDs", () => {
  const id1 = createWorkflowEventId("r1");
  const id2 = createWorkflowEventId("r1");
  assert.notEqual(id1, id2);
});

test("createWorkflowEventId includes runId in output", () => {
  const id = createWorkflowEventId("my_run");
  assert.ok(id.includes("my_run"));
});

// --- createWorkflowEvent ---

test("createWorkflowEvent returns correct structure", () => {
  const event = createWorkflowEvent("run1", "run_created", "Run started", { key: "val" });
  assert.equal(event.runId, "run1");
  assert.equal(event.type, "run_created");
  assert.equal(event.summary, "Run started");
  assert.deepEqual(event.payload, { key: "val" });
  assert.ok(event.id.startsWith("event_run1_"));
  assert.ok(event.createdAt); // ISO string
});

test("createWorkflowEvent generates unique IDs per call", () => {
  const e1 = createWorkflowEvent("r1", "run_created", "s1", {});
  const e2 = createWorkflowEvent("r1", "run_created", "s1", {});
  assert.notEqual(e1.id, e2.id);
});

test("createWorkflowEvent preserves empty payload", () => {
  const event = createWorkflowEvent("r1", "browser_action_executed", "click", {});
  assert.deepEqual(event.payload, {});
});

test("createWorkflowEvent sets createdAt as ISO string", () => {
  const event = createWorkflowEvent("r1", "run_created", "s", {});
  // Should be parseable as a date
  const parsed = new Date(event.createdAt);
  assert.ok(!isNaN(parsed.getTime()), `createdAt should be valid ISO date: ${event.createdAt}`);
});

test("createWorkflowEvent handles various event types", () => {
  const types = [
    "run_created", "run_completed", "run_cancelled", "run_failed",
    "browser_action_executed", "page_modeled", "clarification_requested",
    "approval_requested", "recovery_attempted",
  ];
  for (const type of types) {
    const event = createWorkflowEvent("r1", type, "summary", {});
    assert.equal(event.type, type);
  }
});

// --- appendWorkflowEvent ---

test("appendWorkflowEvent calls store.append and eventBus.publish", async () => {
  const appendedEvents = [];
  const publishedEvents = [];

  const mockStore = {
    append: async (event) => { appendedEvents.push(event); },
  };
  const mockEventBus = {
    publish: async (channel, event) => { publishedEvents.push({ channel, event }); },
  };

  const event = createWorkflowEvent("r1", "run_created", "test", {});
  await appendWorkflowEvent(mockStore, mockEventBus, event);

  assert.equal(appendedEvents.length, 1);
  assert.equal(appendedEvents[0], event);
  assert.equal(publishedEvents.length, 1);
  assert.equal(publishedEvents[0].channel, "workflow");
  assert.equal(publishedEvents[0].event, event);
});

test("appendWorkflowEvent calls store before eventBus", async () => {
  const order = [];

  const mockStore = {
    append: async () => { order.push("store"); },
  };
  const mockEventBus = {
    publish: async () => { order.push("bus"); },
  };

  const event = createWorkflowEvent("r1", "run_created", "test", {});
  await appendWorkflowEvent(mockStore, mockEventBus, event);

  assert.deepEqual(order, ["store", "bus"]);
});

test("appendWorkflowEvent propagates store errors", async () => {
  const mockStore = {
    append: async () => { throw new Error("DB write failed"); },
  };
  const mockEventBus = {
    publish: async () => {},
  };

  const event = createWorkflowEvent("r1", "run_created", "test", {});
  await assert.rejects(
    () => appendWorkflowEvent(mockStore, mockEventBus, event),
    { message: "DB write failed" }
  );
});

// --- shouldNotifyTaskStart (T58) ---

test("shouldNotifyTaskStart returns true for telegram source", () => {
  assert.equal(shouldNotifyTaskStart("telegram"), true);
});

test("shouldNotifyTaskStart returns false for scheduler source", () => {
  assert.equal(shouldNotifyTaskStart("scheduler"), false);
});

test("shouldNotifyTaskStart returns false for desktop source", () => {
  assert.equal(shouldNotifyTaskStart("desktop"), false);
});

test("shouldNotifyTaskStart returns false for undefined source", () => {
  assert.equal(shouldNotifyTaskStart(undefined), false);
});
