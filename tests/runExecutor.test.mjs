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

test("continueResume fails if pending action has hard failure", async () => {
  const { services } = makeServices({
    decisions: [],
    executeResults: [
      { ok: true, summary: "Navigated" },
      { ok: false, summary: "Click failed", failureClass: "interaction_failed" },
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

test("continueResume recovers from pending action element_not_found (soft failure)", async () => {
  const { services, savedRuns } = makeServices({
    decisions: [{ type: "task_complete", reasoning: "Done after recovery" }],
    executeResults: [
      { ok: true, summary: "Navigated" },
      { ok: false, summary: "Element not found after resume", failureClass: "element_not_found" },
    ],
  });
  const cancellation = makeCancellation();
  const handoff = makeHandoff();
  const executor = new RunExecutor(services, makeSessions(), cancellation, handoff);

  const pendingAction = { type: "click", targetId: "btn_gone", description: "Click vanished button" };
  const result = await executor.continueResume(makeRun(), makeSession(), pendingAction);

  // Should NOT fail — soft failure continues to planner loop
  assert.equal(result.status, "completed");
  // The note about the soft failure should be in the checkpoint
  const runWithNote = savedRuns.find(r => r.checkpoint.notes.some(n => n.includes("element_not_found")));
  assert.ok(runWithNote, "Should have a note about the soft failure");
});

test("continueResume recovers from pending action network_error (soft failure)", async () => {
  const { services } = makeServices({
    decisions: [{ type: "task_complete", reasoning: "Done" }],
    executeResults: [
      { ok: true, summary: "Navigated" },
      { ok: false, summary: "Network timeout", failureClass: "network_error" },
    ],
  });
  const cancellation = makeCancellation();
  const handoff = makeHandoff();
  const executor = new RunExecutor(services, makeSessions(), cancellation, handoff);

  const pendingAction = { type: "click", targetId: "btn_net", description: "Click with network issue" };
  const result = await executor.continueResume(makeRun(), makeSession(), pendingAction);

  assert.equal(result.status, "completed");
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

test("continueResume skips navigate when no lastKnownUrl", async () => {
  const navigateActions = [];
  const { services } = makeServices({
    decisions: [{ type: "task_complete", reasoning: "Done" }],
  });
  const origExecute = services.browserKernel.executeAction;
  services.browserKernel.executeAction = async (session, action) => {
    navigateActions.push(action);
    return origExecute(session, action);
  };
  const cancellation = makeCancellation();
  const handoff = makeHandoff();
  const executor = new RunExecutor(services, makeSessions(), cancellation, handoff);

  // Run with no lastKnownUrl (and no pending action) — should skip navigate and go straight to plannerLoop
  const run = makeRun({ lastKnownUrl: undefined });
  run.checkpoint.lastKnownUrl = undefined;
  const result = await executor.continueResume(run, makeSession());

  // No navigate actions should have been called
  const navActions = navigateActions.filter(a => a.type === "navigate");
  assert.equal(navActions.length, 0);
  assert.equal(result.status, "completed");
});

// --- plannerLoop: consecutive identical action stuck detection ---

test("plannerLoop fails after MAX_CONSECUTIVE_IDENTICAL_ACTIONS identical actions", async () => {
  // MAX_CONSECUTIVE_IDENTICAL_ACTIONS = 8. The actionKey counter starts at 0, first match at step 2,
  // reaches 8 at step 9. Cycle detection triggers at 8 identical history entries (step 8).
  // To avoid cycle detection firing first, override recordBrowserResult to record
  // DIFFERENT history entries (varying url) while the real actionKey stays constant.
  const count = 10;
  const decisions = Array.from({ length: count }, () => ({
    type: "browser_action",
    reasoning: "Click same button",
    action: { type: "click", targetId: "btn_same", description: "Same click" },
  }));
  const executeResults = Array.from({ length: count }, () => ({
    ok: true, summary: "Clicked",
  }));
  const capturePageModels = Array.from({ length: count }, () =>
    makePageModel({ url: "https://example.com" })
  );

  const { services } = makeServices({ decisions, executeResults, capturePageModels });

  // Override recordBrowserResult to produce unique history entries per step
  // so cycle detection doesn't fire, while the actionKey (from action params + pageModel.url) stays the same
  let recordCount = 0;
  services.orchestrator.recordBrowserResult = (run, result) => ({
    ...run,
    checkpoint: {
      ...run.checkpoint,
      actionHistory: [
        ...(run.checkpoint.actionHistory ?? []),
        {
          step: (run.checkpoint.actionHistory?.length ?? 0) + 1,
          type: "click",
          targetId: "btn_same",
          description: `Unique description ${++recordCount}`,
          url: `https://example.com/page${recordCount}`,
          ok: true,
        },
      ],
      consecutiveSoftFailures: 0,
      totalSoftFailures: run.checkpoint.totalSoftFailures ?? 0,
    },
  });

  const cancellation = makeCancellation();
  const handoff = makeHandoff();
  const executor = new RunExecutor(services, makeSessions(), cancellation, handoff);

  const result = await executor.plannerLoop(makeRun(), makeSession());

  assert.equal(result.status, "failed");
  assert.ok(result.outcome.summary.includes("repeated"), `Expected "repeated" in: "${result.outcome.summary}"`);
  assert.ok(handoff.handoffs.length >= 1);
});

// --- plannerLoop: URL visit count stuck detection ---

test("plannerLoop fails when URL visit count exceeds MAX_URL_VISITS_BEFORE_FAIL", async () => {
  // MAX_URL_VISITS_BEFORE_FAIL = 12. Pre-populate urlVisitCounts at the limit.
  const decisions = [
    { type: "browser_action", reasoning: "Click", action: { type: "click", targetId: "btn_1", description: "Click" } },
  ];
  const executeResults = [{ ok: true, summary: "Clicked", targetId: "btn_1", url: "https://example.com" }];

  const { services } = makeServices({ decisions, executeResults });
  const cancellation = makeCancellation();
  const handoff = makeHandoff();
  const executor = new RunExecutor(services, makeSessions(), cancellation, handoff);

  const run = makeRun({ urlVisitCounts: { "https://example.com": 12 } });
  const result = await executor.plannerLoop(run, makeSession());

  assert.equal(result.status, "failed");
  assert.ok(result.outcome.summary.includes("visited"), `Expected "visited" in: "${result.outcome.summary}"`);
  assert.ok(handoff.handoffs.length >= 1);
});

// --- plannerLoop: cycle detection integration ---

test("plannerLoop fails when action history forms a 2-step cycle", async () => {
  // 2-step cycle requires 4 full repetitions = 8 entries. Pre-populate 7, let the 8th complete the cycle.
  const cycleHistory = [];
  for (let i = 0; i < 7; i++) {
    const isA = i % 2 === 0;
    cycleHistory.push({
      step: i + 1,
      type: isA ? "click" : "navigate",
      targetId: isA ? "btn_a" : "",
      description: isA ? "Click A" : "Go to B",
      targetUrl: isA ? undefined : "https://example.com/b",
      url: isA ? "https://example.com/a" : "https://example.com/b",
      ok: true,
    });
  }

  // The 8th action should be click on btn_a (even index = 0-based entry 7 → i%2==1 → actually it's navigate)
  // Entry 7 (0-based) has i%2=1 → navigate. Wait, the cycle is click/navigate alternating.
  // Entries 0,2,4,6 → click:btn_a:Click A:https://example.com/a (via url fallback since targetUrl undefined)
  // Entries 1,3,5 → navigate::Go to B:https://example.com/b (via targetUrl)
  // After 7 entries: [click, nav, click, nav, click, nav, click]
  // Need 8th to be: navigate (index 7, i%2=1)
  // Pattern: [click,nav] repeated 4 times = 8 total

  const decisions = [
    {
      type: "browser_action",
      reasoning: "Go to B",
      action: { type: "navigate", value: "https://example.com/b", description: "Go to B" },
    },
  ];
  const executeResults = [{ ok: true, summary: "Go to B", targetId: "", url: "https://example.com/b" }];

  const { services } = makeServices({ decisions, executeResults });
  // Override recordBrowserResult to add the right entry for cycle detection
  services.orchestrator.recordBrowserResult = (run, result) => ({
    ...run,
    checkpoint: {
      ...run.checkpoint,
      actionHistory: [
        ...(run.checkpoint.actionHistory ?? []),
        {
          step: (run.checkpoint.actionHistory?.length ?? 0) + 1,
          type: "navigate",
          targetId: "",
          description: "Go to B",
          targetUrl: "https://example.com/b",
          ok: true,
        },
      ],
      consecutiveSoftFailures: 0,
      totalSoftFailures: run.checkpoint.totalSoftFailures ?? 0,
    },
  });

  const cancellation = makeCancellation();
  const handoff = makeHandoff();
  const executor = new RunExecutor(services, makeSessions(), cancellation, handoff);

  const run = makeRun({ actionHistory: cycleHistory });
  const result = await executor.plannerLoop(run, makeSession());

  assert.equal(result.status, "failed");
  assert.ok(result.outcome.summary.includes("cycle"), `Expected "cycle" in: "${result.outcome.summary}"`);
});

// --- plannerLoop: capturePageModel retry on first failure ---

test("plannerLoop retries capturePageModel on first failure and succeeds", async () => {
  let captureCallCount = 0;
  const decisions = [{ type: "task_complete", reasoning: "Done" }];
  const { services } = makeServices({ decisions });

  // Override capturePageModel: fail first call, succeed second
  services.browserKernel.capturePageModel = async () => {
    captureCallCount++;
    if (captureCallCount === 1) {
      throw new Error("CDP disconnected");
    }
    return makePageModel();
  };

  const cancellation = makeCancellation();
  const handoff = makeHandoff();
  const executor = new RunExecutor(services, makeSessions(), cancellation, handoff);

  const result = await executor.plannerLoop(makeRun(), makeSession());

  assert.equal(result.status, "completed");
  assert.equal(captureCallCount, 2, "Should have tried capturePageModel twice");
});

// --- plannerLoop: capturePageModel fallback when both attempts fail ---

test("plannerLoop uses fallback page model when capturePageModel fails twice", async () => {
  const decisions = [{ type: "task_complete", reasoning: "Done despite capture failure" }];
  const { services, appendedEvents } = makeServices({ decisions });

  // Override capturePageModel: always fail
  services.browserKernel.capturePageModel = async () => {
    throw new Error("CDP gone");
  };

  const cancellation = makeCancellation();
  const handoff = makeHandoff();
  const executor = new RunExecutor(services, makeSessions(), cancellation, handoff);

  const result = await executor.plannerLoop(makeRun(), makeSession());

  assert.equal(result.status, "completed");
  // Should have logged a capture failure event
  assert.ok(appendedEvents.some(e => e.type === "planner_request_failed" && e.summary.includes("capturePageModel")));
});

// --- plannerLoop: cancellation detected after planner call ---

test("plannerLoop detects cancellation after planner decision", async () => {
  let plannerCallCount = 0;
  const { services } = makeServices({ decisions: [] });

  // Override planner to set cancellation after first call
  const cancellation = makeCancellation();
  services.planner.decide = async () => {
    plannerCallCount++;
    // Set cancellation flag during the planner call
    cancellation.isCancelled = (id) => id === "run_1" && plannerCallCount >= 1;
    return { type: "browser_action", reasoning: "Click", action: { type: "click", targetId: "btn", description: "Click" } };
  };

  cancellation.acknowledge = (id) => { cancellation.acknowledged = cancellation.acknowledged || []; cancellation.acknowledged.push(id); };
  cancellation.acknowledged = [];

  const handoff = makeHandoff();
  const executor = new RunExecutor(services, makeSessions(), cancellation, handoff);

  const result = await executor.plannerLoop(makeRun(), makeSession());

  // Should have acknowledged cancellation
  assert.ok(cancellation.acknowledged.includes("run_1"));
  // Handoff should NOT be called for cancellation
  assert.equal(handoff.handoffs.length, 0);
});

// --- plannerLoop: checkpoint-based cancellation ---

test("plannerLoop returns early when checkpoint shows run cancelled", async () => {
  const decisions = [
    { type: "browser_action", reasoning: "Click", action: { type: "click", targetId: "btn", description: "Click" } },
  ];
  const executeResults = [{ ok: true, summary: "Clicked" }];

  const { services } = makeServices({ decisions, executeResults });

  // Override runCheckpointStore.load to return a cancelled run after planner call
  let loadCallCount = 0;
  services.runCheckpointStore.load = async (id) => {
    loadCallCount++;
    // After the first load (which happens after planner decision), return cancelled
    return {
      ...makeRun({ status: "cancelled" }),
      id,
      status: "cancelled",
      outcome: { status: "cancelled", summary: "User cancelled", finishedAt: new Date().toISOString() },
    };
  };

  const cancellation = makeCancellation();
  const handoff = makeHandoff();
  const executor = new RunExecutor(services, makeSessions(), cancellation, handoff);

  const result = await executor.plannerLoop(makeRun(), makeSession());

  assert.equal(result.status, "cancelled");
});

// --- plannerLoop: step progress sending ---

test("plannerLoop sends step progress when chatBridge.shouldSendStepProgress returns true", async () => {
  const { services, sentMessages } = makeServices({
    decisions: [
      { type: "browser_action", reasoning: "Click", action: { type: "click", targetId: "btn_1", description: "Click submit" } },
      { type: "task_complete", reasoning: "Done" },
    ],
    executeResults: [{ ok: true, summary: "Clicked submit" }],
  });

  // Enable step progress
  services.chatBridge.shouldSendStepProgress = () => true;

  const cancellation = makeCancellation();
  const handoff = makeHandoff();
  const executor = new RunExecutor(services, makeSessions(), cancellation, handoff);

  const result = await executor.plannerLoop(makeRun(), makeSession());

  assert.equal(result.status, "completed");
  // Should have sent at least one step progress message
  assert.ok(sentMessages.length >= 1, "Expected at least 1 step progress message");
  assert.ok(sentMessages[0].text.includes("Step"));
  assert.equal(sentMessages[0].channel, "telegram");
});

// --- plannerLoop: network_error treated as soft failure ---

test("plannerLoop continues on network_error soft failure", async () => {
  const { services } = makeServices({
    decisions: [
      { type: "browser_action", reasoning: "Navigate", action: { type: "navigate", value: "https://example.com", description: "Go" } },
      { type: "task_complete", reasoning: "Done" },
    ],
    executeResults: [
      { ok: false, summary: "Network error", failureClass: "network_error" },
    ],
  });
  const cancellation = makeCancellation();
  const handoff = makeHandoff();
  const executor = new RunExecutor(services, makeSessions(), cancellation, handoff);

  const result = await executor.plannerLoop(makeRun(), makeSession());

  assert.equal(result.status, "completed");
});
