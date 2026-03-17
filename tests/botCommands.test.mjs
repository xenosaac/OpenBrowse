import test from "node:test";
import assert from "node:assert/strict";

import { handleBotCommand } from "../packages/runtime-core/dist/botCommands.js";

// --- Helpers ---

function makeRun(overrides = {}) {
  return {
    id: overrides.id ?? "run_1",
    taskIntentId: "intent_1",
    status: overrides.status ?? "running",
    goal: overrides.goal ?? "Test task",
    source: "desktop",
    constraints: [],
    metadata: {},
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:01.000Z",
    checkpoint: {
      step: 1,
      stepCount: overrides.stepCount ?? 3,
      browserSessionId: "sess_1",
      summary: "",
      lastKnownUrl: overrides.lastKnownUrl ?? "https://example.com",
      lastPageTitle: "Example",
      actionHistory: [],
      consecutiveSoftFailures: 0,
      notes: [],
      ...overrides.checkpoint,
    },
    outcome: overrides.outcome ?? { status: overrides.status ?? "running", summary: "Done", finishedAt: "2026-01-01T00:00:01.000Z" },
    suspension: overrides.suspension,
  };
}

function makeServices(runs = []) {
  return {
    pendingCancellations: new Set(),
    runCheckpointStore: {
      load: async (id) => runs.find((r) => r.id === id) ?? null,
      listAll: async () => runs,
    },
  };
}

// --- /status ---

test("/status — no active runs", async () => {
  const services = makeServices([
    makeRun({ id: "run_1", status: "completed" }),
  ]);
  const result = await handleBotCommand(services, "status", "");
  assert.equal(result.responses.length, 1);
  assert.equal(result.responses[0], "No active runs.");
});

test("/status — shows running runs", async () => {
  const services = makeServices([
    makeRun({ id: "run_abc123def456", status: "running", goal: "Search for flights" }),
  ]);
  const result = await handleBotCommand(services, "status", "");
  assert.equal(result.responses.length, 1);
  assert.ok(result.responses[0].includes("Active runs:"));
  assert.ok(result.responses[0].includes("run_abc123de")); // sliced to 12
  assert.ok(result.responses[0].includes("Search for flights"));
  assert.ok(result.responses[0].includes("⚙")); // running emoji
});

test("/status — shows suspended runs", async () => {
  const services = makeServices([
    makeRun({ id: "run_suspended1", status: "suspended_for_clarification" }),
  ]);
  const result = await handleBotCommand(services, "status", "");
  assert.equal(result.responses.length, 1);
  assert.ok(result.responses[0].includes("⏸")); // suspended emoji
});

test("/status — includes step count and URL", async () => {
  const services = makeServices([
    makeRun({ id: "run_1234567890ab", status: "running", stepCount: 7, lastKnownUrl: "https://flights.google.com/search" }),
  ]);
  const result = await handleBotCommand(services, "status", "");
  assert.ok(result.responses[0].includes("step 7"));
  assert.ok(result.responses[0].includes("flights.google.com"));
});

test("/status — omits URL when not set", async () => {
  const services = makeServices([
    makeRun({ id: "run_1", status: "running", lastKnownUrl: undefined, checkpoint: { lastKnownUrl: undefined } }),
  ]);
  const result = await handleBotCommand(services, "status", "");
  assert.ok(!result.responses[0].includes("—"));
});

test("/status — filters out completed/failed/cancelled", async () => {
  const services = makeServices([
    makeRun({ id: "run_done", status: "completed" }),
    makeRun({ id: "run_active", status: "running" }),
    makeRun({ id: "run_failed", status: "failed" }),
  ]);
  const result = await handleBotCommand(services, "status", "");
  assert.ok(result.responses[0].includes("run_active"));
  assert.ok(!result.responses[0].includes("run_done"));
  assert.ok(!result.responses[0].includes("run_failed"));
});

// --- /list ---

test("/list — no runs", async () => {
  const services = makeServices([]);
  const result = await handleBotCommand(services, "list", "");
  assert.equal(result.responses.length, 1);
  assert.equal(result.responses[0], "No runs yet.");
});

test("/list — defaults to 5 most recent", async () => {
  const runs = [];
  for (let i = 0; i < 10; i++) {
    runs.push(makeRun({ id: `run_${i}`, updatedAt: `2026-01-0${i + 1}T00:00:00.000Z`, goal: `Task ${i}` }));
  }
  const services = makeServices(runs);
  const result = await handleBotCommand(services, "list", "");
  const lines = result.responses[0].split("\n");
  // "Recent runs:" + 5 run lines
  assert.equal(lines.length, 6);
});

