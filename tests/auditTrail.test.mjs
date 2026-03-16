import test from "node:test";
import assert from "node:assert/strict";

import { AuditTrail } from "../packages/observability/dist/AuditTrail.js";

// --- Helper: mock WorkflowLogReader ---

function makeReader(eventsByRun) {
  return {
    async listByRun(runId) {
      return eventsByRun[runId] ?? [];
    }
  };
}

function makeEvent(overrides = {}) {
  return {
    id: "evt_1",
    runId: "run_1",
    type: "browser_action_executed",
    summary: "Clicked button",
    createdAt: "2026-03-16T10:00:00.000Z",
    payload: {},
    ...overrides
  };
}

// ========================================
// generateRunSummary
// ========================================

test("AuditTrail.generateRunSummary: empty events returns zero-value summary", async () => {
  const trail = new AuditTrail(makeReader({}));
  const summary = await trail.generateRunSummary("run_x");
  assert.equal(summary.runId, "run_x");
  assert.equal(summary.status, "unknown");
  assert.equal(summary.goal, "");
  assert.equal(summary.durationMs, 0);
  assert.equal(summary.totalSteps, 0);
  assert.equal(summary.browserActions, 0);
  assert.equal(summary.clarificationsRequested, 0);
  assert.equal(summary.clarificationsAnswered, 0);
  assert.equal(summary.approvalsRequested, 0);
  assert.equal(summary.approvalsAnswered, 0);
  assert.equal(summary.pagesModeled, 0);
  assert.equal(summary.recoveryEvents, 0);
  assert.equal(summary.startedAt, "");
  assert.equal(summary.endedAt, "");
  assert.equal(summary.failureReason, undefined);
});

test("AuditTrail.generateRunSummary: single run_created event", async () => {
  const events = [
    makeEvent({ type: "run_created", summary: "Task started: Buy tickets", createdAt: "2026-03-16T10:00:00.000Z" })
  ];
  const trail = new AuditTrail(makeReader({ run_1: events }));
  const summary = await trail.generateRunSummary("run_1");
  assert.equal(summary.status, "running");
  assert.equal(summary.goal, "Buy tickets");
  assert.equal(summary.durationMs, 0);
  assert.equal(summary.totalSteps, 1);
});

test("AuditTrail.generateRunSummary: counts browser actions", async () => {
  const events = [
    makeEvent({ id: "e1", type: "run_created", summary: "Task started: Test", createdAt: "2026-03-16T10:00:00.000Z" }),
    makeEvent({ id: "e2", type: "browser_action_executed", summary: "Clicked A", createdAt: "2026-03-16T10:00:01.000Z" }),
    makeEvent({ id: "e3", type: "browser_action_executed", summary: "Clicked B", createdAt: "2026-03-16T10:00:02.000Z" }),
    makeEvent({ id: "e4", type: "browser_action_executed", summary: "Typed text", createdAt: "2026-03-16T10:00:03.000Z" })
  ];
  const trail = new AuditTrail(makeReader({ run_1: events }));
  const summary = await trail.generateRunSummary("run_1");
  assert.equal(summary.browserActions, 3);
});

test("AuditTrail.generateRunSummary: counts clarifications", async () => {
  const events = [
    makeEvent({ id: "e1", type: "run_created", summary: "Task started: Q", createdAt: "2026-03-16T10:00:00.000Z" }),
    makeEvent({ id: "e2", type: "clarification_requested", summary: "Which size?", createdAt: "2026-03-16T10:00:01.000Z" }),
    makeEvent({ id: "e3", type: "clarification_answered", summary: "Large", createdAt: "2026-03-16T10:00:05.000Z" })
  ];
  const trail = new AuditTrail(makeReader({ run_1: events }));
  const summary = await trail.generateRunSummary("run_1");
  assert.equal(summary.clarificationsRequested, 1);
  assert.equal(summary.clarificationsAnswered, 1);
});

