import test from "node:test";
import assert from "node:assert/strict";

import { RunExecutor } from "../packages/runtime-core/dist/RunExecutor.js";

// --- Helpers ---

let idCounter = 0;

function makeRun(overrides = {}) {
  return {
    id: overrides.id ?? "run_1",
    taskIntentId: "intent_1",
    status: overrides.status ?? "running",
    goal: "Test task",
    source: overrides.source ?? "desktop",
    constraints: [],
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    checkpoint: {
      step: 0,
      stepCount: 0,
      browserSessionId: "sess_1",
      summary: "",
      lastKnownUrl: overrides.lastKnownUrl ?? "https://example.com",
      lastPageTitle: "Example",
      actionHistory: overrides.actionHistory ?? [],
      consecutiveSoftFailures: overrides.consecutiveSoftFailures ?? 0,
      totalSoftFailures: overrides.totalSoftFailures ?? 0,
      notes: [],
      urlVisitCounts: overrides.urlVisitCounts ?? {},
      ...overrides.checkpoint,
    },
    outcome: overrides.outcome,
    suspension: overrides.suspension,
  };
}

function makePageModel(overrides = {}) {
  return {
    id: overrides.id ?? `pm_${++idCounter}`,
    url: overrides.url ?? "https://example.com",
    title: overrides.title ?? "Example",
    summary: "A test page",
    elements: overrides.elements ?? [],
    visibleText: "",
    createdAt: new Date().toISOString(),
    forms: [],
    alerts: [],
    captchaDetected: false,
  };
}

function makeSession(overrides = {}) {
  return {
    id: overrides.id ?? "sess_1",
    state: "attached",
    profileId: "default",
  };
}

function makeServices(options = {}) {
  const appendedEvents = [];
  const savedRuns = [];
  const sentClarifications = [];
  const sentMessages = [];
  let stepIndex = 0;

  // decisions is an array; each call to planner.decide pops the next one
  const decisions = options.decisions ?? [];
  const capturePageModels = options.capturePageModels ?? [];
  const executeResults = options.executeResults ?? [];
  let captureIndex = 0;

  return {
    appendedEvents,
    savedRuns,
    sentClarifications,
    sentMessages,
    services: {
      browserKernel: {
        capturePageModel: async () => {
          const pm = capturePageModels[captureIndex] ?? makePageModel();
          captureIndex++;
          return pm;
        },
        executeAction: async (_session, action) => {
          const result = executeResults.shift() ?? {
            ok: true,
            summary: `Executed ${action.type}`,
          };
          return result;
        },
      },
      runCheckpointStore: {
        save: async (run) => { savedRuns.push({ ...run }); },
        load: async (id) => {
          // Return the latest saved run or the override
          if (options.loadOverride) return options.loadOverride(id);
          const saved = [...savedRuns].reverse().find(r => r.id === id);
          return saved ?? null;
        },
      },
      workflowLogStore: {
        append: async (event) => { appendedEvents.push(event); },
      },
      eventBus: {
        publish: async () => {},
      },
      orchestrator: {
        observePage: (run, pageModel, sessionId) => {
          stepIndex++;
          return {
            ...run,
            checkpoint: {
              ...run.checkpoint,
              step: stepIndex,
              stepCount: stepIndex,
              lastKnownUrl: pageModel.url,
              lastPageTitle: pageModel.title,
              lastPageModelId: pageModel.id,
            },
          };
        },
        applyPlannerDecision: (run, decision) => {
          if (decision.type === "task_complete") {
            return {
              ...run,
              status: "completed",
              outcome: { status: "completed", summary: decision.reasoning, finishedAt: new Date().toISOString() },
            };
          }
          if (decision.type === "task_failed") {
            return {
              ...run,
              status: "failed",
              outcome: { status: "failed", summary: decision.reasoning, finishedAt: new Date().toISOString() },
            };
          }
          if (decision.type === "clarification_request") {
            return {
              ...run,
              status: "suspended_for_clarification",
              suspension: { reason: "clarification", suspendedAt: new Date().toISOString() },
            };
          }
          if (decision.type === "approval_request") {
            return {
              ...run,
              status: "suspended_for_approval",
              suspension: { reason: "approval", suspendedAt: new Date().toISOString() },
            };
          }
          return run;
        },
        recordBrowserResult: (run, result) => ({
          ...run,
          checkpoint: {
            ...run.checkpoint,
            actionHistory: [
              ...(run.checkpoint.actionHistory ?? []),
              { type: "click", targetId: result.targetId, description: result.summary, url: result.url, ok: result.ok },
            ],
            consecutiveSoftFailures: result.ok ? 0 : (run.checkpoint.consecutiveSoftFailures ?? 0) + 1,
            totalSoftFailures: result.ok
              ? (run.checkpoint.totalSoftFailures ?? 0)
              : (run.checkpoint.totalSoftFailures ?? 0) + 1,
          },
        }),
        failRun: (run, summary) => ({
          ...run,
          status: "failed",
          outcome: { status: "failed", summary, finishedAt: new Date().toISOString() },
        }),
      },
      planner: {
        decide: async () => {
          const d = decisions.shift();
          if (!d) throw new Error("No more decisions available");
          return d;
        },
      },
      chatBridge: {
        sendClarification: async (clar) => { sentClarifications.push(clar); },
        shouldSendStepProgress: () => false,
        send: async (msg) => { sentMessages.push(msg); },
      },
      securityPolicy: {
        requiresApproval: () => options.requiresApproval ?? false,
        buildApprovalRequest: (run, action) => ({
          id: "approval_1",
          runId: run.id,
          question: `Approve ${action.type}?`,
          irreversibleActionSummary: action.description,
          action,
          createdAt: new Date().toISOString(),
        }),
      },
      descriptor: {
        planner: { mode: "stub", detail: "test" },
      },
    },
  };
}

