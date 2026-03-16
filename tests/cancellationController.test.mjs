import test from "node:test";
import assert from "node:assert/strict";

import { CancellationController } from "../packages/runtime-core/dist/CancellationController.js";

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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    checkpoint: {
      step: 1,
      browserSessionId: overrides.browserSessionId ?? "sess_1",
      summary: "",
      ...overrides.checkpoint,
    },
    outcome: overrides.outcome,
    suspension: overrides.suspension,
  };
}

function makeServices(overrides = {}) {
  const savedRuns = [];
  const appendedEvents = [];
  const destroyedSessions = [];
  const clearedRunStates = [];
  const sentMessages = [];

  return {
    savedRuns,
    appendedEvents,
    destroyedSessions,
    clearedRunStates,
    sentMessages,
    services: {
      runCheckpointStore: {
        load: overrides.load ?? (async () => null),
        save: async (run) => { savedRuns.push(run); },
      },
      browserKernel: {
        destroySession: async (id) => { destroyedSessions.push(id); },
      },
      orchestrator: {
        cancelRun: overrides.cancelRun ?? ((run, summary) => ({
          ...run,
          status: "cancelled",
          updatedAt: new Date().toISOString(),
          checkpoint: { ...run.checkpoint, summary, stopReason: `Cancelled: ${summary}` },
          outcome: { status: "cancelled", summary, finishedAt: new Date().toISOString() },
          suspension: undefined,
        })),
      },
      workflowLogStore: {
        append: async (event) => { appendedEvents.push(event); },
      },
      eventBus: {
        publish: async () => {},
      },
      chatBridge: {
        clearRunState: async (runId) => { clearedRunStates.push(runId); },
        send: async (msg) => { sentMessages.push(msg); },
      },
    },
  };
}

function makeSessionManager() {
  const cleanedRuns = [];
  return {
    cleanedRuns,
    sessions: {
      cleanupRun: async (runId) => { cleanedRuns.push(runId); },
    },
  };
}

function makeHandoffManager() {
  const emitted = [];
  const notified = [];
  return {
    emitted,
    notified,
    handoff: {
      emitHandoffEvent: async (run) => { emitted.push(run); },
      notifyTerminalEvent: async (run) => { notified.push(run); },
    },
  };
}

// --- isCancelled / acknowledge: sync state ---

test("isCancelled: returns false for unknown runId", () => {
  const { services } = makeServices();
  const { sessions } = makeSessionManager();
  const { handoff } = makeHandoffManager();
  const ctrl = new CancellationController(services, sessions, handoff);
  assert.equal(ctrl.isCancelled("run_unknown"), false);
});

test("isCancelled: returns true after cancel completes for non-terminal run", async () => {
  const run = makeRun({ status: "running" });
  const { services } = makeServices({ load: async () => run });
  const { sessions } = makeSessionManager();
  const { handoff } = makeHandoffManager();
  const ctrl = new CancellationController(services, sessions, handoff);

  await ctrl.cancel("run_1");
  // pending flag remains until acknowledge() is called
  assert.equal(ctrl.isCancelled("run_1"), true);
});

test("acknowledge: clears the cancelled flag", async () => {
  const run = makeRun({ status: "running" });
  const { services } = makeServices({ load: async () => run });
  const { sessions } = makeSessionManager();
  const { handoff } = makeHandoffManager();
  const ctrl = new CancellationController(services, sessions, handoff);

  await ctrl.cancel("run_1");
  assert.equal(ctrl.isCancelled("run_1"), true);
  ctrl.acknowledge("run_1");
  assert.equal(ctrl.isCancelled("run_1"), false);
});

test("acknowledge: no-op for unknown runId", () => {
  const { services } = makeServices();
  const { sessions } = makeSessionManager();
  const { handoff } = makeHandoffManager();
  const ctrl = new CancellationController(services, sessions, handoff);
  // Should not throw
  ctrl.acknowledge("run_unknown");
  assert.equal(ctrl.isCancelled("run_unknown"), false);
});

// --- cancel: non-existent run ---

test("cancel: returns null for non-existent run", async () => {
  const { services } = makeServices({ load: async () => null });
  const { sessions } = makeSessionManager();
  const { handoff } = makeHandoffManager();
  const ctrl = new CancellationController(services, sessions, handoff);

  const result = await ctrl.cancel("run_nonexistent");
  assert.equal(result, null);
});

// --- cancel: already terminal ---

test("cancel: returns run unchanged if already completed", async () => {
  const run = makeRun({ status: "completed" });
  const tracker = makeServices({ load: async () => run });
  const sm = makeSessionManager();
  const hm = makeHandoffManager();
  const ctrl = new CancellationController(tracker.services, sm.sessions, hm.handoff);

  const result = await ctrl.cancel("run_1");
  assert.equal(result.status, "completed");
  // Should still destroy session and cleanup
  assert.equal(tracker.destroyedSessions.length, 1);
  assert.equal(sm.cleanedRuns.length, 1);
  // Should NOT save, emit handoff, or notify (already terminal)
  assert.equal(tracker.savedRuns.length, 0);
  assert.equal(hm.emitted.length, 0);
  assert.equal(hm.notified.length, 0);
});