test("AuditTrail.generateRunSummary: counts approvals", async () => {
  const events = [
    makeEvent({ id: "e1", type: "run_created", summary: "Task started: Pay", createdAt: "2026-03-16T10:00:00.000Z" }),
    makeEvent({ id: "e2", type: "approval_requested", summary: "Confirm payment?", createdAt: "2026-03-16T10:00:01.000Z" }),
    makeEvent({ id: "e3", type: "approval_answered", summary: "Approved", createdAt: "2026-03-16T10:00:02.000Z" })
  ];
  const trail = new AuditTrail(makeReader({ run_1: events }));
  const summary = await trail.generateRunSummary("run_1");
  assert.equal(summary.approvalsRequested, 1);
  assert.equal(summary.approvalsAnswered, 1);
});

test("AuditTrail.generateRunSummary: counts page_modeled events", async () => {
  const events = [
    makeEvent({ id: "e1", type: "run_created", summary: "Task started: Browse", createdAt: "2026-03-16T10:00:00.000Z" }),
    makeEvent({ id: "e2", type: "page_modeled", summary: "Page: google.com", createdAt: "2026-03-16T10:00:01.000Z" }),
    makeEvent({ id: "e3", type: "page_modeled", summary: "Page: example.com", createdAt: "2026-03-16T10:00:02.000Z" })
  ];
  const trail = new AuditTrail(makeReader({ run_1: events }));
  const summary = await trail.generateRunSummary("run_1");
  assert.equal(summary.pagesModeled, 2);
});

test("AuditTrail.generateRunSummary: completed run with duration", async () => {
  const events = [
    makeEvent({ id: "e1", type: "run_created", summary: "Task started: Order food", createdAt: "2026-03-16T10:00:00.000Z" }),
    makeEvent({ id: "e2", type: "browser_action_executed", summary: "Clicked order", createdAt: "2026-03-16T10:00:05.000Z" }),
    makeEvent({ id: "e3", type: "run_completed", summary: "Order placed", createdAt: "2026-03-16T10:00:30.000Z" })
  ];
  const trail = new AuditTrail(makeReader({ run_1: events }));
  const summary = await trail.generateRunSummary("run_1");
  assert.equal(summary.status, "completed");
  assert.equal(summary.durationMs, 30000);
  assert.equal(summary.startedAt, "2026-03-16T10:00:00.000Z");
  assert.equal(summary.endedAt, "2026-03-16T10:00:30.000Z");
  assert.equal(summary.totalSteps, 3);
});

test("AuditTrail.generateRunSummary: failed run records failure reason", async () => {
  const events = [
    makeEvent({ id: "e1", type: "run_created", summary: "Task started: Login", createdAt: "2026-03-16T10:00:00.000Z" }),
    makeEvent({ id: "e2", type: "run_failed", summary: "Page timed out", createdAt: "2026-03-16T10:00:10.000Z" })
  ];
  const trail = new AuditTrail(makeReader({ run_1: events }));
  const summary = await trail.generateRunSummary("run_1");
  assert.equal(summary.status, "failed");
  assert.equal(summary.failureReason, "Page timed out");
});

test("AuditTrail.generateRunSummary: cancelled run", async () => {
  const events = [
    makeEvent({ id: "e1", type: "run_created", summary: "Task started: Search", createdAt: "2026-03-16T10:00:00.000Z" }),
    makeEvent({ id: "e2", type: "run_cancelled", summary: "User cancelled", createdAt: "2026-03-16T10:00:05.000Z" })
  ];
  const trail = new AuditTrail(makeReader({ run_1: events }));
  const summary = await trail.generateRunSummary("run_1");
  assert.equal(summary.status, "cancelled");
});

