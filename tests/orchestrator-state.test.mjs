import test from "node:test";
import assert from "node:assert/strict";

import { TaskOrchestrator, DefaultClarificationPolicy } from "../packages/orchestrator/dist/index.js";

function makeOrchestrator() {
  return new TaskOrchestrator({ clarificationPolicy: new DefaultClarificationPolicy() });
}

function makeRun(overrides = {}) {
  return {
    id: "run_intent_1",
    taskIntentId: "intent_1",
    status: "running",
    goal: "Book a flight",
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

function makePageModel(overrides = {}) {
  return {
    id: "pm_1",
    url: "https://example.com",
    title: "Example",
    summary: "An example page",
    elements: [],
    visibleText: "Hello world",
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// observePage
// ---------------------------------------------------------------------------

test("observePage populates lastPageModelSnapshot with form values", () => {
  const orch = makeOrchestrator();
  const pm = makePageModel({
    title: "Checkout",
    summary: "Payment form",
    visibleText: "Enter your details",
    scrollY: 300,
    elements: [
      { id: "input_name", role: "textbox", label: "Name", value: "Alice", isActionable: true, inputType: "text" },
      { id: "input_email", role: "textbox", label: "Email", value: "alice@test.com", isActionable: true, inputType: "email" }
    ]
  });

  const updated = orch.observePage(makeRun(), pm);
  const snap = updated.checkpoint.lastPageModelSnapshot;

  assert.equal(snap.title, "Checkout");
  assert.equal(snap.summary, "Payment form");
  assert.equal(snap.visibleText, "Enter your details");
  assert.deepEqual(snap.formValues, { input_name: "Alice", input_email: "alice@test.com" });
  assert.equal(snap.scrollY, 300);
});

test("observePage caps form values at 20 entries", () => {
  const orch = makeOrchestrator();
  const elements = Array.from({ length: 25 }, (_, i) => ({
    id: `input_${i}`,
    role: "textbox",
    label: `Field ${i}`,
    value: `val_${i}`,
    isActionable: true,
    inputType: "text"
  }));

  const updated = orch.observePage(makeRun(), makePageModel({ elements }));
  assert.equal(Object.keys(updated.checkpoint.lastPageModelSnapshot.formValues).length, 20);
});

test("observePage only captures inputs with value", () => {
  const orch = makeOrchestrator();
  const pm = makePageModel({
    elements: [
      { id: "e1", role: "button", label: "Submit", isActionable: true },
      { id: "e2", role: "textbox", label: "Empty", isActionable: true, inputType: "text" },
      { id: "e3", role: "link", label: "Link", isActionable: true, href: "https://example.com" }
    ]
  });

  const updated = orch.observePage(makeRun(), pm);
  assert.equal(updated.checkpoint.lastPageModelSnapshot.formValues, undefined);
});

test("observePage increments stepCount", () => {
  const orch = makeOrchestrator();
  const run = makeRun();
  const pm = makePageModel();

  const after1 = orch.observePage(run, pm);
  assert.equal(after1.checkpoint.stepCount, 1);

  const after2 = orch.observePage(after1, pm);
  assert.equal(after2.checkpoint.stepCount, 2);
});

// ---------------------------------------------------------------------------
// applyPlannerDecision
// ---------------------------------------------------------------------------

test("applyPlannerDecision with approval_request suspends run", () => {
  const orch = makeOrchestrator();
  const run = makeRun();

  const action = { type: "click", targetId: "btn_buy", description: "Buy now" };
  const suspended = orch.applyPlannerDecision(run, {
    type: "approval_request",
    reasoning: "About to purchase",
    action,
    approvalRequest: {
      id: "ap_1",
      runId: run.id,
      question: "Approve purchase?",
      irreversibleActionSummary: "Will charge $50",
      createdAt: "2026-03-15T00:00:00Z"
    }
  });

  assert.equal(suspended.status, "suspended_for_approval");
  assert.equal(suspended.checkpoint.pendingApprovalId, "ap_1");
  assert.deepEqual(suspended.checkpoint.pendingBrowserAction, action);
  assert.equal(suspended.suspension.type, "approval");
});

test("applyPlannerDecision with task_complete sets outcome", () => {
  const orch = makeOrchestrator();
  const completed = orch.applyPlannerDecision(makeRun(), {
    type: "task_complete",
    reasoning: "Done",
    completionSummary: "Flight booked"
  });

  assert.equal(completed.status, "completed");
  assert.equal(completed.outcome.status, "completed");
  assert.equal(completed.outcome.summary, "Flight booked");
});

test("applyPlannerDecision with task_failed sets outcome", () => {
  const orch = makeOrchestrator();
  const failed = orch.applyPlannerDecision(makeRun(), {
    type: "task_failed",
    reasoning: "Cannot proceed",
    failureSummary: "Login wall"
  });

  assert.equal(failed.status, "failed");
  assert.equal(failed.outcome.status, "failed");
  assert.equal(failed.outcome.summary, "Login wall");
});

// ---------------------------------------------------------------------------
// recordBrowserResult
// ---------------------------------------------------------------------------

test("recordBrowserResult tracks actionHistory (max 10)", () => {
  const orch = makeOrchestrator();
  let run = makeRun();

  for (let i = 0; i < 12; i++) {
    run = orch.recordBrowserResult(run, {
      ok: true,
      action: { type: "click", description: `Click button ${i}` },
      summary: `Clicked ${i}`
    });
  }

  assert.equal(run.checkpoint.actionHistory.length, 10);
  // Oldest two (0,1) should be dropped
  assert.equal(run.checkpoint.actionHistory[0].description, "Click button 2");
  assert.equal(run.checkpoint.actionHistory[9].description, "Click button 11");
});

test("recordBrowserResult tracks consecutive soft failures", () => {
  const orch = makeOrchestrator();
  let run = makeRun();

  // Two element_not_found failures
  run = orch.recordBrowserResult(run, {
    ok: false,
    action: { type: "click", description: "Click missing" },
    summary: "Not found",
    failureClass: "element_not_found"
  });
  assert.equal(run.checkpoint.consecutiveSoftFailures, 1);

  run = orch.recordBrowserResult(run, {
    ok: false,
    action: { type: "click", description: "Click missing again" },
    summary: "Not found",
    failureClass: "element_not_found"
  });
  assert.equal(run.checkpoint.consecutiveSoftFailures, 2);

  // Success resets counter
  run = orch.recordBrowserResult(run, {
    ok: true,
    action: { type: "click", description: "Click found" },
    summary: "Clicked"
  });
  assert.equal(run.checkpoint.consecutiveSoftFailures, 0);
});

// ---------------------------------------------------------------------------
// resumeFromApproval
// ---------------------------------------------------------------------------

test("resumeFromApproval clears suspension and pending action", () => {
  const orch = makeOrchestrator();
  const run = makeRun();

  // First suspend
  const suspended = orch.applyPlannerDecision(run, {
    type: "approval_request",
    reasoning: "Need approval",
    action: { type: "click", description: "Buy" },
    approvalRequest: {
      id: "ap_1",
      runId: run.id,
      question: "Approve?",
      irreversibleActionSummary: "Purchase",
      createdAt: "2026-03-15T00:00:00Z"
    }
  });

  assert.equal(suspended.status, "suspended_for_approval");

  // Then resume
  const resumed = orch.resumeFromApproval(suspended, true);

  assert.equal(resumed.status, "running");
  assert.equal(resumed.suspension, undefined);
  assert.equal(resumed.checkpoint.pendingApprovalId, undefined);
});