test("cancel: returns run unchanged if already failed", async () => {
  const run = makeRun({ status: "failed" });
  const tracker = makeServices({ load: async () => run });
  const sm = makeSessionManager();
  const hm = makeHandoffManager();
  const ctrl = new CancellationController(tracker.services, sm.sessions, hm.handoff);

  const result = await ctrl.cancel("run_1");
  assert.equal(result.status, "failed");
  assert.equal(tracker.savedRuns.length, 0);
});

test("cancel: returns run unchanged if already cancelled", async () => {
  const run = makeRun({ status: "cancelled" });
  const tracker = makeServices({ load: async () => run });
  const sm = makeSessionManager();
  const hm = makeHandoffManager();
  const ctrl = new CancellationController(tracker.services, sm.sessions, hm.handoff);

  const result = await ctrl.cancel("run_1");
  assert.equal(result.status, "cancelled");
  assert.equal(tracker.savedRuns.length, 0);
});

// --- cancel: active run (full flow) ---

test("cancel: active running run performs full cancellation flow", async () => {
  const run = makeRun({ status: "running", browserSessionId: "sess_42" });
  const tracker = makeServices({ load: async () => run });
  const sm = makeSessionManager();
  const hm = makeHandoffManager();
  const ctrl = new CancellationController(tracker.services, sm.sessions, hm.handoff);

  const result = await ctrl.cancel("run_1", "User pressed cancel");
  assert.equal(result.status, "cancelled");
  assert.equal(result.outcome.summary, "User pressed cancel");

  // Browser session destroyed
  assert.deepEqual(tracker.destroyedSessions, ["sess_42"]);
  // Session manager cleanup
  assert.deepEqual(sm.cleanedRuns, ["run_1"]);
  // Checkpoint saved
  assert.equal(tracker.savedRuns.length, 1);
  assert.equal(tracker.savedRuns[0].status, "cancelled");
  // Workflow event appended
  assert.equal(tracker.appendedEvents.length, 1);
  assert.ok(tracker.appendedEvents[0].type === "run_cancelled");
  // Handoff emitted and notified
  assert.equal(hm.emitted.length, 1);
  assert.equal(hm.notified.length, 1);
  // Chat bridge cleared
  assert.deepEqual(tracker.clearedRunStates, ["run_1"]);
});

test("cancel: suspended run can be cancelled", async () => {
  const run = makeRun({
    status: "suspended_for_clarification",
    suspension: { type: "clarification", requestId: "req_1", question: "Which one?", createdAt: new Date().toISOString() },
  });
  // Override cancelRun to handle this status
  const cancelRun = (r, summary) => ({
    ...r,
    status: "cancelled",
    updatedAt: new Date().toISOString(),
    checkpoint: { ...r.checkpoint, summary },
    outcome: { status: "cancelled", summary, finishedAt: new Date().toISOString() },
    suspension: undefined,
  });
  const tracker = makeServices({ load: async () => run, cancelRun });
  const sm = makeSessionManager();
  const hm = makeHandoffManager();
  const ctrl = new CancellationController(tracker.services, sm.sessions, hm.handoff);

  const result = await ctrl.cancel("run_1", "No longer needed");
  assert.equal(result.status, "cancelled");
  assert.equal(result.suspension, undefined);
  assert.equal(tracker.savedRuns.length, 1);
});

test("cancel: uses default summary when none provided", async () => {
  const run = makeRun({ status: "running" });
  const tracker = makeServices({ load: async () => run });
  const sm = makeSessionManager();
  const hm = makeHandoffManager();
  const ctrl = new CancellationController(tracker.services, sm.sessions, hm.handoff);

  const result = await ctrl.cancel("run_1");
  assert.equal(result.outcome.summary, "Run cancelled by user.");
});

test("cancel: handles missing browserSessionId gracefully", async () => {
  const run = makeRun({ status: "running", checkpoint: { step: 1, browserSessionId: undefined } });
  const tracker = makeServices({ load: async () => run });
  const sm = makeSessionManager();
  const hm = makeHandoffManager();
  const ctrl = new CancellationController(tracker.services, sm.sessions, hm.handoff);

  const result = await ctrl.cancel("run_1");
  assert.equal(result.status, "cancelled");
  // No session to destroy (browserSessionId was undefined)
  assert.equal(tracker.destroyedSessions.length, 0);
});

test("cancel: browserKernel.destroySession failure is swallowed", async () => {
  const run = makeRun({ status: "running", browserSessionId: "sess_broken" });
  const { services, savedRuns } = makeServices({ load: async () => run });
  services.browserKernel.destroySession = async () => { throw new Error("session gone"); };
  const sm = makeSessionManager();
  const hm = makeHandoffManager();
  const ctrl = new CancellationController(services, sm.sessions, hm.handoff);

  // Should not throw
  const result = await ctrl.cancel("run_1");
  assert.equal(result.status, "cancelled");
  assert.equal(savedRuns.length, 1);
});