test("AuditTrail.generateRunSummary: counts recovery events", async () => {
  const events = [
    makeEvent({ id: "e1", type: "run_created", summary: "Task started: Retry", createdAt: "2026-03-16T10:00:00.000Z" }),
    makeEvent({ id: "e2", type: "run_recovered", summary: "Recovered", createdAt: "2026-03-16T10:00:01.000Z" }),
    makeEvent({ id: "e3", type: "recovery_failed", summary: "Recovery failed", createdAt: "2026-03-16T10:00:02.000Z" }),
    makeEvent({ id: "e4", type: "recovery_skipped", summary: "Skipped", createdAt: "2026-03-16T10:00:03.000Z" })
  ];
  const trail = new AuditTrail(makeReader({ run_1: events }));
  const summary = await trail.generateRunSummary("run_1");
  assert.equal(summary.recoveryEvents, 3);
});

test("AuditTrail.generateRunSummary: full run with all event types", async () => {
  const events = [
    makeEvent({ id: "e1", type: "run_created", summary: "Task started: Full flow", createdAt: "2026-03-16T10:00:00.000Z" }),
    makeEvent({ id: "e2", type: "page_modeled", summary: "Page modeled", createdAt: "2026-03-16T10:00:01.000Z" }),
    makeEvent({ id: "e3", type: "browser_action_executed", summary: "Click", createdAt: "2026-03-16T10:00:02.000Z" }),
    makeEvent({ id: "e4", type: "clarification_requested", summary: "Which?", createdAt: "2026-03-16T10:00:03.000Z" }),
    makeEvent({ id: "e5", type: "clarification_answered", summary: "This one", createdAt: "2026-03-16T10:00:04.000Z" }),
    makeEvent({ id: "e6", type: "approval_requested", summary: "Approve?", createdAt: "2026-03-16T10:00:05.000Z" }),
    makeEvent({ id: "e7", type: "approval_answered", summary: "Yes", createdAt: "2026-03-16T10:00:06.000Z" }),
    makeEvent({ id: "e8", type: "browser_action_executed", summary: "Submit", createdAt: "2026-03-16T10:00:07.000Z" }),
    makeEvent({ id: "e9", type: "run_completed", summary: "Done", createdAt: "2026-03-16T10:00:20.000Z" }),
    makeEvent({ id: "e10", type: "handoff_written", summary: "Handoff", createdAt: "2026-03-16T10:00:21.000Z" })
  ];
  const trail = new AuditTrail(makeReader({ run_1: events }));
  const summary = await trail.generateRunSummary("run_1");
  assert.equal(summary.goal, "Full flow");
  assert.equal(summary.status, "completed");
  assert.equal(summary.browserActions, 2);
  assert.equal(summary.clarificationsRequested, 1);
  assert.equal(summary.clarificationsAnswered, 1);
  assert.equal(summary.approvalsRequested, 1);
  assert.equal(summary.approvalsAnswered, 1);
  assert.equal(summary.pagesModeled, 1);
  assert.equal(summary.totalSteps, 10);
  assert.equal(summary.durationMs, 21000);
});

// ========================================
// generateRunTimeline
// ========================================

test("AuditTrail.generateRunTimeline: empty events returns no-events message", async () => {
  const trail = new AuditTrail(makeReader({}));
  const result = await trail.generateRunTimeline("run_1");
  assert.equal(result, "No events found for run run_1");
});

test("AuditTrail.generateRunTimeline: single event shows phase header", async () => {
  const events = [
    makeEvent({ type: "run_created", summary: "Task started: Test", createdAt: "2026-03-16T10:00:00.000Z" })
  ];
  const trail = new AuditTrail(makeReader({ run_1: events }));
  const result = await trail.generateRunTimeline("run_1");
  assert.ok(result.includes("── Initialization ──"));
  assert.ok(result.includes("[+0.0s] run_created: Task started: Test"));
});