function makeSessions() {
  return {}; // SessionManager mock — not directly called by plannerLoop
}

function makeCancellation(options = {}) {
  const cancelled = new Set(options.cancelledIds ?? []);
  const acknowledged = [];
  return {
    isCancelled: (id) => cancelled.has(id),
    acknowledge: (id) => { cancelled.delete(id); acknowledged.push(id); },
    acknowledged,
  };
}

function makeHandoff() {
  const handoffs = [];
  return {
    writeHandoff: async (run) => { handoffs.push(run); },
    handoffs,
  };
}

// --- plannerLoop: task_complete ---

test("plannerLoop completes on task_complete decision", async () => {
  const { services, appendedEvents } = makeServices({
    decisions: [{ type: "task_complete", reasoning: "All done" }],
  });
  const cancellation = makeCancellation();
  const handoff = makeHandoff();
  const executor = new RunExecutor(services, makeSessions(), cancellation, handoff);

  const result = await executor.plannerLoop(makeRun(), makeSession());

  assert.equal(result.status, "completed");
  assert.ok(handoff.handoffs.length >= 1);
  assert.ok(appendedEvents.some(e => e.type === "run_completed"));
});

// --- plannerLoop: task_failed ---

test("plannerLoop fails on task_failed decision", async () => {
  const { services } = makeServices({
    decisions: [{ type: "task_failed", reasoning: "Cannot proceed" }],
  });
  const cancellation = makeCancellation();
  const handoff = makeHandoff();
  const executor = new RunExecutor(services, makeSessions(), cancellation, handoff);

  const result = await executor.plannerLoop(makeRun(), makeSession());

  assert.equal(result.status, "failed");
  assert.ok(handoff.handoffs.length >= 1);
});

// --- plannerLoop: clarification_request ---

test("plannerLoop suspends on clarification_request", async () => {
  const { services, sentClarifications } = makeServices({
    decisions: [{
      type: "clarification_request",
      reasoning: "Need input",
      clarificationRequest: {
        id: "clar_1",
        runId: "run_1",
        question: "Which option?",
        contextSummary: "Choosing",
        options: [{ id: "a", label: "A", summary: "Option A" }],
        createdAt: new Date().toISOString(),
      },
    }],
  });
  const cancellation = makeCancellation();
  const handoff = makeHandoff();
  const executor = new RunExecutor(services, makeSessions(), cancellation, handoff);

  const result = await executor.plannerLoop(makeRun(), makeSession());

  assert.equal(result.status, "suspended_for_clarification");
  assert.equal(sentClarifications.length, 1);
  assert.equal(sentClarifications[0].question, "Which option?");
});

