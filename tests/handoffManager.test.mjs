import test from "node:test";
import assert from "node:assert/strict";

import { HandoffManager } from "../packages/runtime-core/dist/HandoffManager.js";

// --- Helpers ---

function makeRun(overrides = {}) {
  return {
    id: overrides.id ?? "run_1",
    taskIntentId: "intent_1",
    status: overrides.status ?? "completed",
    goal: overrides.goal ?? "Test task",
    source: "desktop",
    constraints: [],
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    checkpoint: {
      step: 3,
      stepCount: 3,
      browserSessionId: overrides.browserSessionId ?? "sess_1",
      summary: "Done",
      lastKnownUrl: "https://example.com",
      lastPageTitle: "Example",
      actionHistory: [],
      consecutiveSoftFailures: 0,
      notes: [],
      ...overrides.checkpoint,
    },
    outcome: overrides.outcome ?? { status: "completed", summary: "Task done", finishedAt: "2026-01-01T00:00:01.000Z" },
    suspension: overrides.suspension,
  };
}

function makeServices(overrides = {}) {
  const appendedEvents = [];
  const sentMessages = [];
  const clearedRunStates = [];
  const capturedPages = [];
  const sessionsMap = overrides.sessionsMap ?? {};

  return {
    appendedEvents,
    sentMessages,
    clearedRunStates,
    capturedPages,
    services: {
      pendingCancellations: new Set(),
      browserKernel: {
        getSession: async (id) => sessionsMap[id] ?? null,
        capturePageModel: async (session) => {
          capturedPages.push(session.id);
          return overrides.pageModel ?? { url: "https://example.com", title: "Example" };
        },
      },
      workflowLogStore: {
        append: async (event) => { appendedEvents.push(event); },
      },
      eventBus: {
        publish: async () => {},
      },
      chatBridge: {
        clearRunState: overrides.clearRunState ?? (async (runId) => { clearedRunStates.push(runId); }),
        send: overrides.send ?? (async (msg) => { sentMessages.push(msg); }),
      },
    },
  };
}

// --- emitHandoffEvent ---

test("emitHandoffEvent emits workflow event with correct shape", async () => {
  const { services, appendedEvents } = makeServices();
  const hm = new HandoffManager(services);
  const run = makeRun();

  await hm.emitHandoffEvent(run);

  assert.equal(appendedEvents.length, 1);
  const event = appendedEvents[0];
  assert.equal(event.runId, "run_1");
  assert.equal(event.type, "handoff_written");
  assert.ok(event.summary.includes("Handoff written"));
  assert.equal(event.payload.status, "completed");
  assert.equal(event.payload.stepCount, "3");
});

test("emitHandoffEvent passes page model snapshot to artifact builder", async () => {
  const { services, appendedEvents } = makeServices();
  const hm = new HandoffManager(services);
  const run = makeRun();
  const snapshot = { url: "https://test.com", title: "Test Page" };

  await hm.emitHandoffEvent(run, snapshot);

  assert.equal(appendedEvents.length, 1);
  assert.equal(appendedEvents[0].payload.status, "completed");
});

// --- notifyTerminalEvent ---

test("notifyTerminalEvent sends completed notification", async () => {
  const { services, sentMessages } = makeServices();
  const hm = new HandoffManager(services);
  const run = makeRun({ status: "completed" });

  await hm.notifyTerminalEvent(run);

  assert.equal(sentMessages.length, 1);
  assert.ok(sentMessages[0].text.includes("✓"));
  assert.ok(sentMessages[0].text.includes("Task completed"));
  assert.equal(sentMessages[0].channel, "telegram");
  assert.equal(sentMessages[0].runId, "run_1");
});

test("notifyTerminalEvent sends failed notification", async () => {
  const { services, sentMessages } = makeServices();
  const hm = new HandoffManager(services);
  const run = makeRun({ status: "failed" });

  await hm.notifyTerminalEvent(run);

  assert.equal(sentMessages.length, 1);
  assert.ok(sentMessages[0].text.includes("✗"));
  assert.ok(sentMessages[0].text.includes("Task failed"));
});

test("notifyTerminalEvent sends cancelled notification", async () => {
  const { services, sentMessages } = makeServices();
  const hm = new HandoffManager(services);
  const run = makeRun({ status: "cancelled" });

  await hm.notifyTerminalEvent(run);

  assert.equal(sentMessages.length, 1);
  assert.ok(sentMessages[0].text.includes("⊘"));
  assert.ok(sentMessages[0].text.includes("Task cancelled"));
});

