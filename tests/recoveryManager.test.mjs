import test from "node:test";
import assert from "node:assert/strict";

import { TaskOrchestrator, DefaultClarificationPolicy } from "../packages/orchestrator/dist/index.js";
import {
  InMemoryRunCheckpointStore,
  InMemoryWorkflowLogStore,
  InMemoryPreferenceStore
} from "../packages/memory-store/dist/index.js";
import { EventBus } from "../packages/observability/dist/index.js";
import { StubBrowserKernel } from "../packages/browser-runtime/dist/BrowserKernel.js";
import { StubChatBridge } from "../packages/chat-bridge/dist/index.js";
import { DefaultApprovalPolicy } from "../packages/security/dist/index.js";
import {
  RecoveryManager,
  DefaultRecoveryStrategy,
  extractRecoveryMetadata
} from "../packages/runtime-core/dist/RecoveryManager.js";

// ---- Factories ----

function makeRun(overrides = {}) {
  return {
    id: overrides.id ?? "run_test_1",
    taskIntentId: "intent_1",
    status: overrides.status ?? "running",
    goal: "Test goal",
    source: "desktop",
    constraints: [],
    metadata: {},
    createdAt: "2026-03-16T00:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-03-16T01:00:00Z",
    checkpoint: {
      summary: "Test checkpoint",
      notes: [],
      stepCount: 3,
      actionHistory: [],
      consecutiveSoftFailures: 0,
      ...(overrides.checkpoint ?? {})
    },
    ...(overrides.suspension ? { suspension: overrides.suspension } : {}),
    ...(overrides.outcome ? { outcome: overrides.outcome } : {})
  };
}

function makeServices(overrides = {}) {
  const orchestrator = new TaskOrchestrator(new DefaultClarificationPolicy());
  const runCheckpointStore = new InMemoryRunCheckpointStore();
  const workflowLogStore = new InMemoryWorkflowLogStore();
  const eventBus = new EventBus();

  return {
    orchestrator,
    runCheckpointStore,
    workflowLogStore,
    eventBus,
    browserKernel: new StubBrowserKernel(),
    chatBridge: new StubChatBridge(),
    planner: { plan: async () => ({ type: "done", summary: "done" }) },
    preferenceStore: new InMemoryPreferenceStore(),
    runtimeConfig: { dataDir: "/tmp/test", apiKeys: {} },
    runtimeSettings: { modelProvider: "stub", approvalMode: "default" },
    securityPolicy: new DefaultApprovalPolicy(),
    scheduler: { register: async () => "w_1", cancel: async () => {}, listAll: () => [] },
    descriptor: { phase: 1, browser: "stub", chat: "stub", planner: "stub" },
    telegramStatePath: "/tmp/test-state.json",
    hasDemos: false,
    pendingCancellations: new Set(),
    ...overrides
  };
}

// ---- DefaultRecoveryStrategy tests ----

test("DefaultRecoveryStrategy — shouldRetry returns true for running status", () => {
  const strategy = new DefaultRecoveryStrategy();
  const run = makeRun({ status: "running" });
  assert.equal(strategy.shouldRetry(run), true);
});

test("DefaultRecoveryStrategy — shouldRetry returns false for non-running status", () => {
  const strategy = new DefaultRecoveryStrategy();
  for (const status of ["completed", "failed", "cancelled", "suspended_for_clarification", "suspended_for_approval"]) {
    assert.equal(strategy.shouldRetry(makeRun({ status })), false, `Expected false for ${status}`);
  }
});

test("DefaultRecoveryStrategy — maxRetries is 1", () => {
  const strategy = new DefaultRecoveryStrategy();
  assert.equal(strategy.maxRetries, 1);
});

// ---- extractRecoveryMetadata tests ----