// --- plannerLoop: planner error ---

test("plannerLoop fails when planner throws an error", async () => {
  const { services, appendedEvents } = makeServices({
    decisions: [], // empty = throws "No more decisions available"
  });
  const cancellation = makeCancellation();
  const handoff = makeHandoff();
  const executor = new RunExecutor(services, makeSessions(), cancellation, handoff);

  const result = await executor.plannerLoop(makeRun(), makeSession());

  assert.equal(result.status, "failed");
  assert.ok(result.outcome.summary.includes("Planner request failed"));
  assert.ok(appendedEvents.some(e => e.type === "planner_request_failed"));
  assert.ok(handoff.handoffs.length >= 1);
});

// --- plannerLoop: browser_action success ---

test("plannerLoop executes browser_action and continues", async () => {
  const { services, appendedEvents } = makeServices({
    decisions: [
      { type: "browser_action", reasoning: "Click button", action: { type: "click", targetId: "btn_1", description: "Click submit" } },
      { type: "task_complete", reasoning: "Done" },
    ],
    executeResults: [{ ok: true, summary: "Clicked submit" }],
  });
  const cancellation = makeCancellation();
  const handoff = makeHandoff();
  const executor = new RunExecutor(services, makeSessions(), cancellation, handoff);

  const result = await executor.plannerLoop(makeRun(), makeSession());

  assert.equal(result.status, "completed");
  assert.ok(appendedEvents.some(e => e.type === "browser_action_executed"));
});

// --- plannerLoop: cooperative cancellation ---

test("plannerLoop returns early when cancellation is set before first step", async () => {
  const { services } = makeServices({
    decisions: [{ type: "task_complete", reasoning: "Done" }],
  });
  const cancellation = makeCancellation({ cancelledIds: ["run_1"] });
  const handoff = makeHandoff();
  const executor = new RunExecutor(services, makeSessions(), cancellation, handoff);

  const result = await executor.plannerLoop(makeRun(), makeSession());

  // Should return without running the planner
  assert.ok(cancellation.acknowledged.includes("run_1"));
  // Handoff should NOT have been called (cancellation returns early)
  assert.equal(handoff.handoffs.length, 0);
});

// --- plannerLoop: MAX_LOOP_STEPS exceeded ---

test("plannerLoop fails after exceeding max steps", async () => {
  // Create 36 browser_action decisions (max is 35) — unique targetIds/descriptions/urls to avoid stuck detection
  const decisions = Array.from({ length: 36 }, (_, i) => ({
    type: "browser_action",
    reasoning: `Step ${i}`,
    action: { type: "click", targetId: `btn_${i}`, description: `Click button ${i}` },
  }));
  const executeResults = Array.from({ length: 36 }, (_, i) => ({ ok: true, summary: `ok ${i}`, targetId: `btn_${i}`, url: `https://example.com/page${i}` }));
  // Unique page models per step to avoid URL visit count stuck detection
  const capturePageModels = Array.from({ length: 36 }, (_, i) =>
    makePageModel({ url: `https://example.com/page${i}`, title: `Page ${i}` })
  );

  const { services } = makeServices({ decisions, executeResults, capturePageModels });
  const cancellation = makeCancellation();
  const handoff = makeHandoff();
  const executor = new RunExecutor(services, makeSessions(), cancellation, handoff);

  const result = await executor.plannerLoop(makeRun(), makeSession());

  assert.equal(result.status, "failed");
  assert.ok(result.outcome.summary.includes("exceeded"), `Expected "exceeded" in: "${result.outcome.summary}"`);
});

// --- plannerLoop: approval gate ---

test("plannerLoop suspends for approval when security policy requires it", async () => {
  const { services, sentClarifications } = makeServices({
    decisions: [
      { type: "browser_action", reasoning: "Buy item", action: { type: "click", targetId: "buy_btn", description: "Purchase item" } },
    ],
    requiresApproval: true,
  });
  const cancellation = makeCancellation();
  const handoff = makeHandoff();
  const executor = new RunExecutor(services, makeSessions(), cancellation, handoff);

  const result = await executor.plannerLoop(makeRun(), makeSession());

  assert.equal(result.status, "suspended_for_approval");
  assert.equal(sentClarifications.length, 1);
  assert.ok(sentClarifications[0].question.includes("Approve"));
});