test("AuditTrail.generateRunTimeline: phase transitions create new headers", async () => {
  const events = [
    makeEvent({ id: "e1", type: "run_created", summary: "Started", createdAt: "2026-03-16T10:00:00.000Z" }),
    makeEvent({ id: "e2", type: "browser_action_executed", summary: "Click", createdAt: "2026-03-16T10:00:02.000Z" }),
    makeEvent({ id: "e3", type: "clarification_requested", summary: "Which?", createdAt: "2026-03-16T10:00:05.000Z" }),
    makeEvent({ id: "e4", type: "run_completed", summary: "Done", createdAt: "2026-03-16T10:00:10.000Z" })
  ];
  const trail = new AuditTrail(makeReader({ run_1: events }));
  const result = await trail.generateRunTimeline("run_1");
  assert.ok(result.includes("── Initialization ──"));
  assert.ok(result.includes("── Execution ──"));
  assert.ok(result.includes("── Clarification ──"));
  assert.ok(result.includes("── Completion ──"));
});

test("AuditTrail.generateRunTimeline: same-phase consecutive events share header", async () => {
  const events = [
    makeEvent({ id: "e1", type: "browser_action_executed", summary: "Click A", createdAt: "2026-03-16T10:00:00.000Z" }),
    makeEvent({ id: "e2", type: "browser_action_executed", summary: "Click B", createdAt: "2026-03-16T10:00:01.000Z" }),
    makeEvent({ id: "e3", type: "page_modeled", summary: "Page", createdAt: "2026-03-16T10:00:02.000Z" })
  ];
  const trail = new AuditTrail(makeReader({ run_1: events }));
  const result = await trail.generateRunTimeline("run_1");
  // Only one Execution header for three consecutive Execution events
  const executionHeaders = result.split("── Execution ──").length - 1;
  assert.equal(executionHeaders, 1);
});

test("AuditTrail.generateRunTimeline: elapsed times are correct", async () => {
  const events = [
    makeEvent({ id: "e1", type: "run_created", summary: "Go", createdAt: "2026-03-16T10:00:00.000Z" }),
    makeEvent({ id: "e2", type: "run_completed", summary: "Done", createdAt: "2026-03-16T10:01:30.500Z" })
  ];
  const trail = new AuditTrail(makeReader({ run_1: events }));
  const result = await trail.generateRunTimeline("run_1");
  assert.ok(result.includes("[+0.0s] run_created: Go"));
  assert.ok(result.includes("[+90.5s] run_completed: Done"));
});

test("AuditTrail.generateRunTimeline: recovery phase appears", async () => {
  const events = [
    makeEvent({ id: "e1", type: "run_created", summary: "Start", createdAt: "2026-03-16T10:00:00.000Z" }),
    makeEvent({ id: "e2", type: "run_recovered", summary: "Recovered from crash", createdAt: "2026-03-16T10:00:05.000Z" })
  ];
  const trail = new AuditTrail(makeReader({ run_1: events }));
  const result = await trail.generateRunTimeline("run_1");
  assert.ok(result.includes("── Recovery ──"));
});

test("AuditTrail.generateRunTimeline: approval phase appears", async () => {
  const events = [
    makeEvent({ id: "e1", type: "approval_requested", summary: "Pay $50?", createdAt: "2026-03-16T10:00:00.000Z" }),
    makeEvent({ id: "e2", type: "approval_answered", summary: "Approved", createdAt: "2026-03-16T10:00:10.000Z" })
  ];
  const trail = new AuditTrail(makeReader({ run_1: events }));
  const result = await trail.generateRunTimeline("run_1");
  assert.ok(result.includes("── Approval ──"));
  const approvalHeaders = result.split("── Approval ──").length - 1;
  assert.equal(approvalHeaders, 1);
});

test("AuditTrail.generateRunTimeline: handoff phase appears", async () => {
  const events = [
    makeEvent({ id: "e1", type: "run_completed", summary: "Done", createdAt: "2026-03-16T10:00:00.000Z" }),
    makeEvent({ id: "e2", type: "handoff_written", summary: "Handoff doc", createdAt: "2026-03-16T10:00:01.000Z" })
  ];
  const trail = new AuditTrail(makeReader({ run_1: events }));
  const result = await trail.generateRunTimeline("run_1");
  assert.ok(result.includes("── Handoff ──"));
});