test("extractRecoveryMetadata — extracts all checkpoint fields when present", () => {
  const run = makeRun({
    updatedAt: "2026-03-16T05:00:00Z",
    checkpoint: {
      summary: "On payment page",
      lastPageModelId: "pm_123",
      browserSessionId: "sess_456",
      stepCount: 7,
      notes: []
    }
  });
  const meta = extractRecoveryMetadata(run);
  assert.equal(meta.lastPageModelId, "pm_123");
  assert.equal(meta.browserSessionId, "sess_456");
  assert.equal(meta.checkpointSummary, "On payment page");
  assert.equal(meta.lastUpdated, "2026-03-16T05:00:00Z");
  assert.equal(meta.stepCount, "7");
});

test("extractRecoveryMetadata — omits missing optional fields", () => {
  const run = makeRun({
    updatedAt: "2026-03-16T05:00:00Z",
    checkpoint: { summary: "", notes: [], stepCount: 0 }
  });
  const meta = extractRecoveryMetadata(run);
  assert.equal(meta.lastPageModelId, undefined);
  assert.equal(meta.browserSessionId, undefined);
  assert.equal(meta.checkpointSummary, undefined); // empty string is falsy
  assert.equal(meta.lastUpdated, "2026-03-16T05:00:00Z");
  assert.equal(meta.stepCount, "0");
});

test("extractRecoveryMetadata — stepCount defaults to 0 when undefined", () => {
  const run = makeRun({ checkpoint: { summary: "x", notes: [] } });
  delete run.checkpoint.stepCount;
  const meta = extractRecoveryMetadata(run);
  assert.equal(meta.stepCount, "0");
});

// ---- RecoveryManager.recoverInterruptedRuns tests ----

test("RecoveryManager — empty stores produce empty report", async () => {
  const services = makeServices();
  const manager = new RecoveryManager(services, {
    recoverRunFn: async () => { throw new Error("should not be called"); },
    emitHandoffFn: async () => { throw new Error("should not be called"); }
  });
  const report = await manager.recoverInterruptedRuns();
  assert.deepEqual(report, { resumed: [], awaitingInput: [], failed: [], skipped: [] });
});

test("RecoveryManager — categorizes clarification and approval runs as awaitingInput", async () => {
  const services = makeServices();
  const clarRun = makeRun({ id: "run_clar_1", status: "suspended_for_clarification" });
  const apprRun = makeRun({ id: "run_appr_1", status: "suspended_for_approval" });
  await services.runCheckpointStore.save(clarRun);
  await services.runCheckpointStore.save(apprRun);

  const manager = new RecoveryManager(services, {
    recoverRunFn: async () => { throw new Error("should not be called"); },
    emitHandoffFn: async () => { throw new Error("should not be called"); }
  });
  const report = await manager.recoverInterruptedRuns();

  assert.equal(report.awaitingInput.length, 2);
  assert.deepEqual(report.awaitingInput.map(r => r.id).sort(), ["run_appr_1", "run_clar_1"]);
  assert.equal(report.resumed.length, 0);
  assert.equal(report.failed.length, 0);
  assert.equal(report.skipped.length, 0);
});

test("RecoveryManager — logs recovery_skipped event for awaiting input runs", async () => {
  const services = makeServices();
  const clarRun = makeRun({ id: "run_clar_2", status: "suspended_for_clarification" });
  await services.runCheckpointStore.save(clarRun);

  const manager = new RecoveryManager(services, {
    recoverRunFn: async () => { throw new Error("should not be called"); },
    emitHandoffFn: async () => {}
  });
  await manager.recoverInterruptedRuns();

  const events = await services.workflowLogStore.listByRun("run_clar_2");
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "recovery_skipped");
  assert.ok(events[0].summary.includes("awaiting user input"));
});