// --- plannerLoop: hard browser action failure ---

test("plannerLoop fails on hard browser action failure", async () => {
  const { services } = makeServices({
    decisions: [
      { type: "browser_action", reasoning: "Click", action: { type: "click", targetId: "btn", description: "Submit" } },
    ],
    executeResults: [{ ok: false, summary: "Permission denied", failureClass: "permission_error" }],
  });
  const cancellation = makeCancellation();
  const handoff = makeHandoff();
  const executor = new RunExecutor(services, makeSessions(), cancellation, handoff);

  const result = await executor.plannerLoop(makeRun(), makeSession());

  assert.equal(result.status, "failed");
  assert.ok(handoff.handoffs.length >= 1);
});

// --- plannerLoop: soft failure continues ---

test("plannerLoop continues on element_not_found soft failure", async () => {
  const { services } = makeServices({
    decisions: [
      { type: "browser_action", reasoning: "Click", action: { type: "click", targetId: "btn", description: "Try click" } },
      { type: "task_complete", reasoning: "Done" },
    ],
    executeResults: [
      { ok: false, summary: "Element not found", failureClass: "element_not_found" },
    ],
  });
  const cancellation = makeCancellation();
  const handoff = makeHandoff();
  const executor = new RunExecutor(services, makeSessions(), cancellation, handoff);

  const result = await executor.plannerLoop(makeRun(), makeSession());

  assert.equal(result.status, "completed");
});

// --- plannerLoop: max consecutive soft failures ---

test("plannerLoop fails after max consecutive soft failures", async () => {
  const { services } = makeServices({
    decisions: [
      { type: "browser_action", reasoning: "Click", action: { type: "click", targetId: "btn", description: "Try" } },
    ],
    executeResults: [{ ok: false, summary: "Not found", failureClass: "element_not_found" }],
  });
  const cancellation = makeCancellation();
  const handoff = makeHandoff();
  const executor = new RunExecutor(services, makeSessions(), cancellation, handoff);

  // Start with 4 consecutive soft failures already (max is 5)
  const run = makeRun({ consecutiveSoftFailures: 4 });
  const result = await executor.plannerLoop(run, makeSession());

  assert.equal(result.status, "failed");
  assert.ok(result.outcome.summary.includes("Stuck"));
  assert.ok(result.outcome.summary.includes("soft failures"));
});

// --- plannerLoop: max total soft failures ---

test("plannerLoop fails after max total soft failures", async () => {
  const { services } = makeServices({
    decisions: [
      { type: "browser_action", reasoning: "Click", action: { type: "click", targetId: "btn", description: "Try" } },
    ],
    executeResults: [{ ok: false, summary: "Not found", failureClass: "element_not_found" }],
  });
  const cancellation = makeCancellation();
  const handoff = makeHandoff();
  const executor = new RunExecutor(services, makeSessions(), cancellation, handoff);

  // Start with 7 total soft failures already (max is 8)
  const run = makeRun({ totalSoftFailures: 7 });
  const result = await executor.plannerLoop(run, makeSession());

  assert.equal(result.status, "failed");
  assert.ok(result.outcome.summary.includes("Too many failures"));
});

// --- plannerLoop: session lost ---

test("plannerLoop fails when browser session is lost", async () => {
  const { services } = makeServices({
    decisions: [
      { type: "browser_action", reasoning: "Click", action: { type: "click", targetId: "btn", description: "Submit" } },
    ],
  });
  // Override executeAction to throw session not found
  services.browserKernel.executeAction = async () => { throw new Error("Session not found: sess_1"); };
  const cancellation = makeCancellation();
  const handoff = makeHandoff();
  const executor = new RunExecutor(services, makeSessions(), cancellation, handoff);

  const result = await executor.plannerLoop(makeRun(), makeSession());

  assert.equal(result.status, "failed");
  assert.ok(result.outcome.summary.includes("Browser session lost"));
});

// --- plannerLoop: recovery context cleared after first planner call ---