test("notifyTerminalEvent uses fallback for unknown status", async () => {
  const { services, sentMessages } = makeServices();
  const hm = new HandoffManager(services);
  const run = makeRun({ status: "unknown_status" });

  await hm.notifyTerminalEvent(run);

  assert.equal(sentMessages.length, 1);
  assert.ok(sentMessages[0].text.includes("Run ended (unknown_status)"));
});

test("notifyTerminalEvent truncates long goals in status line", async () => {
  const { services, sentMessages } = makeServices();
  const hm = new HandoffManager(services);
  const longGoal = "A".repeat(100);
  const run = makeRun({ status: "completed", goal: longGoal });

  await hm.notifyTerminalEvent(run);

  assert.equal(sentMessages.length, 1);
  // The first line (status line) should have the goal sliced to 60 chars
  const firstLine = sentMessages[0].text.split("\n")[0];
  assert.ok(firstLine.includes("A".repeat(60)));
  assert.ok(!firstLine.includes("A".repeat(61)));
});

test("notifyTerminalEvent swallows send errors", async () => {
  const { services } = makeServices({
    send: async () => { throw new Error("network failure"); },
  });
  const hm = new HandoffManager(services);
  const run = makeRun();

  // Should not throw
  await hm.notifyTerminalEvent(run);
});

// --- writeHandoff ---

test("writeHandoff with provided snapshot skips page capture", async () => {
  const { services, appendedEvents, sentMessages, clearedRunStates, capturedPages } = makeServices();
  const hm = new HandoffManager(services);
  const run = makeRun();
  const snapshot = { url: "https://provided.com", title: "Provided" };

  await hm.writeHandoff(run, snapshot);

  // Should not have captured a page model from browser
  assert.equal(capturedPages.length, 0);
  // Should have emitted handoff event
  assert.equal(appendedEvents.length, 1);
  // Should have sent notification
  assert.equal(sentMessages.length, 1);
  // Should have cleared run state
  assert.deepEqual(clearedRunStates, ["run_1"]);
});

test("writeHandoff without snapshot captures from active browser session", async () => {
  const activeSession = { id: "sess_1", state: "attached", profileId: "p1" };
  const { services, capturedPages, appendedEvents, sentMessages, clearedRunStates } = makeServices({
    sessionsMap: { sess_1: activeSession },
  });
  const hm = new HandoffManager(services);
  const run = makeRun();

  await hm.writeHandoff(run);

  assert.deepEqual(capturedPages, ["sess_1"]);
  assert.equal(appendedEvents.length, 1);
  assert.equal(sentMessages.length, 1);
  assert.deepEqual(clearedRunStates, ["run_1"]);
});

test("writeHandoff without snapshot skips capture for terminated session", async () => {
  const terminatedSession = { id: "sess_1", state: "terminated", profileId: "p1" };
  const { services, capturedPages } = makeServices({
    sessionsMap: { sess_1: terminatedSession },
  });
  const hm = new HandoffManager(services);
  const run = makeRun();

  await hm.writeHandoff(run);

  assert.equal(capturedPages.length, 0);
});

test("writeHandoff without snapshot skips capture when no browserSessionId", async () => {
  const { services, capturedPages } = makeServices();
  const hm = new HandoffManager(services);
  const run = makeRun({ browserSessionId: null, checkpoint: { browserSessionId: null } });

  await hm.writeHandoff(run);

  assert.equal(capturedPages.length, 0);
});

test("writeHandoff swallows session capture errors", async () => {
  const { services } = makeServices({
    sessionsMap: { sess_1: { id: "sess_1", state: "attached", profileId: "p1" } },
    pageModel: null,
  });
  // Override capturePageModel to throw
  services.browserKernel.capturePageModel = async () => { throw new Error("CDP gone"); };
  const hm = new HandoffManager(services);
  const run = makeRun();

  // Should not throw — error is swallowed
  await hm.writeHandoff(run);
});

test("writeHandoff tolerates missing clearRunState method", async () => {
  const { services, appendedEvents } = makeServices({
    clearRunState: undefined,
  });
  // Remove clearRunState entirely
  delete services.chatBridge.clearRunState;
  const hm = new HandoffManager(services);
  const run = makeRun();

  await hm.writeHandoff(run);

  assert.equal(appendedEvents.length, 1);
});