test("RecoveryManager — successfully recovers running run", async () => {
  const services = makeServices();
  const run = makeRun({ id: "run_recover_1", status: "running" });
  await services.runCheckpointStore.save(run);

  const recoveredRun = makeRun({ id: "run_recover_1", status: "completed" });
  let recoverCalled = false;

  const manager = new RecoveryManager(services, {
    recoverRunFn: async (_svc, r) => {
      recoverCalled = true;
      assert.equal(r.id, "run_recover_1");
      return recoveredRun;
    },
    emitHandoffFn: async () => {}
  });

  const report = await manager.recoverInterruptedRuns();
  assert.equal(recoverCalled, true);
  assert.equal(report.resumed.length, 1);
  assert.equal(report.resumed[0].id, "run_recover_1");
  assert.equal(report.resumed[0].status, "completed");
});

test("RecoveryManager — logs run_recovered event on success", async () => {
  const services = makeServices();
  const run = makeRun({
    id: "run_log_1",
    status: "running",
    checkpoint: { summary: "Step 3", notes: [], browserSessionId: "bs_1", stepCount: 3 }
  });
  await services.runCheckpointStore.save(run);

  const manager = new RecoveryManager(services, {
    recoverRunFn: async (_svc, r) => ({ ...r, status: "completed" }),
    emitHandoffFn: async () => {}
  });
  await manager.recoverInterruptedRuns();

  const events = await services.workflowLogStore.listByRun("run_log_1");
  const recoveredEvent = events.find(e => e.type === "run_recovered");
  assert.ok(recoveredEvent);
  assert.ok(recoveredEvent.summary.includes("Successfully recovered"));
});

test("RecoveryManager — handles recovery failure: marks run as failed", async () => {
  const services = makeServices();
  const run = makeRun({ id: "run_fail_1", status: "running" });
  await services.runCheckpointStore.save(run);

  let handoffCalled = false;
  const manager = new RecoveryManager(services, {
    recoverRunFn: async () => { throw new Error("CDP connection lost"); },
    emitHandoffFn: async () => { handoffCalled = true; }
  });

  const report = await manager.recoverInterruptedRuns();
  assert.equal(report.failed.length, 1);
  assert.equal(report.failed[0].status, "failed");
  assert.ok(report.failed[0].outcome?.summary.includes("CDP connection lost"));
  assert.equal(handoffCalled, true);
});

test("RecoveryManager — logs recovery_failed event on failure", async () => {
  const services = makeServices();
  const run = makeRun({ id: "run_fail_2", status: "running" });
  await services.runCheckpointStore.save(run);

  const manager = new RecoveryManager(services, {
    recoverRunFn: async () => { throw new Error("Timeout"); },
    emitHandoffFn: async () => {}
  });
  await manager.recoverInterruptedRuns();

  const events = await services.workflowLogStore.listByRun("run_fail_2");
  const failedEvent = events.find(e => e.type === "recovery_failed");
  assert.ok(failedEvent);
  assert.ok(failedEvent.summary.includes("Timeout"));
});

test("RecoveryManager — saves failed run to checkpoint store", async () => {
  const services = makeServices();
  const run = makeRun({ id: "run_fail_3", status: "running" });
  await services.runCheckpointStore.save(run);

  const manager = new RecoveryManager(services, {
    recoverRunFn: async () => { throw new Error("Crash"); },
    emitHandoffFn: async () => {}
  });
  await manager.recoverInterruptedRuns();

  const saved = await services.runCheckpointStore.load("run_fail_3");
  assert.equal(saved.status, "failed");
});

test("RecoveryManager — custom strategy can skip running runs", async () => {
  const services = makeServices();
  const run = makeRun({ id: "run_skip_1", status: "running" });
  await services.runCheckpointStore.save(run);

  const neverRetry = { shouldRetry: () => false, maxRetries: 0 };
  const manager = new RecoveryManager(services, {
    strategy: neverRetry,
    recoverRunFn: async () => { throw new Error("should not be called"); },
    emitHandoffFn: async () => { throw new Error("should not be called"); }
  });

  const report = await manager.recoverInterruptedRuns();
  assert.equal(report.skipped.length, 1);
  assert.equal(report.skipped[0].id, "run_skip_1");
  assert.equal(report.resumed.length, 0);
  assert.equal(report.failed.length, 0);
});