test("plannerLoop clears recovery context after first planner call", async () => {
  const { services, savedRuns } = makeServices({
    decisions: [{ type: "task_complete", reasoning: "Done" }],
  });
  const cancellation = makeCancellation();
  const handoff = makeHandoff();
  const executor = new RunExecutor(services, makeSessions(), cancellation, handoff);

  const run = makeRun({
    checkpoint: {
      recoveryContext: {
        recoveredAt: new Date().toISOString(),
        preInterruptionPageTitle: "Old page",
      },
    },
  });
  await executor.plannerLoop(run, makeSession());

  // One of the saved runs should have recoveryContext cleared
  const clearedRun = savedRuns.find(r => r.checkpoint.recoveryContext === undefined);
  assert.ok(clearedRun, "recovery context should be cleared after first planner call");
});

// --- continueResume ---

test("continueResume navigates to lastKnownUrl and enters plannerLoop", async () => {
  const navigateActions = [];
  const { services } = makeServices({
    decisions: [{ type: "task_complete", reasoning: "Done" }],
    executeResults: [{ ok: true, summary: "Navigated" }],
  });
  const origExecuteAction = services.browserKernel.executeAction;
  services.browserKernel.executeAction = async (session, action) => {
    navigateActions.push(action);
    return origExecuteAction(session, action);
  };
  const cancellation = makeCancellation();
  const handoff = makeHandoff();
  const executor = new RunExecutor(services, makeSessions(), cancellation, handoff);

  const run = makeRun({ lastKnownUrl: "https://example.com/page" });
  const result = await executor.continueResume(run, makeSession());

  assert.ok(navigateActions[0].type === "navigate");
  assert.ok(navigateActions[0].value === "https://example.com/page");
  assert.equal(result.status, "completed");
});

test("continueResume executes pending action before plannerLoop", async () => {
  const { services } = makeServices({
    decisions: [{ type: "task_complete", reasoning: "Done" }],
    executeResults: [
      { ok: true, summary: "Navigated" },
      { ok: true, summary: "Clicked pending button" },
    ],
  });
  const cancellation = makeCancellation();
  const handoff = makeHandoff();
  const executor = new RunExecutor(services, makeSessions(), cancellation, handoff);

  const pendingAction = { type: "click", targetId: "btn_pending", description: "Pending click" };
  const result = await executor.continueResume(makeRun(), makeSession(), pendingAction);

  assert.equal(result.status, "completed");
});

test("continueResume fails if pending action fails", async () => {
  const { services } = makeServices({
    decisions: [],
    executeResults: [
      { ok: true, summary: "Navigated" },
      { ok: false, summary: "Click failed" },
    ],
  });
  const cancellation = makeCancellation();
  const handoff = makeHandoff();
  const executor = new RunExecutor(services, makeSessions(), cancellation, handoff);

  const pendingAction = { type: "click", targetId: "btn_pending", description: "Pending click" };
  const result = await executor.continueResume(makeRun(), makeSession(), pendingAction);

  assert.equal(result.status, "failed");
  assert.ok(handoff.handoffs.length >= 1);
});

test("continueResume injects recovery context", async () => {
  const { services, savedRuns } = makeServices({
    decisions: [{ type: "task_complete", reasoning: "Done" }],
    executeResults: [{ ok: true, summary: "Navigated" }],
  });
  const cancellation = makeCancellation();
  const handoff = makeHandoff();
  const executor = new RunExecutor(services, makeSessions(), cancellation, handoff);

  const run = makeRun({
    checkpoint: {
      lastPageModelSnapshot: {
        title: "Snapshot Title",
        summary: "Snapshot Summary",
        visibleText: "Hello",
        scrollY: 100,
        formValues: { email: "test@test.com" },
      },
    },
  });
  await executor.continueResume(run, makeSession());

  // First saved run should have recovery context with snapshot data
  const withRecovery = savedRuns.find(r => r.checkpoint.recoveryContext);
  assert.ok(withRecovery);
  assert.equal(withRecovery.checkpoint.recoveryContext.preInterruptionPageTitle, "Snapshot Title");
  assert.equal(withRecovery.checkpoint.recoveryContext.preInterruptionPageSummary, "Snapshot Summary");
});