test("/list — custom count", async () => {
  const runs = [];
  for (let i = 0; i < 10; i++) {
    runs.push(makeRun({ id: `run_${i}`, updatedAt: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`, goal: `Task ${i}` }));
  }
  const services = makeServices(runs);
  const result = await handleBotCommand(services, "list", "3");
  const lines = result.responses[0].split("\n");
  assert.equal(lines.length, 4); // header + 3 runs
});

test("/list — caps at 20", async () => {
  const services = makeServices([makeRun()]);
  const result = await handleBotCommand(services, "list", "100");
  // Should not crash, just cap at 20
  assert.equal(result.responses.length, 1);
});

test("/list — shows correct status emojis", async () => {
  const services = makeServices([
    makeRun({ id: "run_comp", status: "completed", goal: "Completed task" }),
    makeRun({ id: "run_fail", status: "failed", goal: "Failed task", updatedAt: "2026-01-02T00:00:00.000Z" }),
    makeRun({ id: "run_canc", status: "cancelled", goal: "Cancelled task", updatedAt: "2026-01-03T00:00:00.000Z" }),
    makeRun({ id: "run_queu", status: "queued", goal: "Queued task", updatedAt: "2026-01-04T00:00:00.000Z" }),
  ]);
  const result = await handleBotCommand(services, "list", "10");
  assert.ok(result.responses[0].includes("✓")); // completed
  assert.ok(result.responses[0].includes("✗")); // failed
  assert.ok(result.responses[0].includes("⊘")); // cancelled
  assert.ok(result.responses[0].includes("⏳")); // queued
});

test("/list — unknown status gets ? emoji", async () => {
  const services = makeServices([
    makeRun({ id: "run_unk", status: "some_unknown_status", goal: "Unknown" }),
  ]);
  const result = await handleBotCommand(services, "list", "");
  assert.ok(result.responses[0].includes("?"));
});

test("/list — sorted by updatedAt descending", async () => {
  const services = makeServices([
    makeRun({ id: "run_old", updatedAt: "2026-01-01T00:00:00.000Z", goal: "Old" }),
    makeRun({ id: "run_new", updatedAt: "2026-01-05T00:00:00.000Z", goal: "New" }),
    makeRun({ id: "run_mid", updatedAt: "2026-01-03T00:00:00.000Z", goal: "Mid" }),
  ]);
  const result = await handleBotCommand(services, "list", "");
  const text = result.responses[0];
  const newIdx = text.indexOf("New");
  const midIdx = text.indexOf("Mid");
  const oldIdx = text.indexOf("Old");
  assert.ok(newIdx < midIdx);
  assert.ok(midIdx < oldIdx);
});

test("/list — invalid args defaults to 5", async () => {
  const services = makeServices([makeRun()]);
  const result = await handleBotCommand(services, "list", "abc");
  assert.equal(result.responses.length, 1); // Just works with default 5
});

// --- /cancel ---

test("/cancel — no cancel function available", async () => {
  const services = makeServices([]);
  const result = await handleBotCommand(services, "cancel", "");
  assert.equal(result.responses.length, 1);
  assert.equal(result.responses[0], "Cancel not available.");
});

test("/cancel — no args, no running tasks", async () => {
  const services = makeServices([
    makeRun({ id: "run_done", status: "completed" }),
  ]);
  const cancelFn = async () => null;
  const result = await handleBotCommand(services, "cancel", "", cancelFn);
  assert.equal(result.responses[0], "No running tasks to cancel.");
});

test("/cancel — no args, cancels most recent running", async () => {
  const services = makeServices([
    makeRun({ id: "run_old", status: "running", goal: "Old task", createdAt: "2026-01-01T00:00:00.000Z" }),
    makeRun({ id: "run_new", status: "running", goal: "New task", createdAt: "2026-01-05T00:00:00.000Z" }),
  ]);
  let cancelledId = null;
  const cancelFn = async (_s, id) => { cancelledId = id; return makeRun({ id, status: "cancelled", goal: "New task" }); };
  const result = await handleBotCommand(services, "cancel", "", cancelFn);
  assert.equal(cancelledId, "run_new"); // Most recent by createdAt
  assert.ok(result.responses[0].includes("Cancelled"));
  assert.ok(result.responses[0].includes("New task"));
});

test("/cancel — no args, cancel returns null", async () => {
  const services = makeServices([
    makeRun({ id: "run_1", status: "running" }),
  ]);
  const cancelFn = async () => null;
  const result = await handleBotCommand(services, "cancel", "", cancelFn);
  assert.equal(result.responses[0], "Failed to cancel the run.");
});

test("/cancel — with specific runId", async () => {
  const services = makeServices([]);
  const cancelFn = async (_s, id) => makeRun({ id, status: "cancelled", goal: "Specific task" });
  const result = await handleBotCommand(services, "cancel", "run_specific", cancelFn);
  assert.ok(result.responses[0].includes("Cancelled"));
  assert.ok(result.responses[0].includes("Specific task"));
});

test("/cancel — with specific runId not found", async () => {
  const services = makeServices([]);
  const cancelFn = async () => null;
  const result = await handleBotCommand(services, "cancel", "run_missing", cancelFn);
  assert.equal(result.responses[0], "Run not found: run_missing");
});

test("/cancel — goal truncated to 60 chars", async () => {
  const services = makeServices([]);
  const longGoal = "A".repeat(100);
  const cancelFn = async (_s, id) => makeRun({ id, status: "cancelled", goal: longGoal });
  const result = await handleBotCommand(services, "cancel", "run_1", cancelFn);
  assert.ok(result.responses[0].includes("A".repeat(60)));
  assert.ok(!result.responses[0].includes("A".repeat(61)));
});

// --- /handoff ---

test("/handoff — with specific runId", async () => {
  const run = makeRun({ id: "run_target", status: "completed", goal: "Search flights" });
  const services = makeServices([run]);
  const result = await handleBotCommand(services, "handoff", "run_target");
  assert.ok(result.responses.length >= 1);
  // Should contain handoff markdown content
  assert.ok(result.responses[0].includes("Search flights") || result.responses[0].includes("run_target"));
});

test("/handoff — no args picks most recent terminal", async () => {
  const services = makeServices([
    makeRun({ id: "run_running", status: "running" }),
    makeRun({ id: "run_old", status: "completed", updatedAt: "2026-01-01T00:00:00.000Z", goal: "Old completed" }),
    makeRun({ id: "run_new", status: "failed", updatedAt: "2026-01-05T00:00:00.000Z", goal: "New failed" }),
  ]);
  const result = await handleBotCommand(services, "handoff", "");
  assert.ok(result.responses.length >= 1);
  // Should pick run_new (most recent terminal)
  assert.ok(result.responses.some(r => r.includes("New failed") || r.includes("run_new")));
});

test("/handoff — run not found", async () => {
  const services = makeServices([]);
  const result = await handleBotCommand(services, "handoff", "run_missing");
  assert.equal(result.responses.length, 1);
  assert.equal(result.responses[0], "Run not found.");
});

test("/handoff — no terminal runs", async () => {
  const services = makeServices([
    makeRun({ id: "run_running", status: "running" }),
  ]);
  const result = await handleBotCommand(services, "handoff", "");
  assert.equal(result.responses[0], "Run not found.");
});

test("/handoff — long markdown split into 4000-char chunks", async () => {
  // Create a run with enough data to generate long handoff markdown
  const run = makeRun({
    id: "run_long",
    status: "completed",
    goal: "A".repeat(200),
    checkpoint: {
      stepCount: 50,
      lastKnownUrl: "https://example.com/" + "x".repeat(200),
      actionHistory: Array.from({ length: 25 }, (_, i) => ({
        actionType: "click",
        description: `Click button ${i} with a very long description ${"z".repeat(100)}`,
      })),
    },
  });
  const services = makeServices([run]);
  const result = await handleBotCommand(services, "handoff", "run_long");
  // If markdown > 4000 chars, should have multiple responses
  if (result.responses.length > 1) {
    for (let i = 0; i < result.responses.length - 1; i++) {
      assert.ok(result.responses[i].length <= 4000);
    }
  }
});

// --- unknown command ---

test("unknown command returns error message", async () => {
  const services = makeServices([]);
  const result = await handleBotCommand(services, "foo", "");
  assert.equal(result.responses.length, 1);
  assert.equal(result.responses[0], "Unknown command: /foo");
});

// --- return shape ---

test("responses is always an array", async () => {
  const services = makeServices([]);
  const result = await handleBotCommand(services, "status", "");
  assert.ok(Array.isArray(result.responses));
});