test("RecoveryManager — logs recovery_skipped event for strategy-skipped runs", async () => {
  const services = makeServices();
  const run = makeRun({ id: "run_skip_2", status: "running" });
  await services.runCheckpointStore.save(run);

  const neverRetry = { shouldRetry: () => false, maxRetries: 0 };
  const manager = new RecoveryManager(services, {
    strategy: neverRetry,
    recoverRunFn: async () => { throw new Error("no"); },
    emitHandoffFn: async () => {}
  });
  await manager.recoverInterruptedRuns();

  const events = await services.workflowLogStore.listByRun("run_skip_2");
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "recovery_skipped");
  assert.ok(events[0].summary.includes("strategy chose to skip"));
});

test("RecoveryManager — multiple running runs: mixed success and failure", async () => {
  const services = makeServices();
  const run1 = makeRun({ id: "run_mix_1", status: "running" });
  const run2 = makeRun({ id: "run_mix_2", status: "running" });
  await services.runCheckpointStore.save(run1);
  await services.runCheckpointStore.save(run2);

  const manager = new RecoveryManager(services, {
    recoverRunFn: async (_svc, r) => {
      if (r.id === "run_mix_1") return { ...r, status: "completed" };
      throw new Error("fail on run_mix_2");
    },
    emitHandoffFn: async () => {}
  });

  const report = await manager.recoverInterruptedRuns();
  assert.equal(report.resumed.length, 1);
  assert.equal(report.resumed[0].id, "run_mix_1");
  assert.equal(report.failed.length, 1);
  assert.equal(report.failed[0].id, "run_mix_2");
});

test("RecoveryManager — combined: running + awaiting + strategy-skipped", async () => {
  const services = makeServices();
  await services.runCheckpointStore.save(makeRun({ id: "r_run", status: "running" }));
  await services.runCheckpointStore.save(makeRun({ id: "r_clar", status: "suspended_for_clarification" }));
  await services.runCheckpointStore.save(makeRun({ id: "r_appr", status: "suspended_for_approval" }));

  // Strategy that only retries runs whose id contains "run"
  const selectiveStrategy = {
    shouldRetry: (r) => r.id.includes("r_run"),
    maxRetries: 1
  };

  const manager = new RecoveryManager(services, {
    strategy: selectiveStrategy,
    recoverRunFn: async (_svc, r) => ({ ...r, status: "completed" }),
    emitHandoffFn: async () => {}
  });

  const report = await manager.recoverInterruptedRuns();
  assert.equal(report.resumed.length, 1);
  assert.equal(report.awaitingInput.length, 2);
  assert.equal(report.skipped.length, 0);
  assert.equal(report.failed.length, 0);
});

test("RecoveryManager — handles non-Error throw in recoverRunFn", async () => {
  const services = makeServices();
  await services.runCheckpointStore.save(makeRun({ id: "run_str_err", status: "running" }));

  const manager = new RecoveryManager(services, {
    recoverRunFn: async () => { throw "string error"; },
    emitHandoffFn: async () => {}
  });

  const report = await manager.recoverInterruptedRuns();
  assert.equal(report.failed.length, 1);
  assert.ok(report.failed[0].outcome?.summary.includes("string error"));
});

test("RecoveryManager — workflow events are published to eventBus", async () => {
  const services = makeServices();
  await services.runCheckpointStore.save(makeRun({ id: "run_bus_1", status: "running" }));

  const publishedEvents = [];
  services.eventBus.subscribe("workflow", (e) => publishedEvents.push(e));

  const manager = new RecoveryManager(services, {
    recoverRunFn: async (_svc, r) => ({ ...r, status: "completed" }),
    emitHandoffFn: async () => {}
  });
  await manager.recoverInterruptedRuns();

  assert.ok(publishedEvents.length >= 1);
  const recovered = publishedEvents.find(e => e.type === "run_recovered");
  assert.ok(recovered);
  assert.equal(recovered.runId, "run_bus_1");
});
