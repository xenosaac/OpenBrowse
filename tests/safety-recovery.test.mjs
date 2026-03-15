import test from "node:test";
import assert from "node:assert/strict";

import { DefaultApprovalPolicy } from "../packages/security/dist/index.js";
import { AuditTrail, LogReplayer } from "../packages/observability/dist/index.js";
import {
  InMemoryWorkflowLogStore
} from "../packages/memory-store/dist/index.js";

// ============================================================================
// Helpers
// ============================================================================

function makeRun(overrides = {}) {
  return {
    id: "run_test_1",
    taskIntentId: "intent_1",
    status: "running",
    goal: "Test task",
    source: "desktop",
    constraints: [],
    metadata: {},
    createdAt: "2026-03-12T10:00:00.000Z",
    updatedAt: "2026-03-12T10:00:00.000Z",
    checkpoint: {
      summary: "Run started.",
      notes: []
    },
    ...overrides
  };
}

async function seedWorkflowEvents(store, runId) {
  const events = [
    { id: "e1", runId, type: "run_created", summary: "Task started: Search flights", createdAt: "2026-03-12T10:00:00.000Z", payload: {} },
    { id: "e2", runId, type: "page_modeled", summary: "Captured page: Google Flights", createdAt: "2026-03-12T10:00:01.000Z", payload: { url: "https://www.google.com/flights" } },
    { id: "e3", runId, type: "browser_action_executed", summary: "Navigate to Google Flights", createdAt: "2026-03-12T10:00:02.000Z", payload: { actionType: "navigate", ok: "true" } },
    { id: "e4", runId, type: "browser_action_executed", summary: "Type departure city", createdAt: "2026-03-12T10:00:03.000Z", payload: { actionType: "type", ok: "true" } },
    { id: "e5", runId, type: "clarification_requested", summary: "What are your travel dates?", createdAt: "2026-03-12T10:00:04.000Z", payload: {} },
    { id: "e6", runId, type: "clarification_answered", summary: "User replied: Oct 10-24", createdAt: "2026-03-12T10:01:00.000Z", payload: {} },
    { id: "e7", runId, type: "browser_action_executed", summary: "Click search", createdAt: "2026-03-12T10:01:01.000Z", payload: { actionType: "click", ok: "true" } },
    { id: "e8", runId, type: "page_modeled", summary: "Captured page: Flight Results", createdAt: "2026-03-12T10:01:02.000Z", payload: { url: "https://www.google.com/flights/search" } },
    { id: "e9", runId, type: "approval_requested", summary: "Approve purchase?", createdAt: "2026-03-12T10:01:03.000Z", payload: {} },
    { id: "e10", runId, type: "approval_answered", summary: "Approval granted", createdAt: "2026-03-12T10:02:00.000Z", payload: {} },
    { id: "e11", runId, type: "run_completed", summary: "Task completed successfully", createdAt: "2026-03-12T10:02:01.000Z", payload: {} }
  ];
  for (const event of events) {
    await store.append(event);
  }
  return events;
}

// ============================================================================
// Test 1: Risk classification
// ============================================================================
test("approval policy classifies action risk levels correctly", () => {
  const policy = new DefaultApprovalPolicy();
  const run = makeRun();

  // Critical: payment/financial
  assert.equal(
    policy.classifyRisk(run, { type: "click", description: "Click Buy Now to purchase" }),
    "critical"
  );
  assert.equal(
    policy.classifyRisk(run, { type: "type", description: "Enter credit card number", value: "4111..." }),
    "critical"
  );

  // High: irreversible actions, credentials
  assert.equal(
    policy.classifyRisk(run, { type: "click", description: "Click Submit form" }),
    "high"
  );
  assert.equal(
    policy.classifyRisk(run, { type: "click", description: "Click Delete account" }),
    "high"
  );
  assert.equal(
    policy.classifyRisk(run, { type: "type", description: "Enter password", value: "secret" }),
    "high"
  );

  // Low: safe actions
  assert.equal(
    policy.classifyRisk(run, { type: "click", description: "Open the filters panel" }),
    "low"
  );
  assert.equal(
    policy.classifyRisk(run, { type: "navigate", value: "https://example.com", description: "Go to example" }),
    "low"
  );
  assert.equal(
    policy.classifyRisk(run, { type: "scroll", description: "Scroll down" }),
    "low"
  );
});

// ============================================================================
// Test 2: Configurable approval modes
// ============================================================================
test("approval policy respects configurable modes", () => {
  const policy = new DefaultApprovalPolicy();

  // Default mode: approves medium+ risk
  const defaultRun = makeRun();
  assert.equal(
    policy.requiresApproval(defaultRun, { type: "click", description: "Open filters" }),
    false
  );
  assert.equal(
    policy.requiresApproval(defaultRun, { type: "click", description: "Click Submit" }),
    true
  );

  // Strict mode: approves everything
  const strictRun = makeRun({ metadata: { approval_mode: "strict" } });
  assert.equal(
    policy.requiresApproval(strictRun, { type: "click", description: "Open filters" }),
    true
  );
  assert.equal(
    policy.requiresApproval(strictRun, { type: "scroll", description: "Scroll down" }),
    true
  );

  // Auto mode: only critical
  const autoRun = makeRun({ metadata: { approval_mode: "auto" } });
  assert.equal(
    policy.requiresApproval(autoRun, { type: "click", description: "Click Submit form" }),
    false,
    "Auto mode should not require approval for high-risk, only critical"
  );
  assert.equal(
    policy.requiresApproval(autoRun, { type: "click", description: "Click Buy to purchase" }),
    true,
    "Auto mode should require approval for critical-risk"
  );
});

// ============================================================================
// Test 3: Deny-but-continue
// ============================================================================
test("approval policy resolves denial outcome based on risk level", () => {
  const policy = new DefaultApprovalPolicy();
  const run = makeRun();

  // Critical/high risk denials → cancel run
  assert.equal(
    policy.resolveDenial(run, { type: "click", description: "Click Buy to purchase" }),
    "denied"
  );
  assert.equal(
    policy.resolveDenial(run, { type: "click", description: "Click Submit form" }),
    "denied"
  );

  // Medium risk denials → let planner try alternative
  // Using strict mode to make a normally-low-risk action register as medium
  const strictRun = makeRun({ metadata: { approval_mode: "strict" } });
  assert.equal(
    policy.resolveDenial(strictRun, { type: "click", description: "Open filters" }),
    "denied_continue"
  );
});

// ============================================================================
// Test 4: Risk label in approval request
// ============================================================================
test("approval request includes risk label in question", () => {
  const policy = new DefaultApprovalPolicy();
  const run = makeRun();

  const request = policy.buildApprovalRequest(run, {
    type: "click",
    description: "Click Purchase now"
  });

  assert.match(request.question, /\[CRITICAL:FINANCIAL\]/);
  assert.match(request.question, /Purchase now/);
});

// ============================================================================
// Test 5: Audit trail — run summary
// ============================================================================
test("audit trail generates structured run summary from workflow events", async () => {
  const store = new InMemoryWorkflowLogStore();
  const runId = "run_audit_1";
  await seedWorkflowEvents(store, runId);

  const audit = new AuditTrail(store);
  const summary = await audit.generateRunSummary(runId);

  assert.equal(summary.runId, runId);
  assert.equal(summary.status, "completed");
  assert.equal(summary.goal, "Search flights");
  assert.equal(summary.totalSteps, 11);
  assert.equal(summary.browserActions, 3);
  assert.equal(summary.clarificationsRequested, 1);
  assert.equal(summary.clarificationsAnswered, 1);
  assert.equal(summary.approvalsRequested, 1);
  assert.equal(summary.approvalsAnswered, 1);
  assert.equal(summary.pagesModeled, 2);
  assert.equal(summary.recoveryEvents, 0);
  assert.ok(summary.durationMs > 0);
  assert.equal(summary.startedAt, "2026-03-12T10:00:00.000Z");
  assert.equal(summary.endedAt, "2026-03-12T10:02:01.000Z");
});

// ============================================================================
// Test 6: Audit trail — empty run
// ============================================================================
test("audit trail returns empty summary for unknown run", async () => {
  const store = new InMemoryWorkflowLogStore();
  const audit = new AuditTrail(store);
  const summary = await audit.generateRunSummary("nonexistent_run");

  assert.equal(summary.status, "unknown");
  assert.equal(summary.totalSteps, 0);
  assert.equal(summary.durationMs, 0);
});

// ============================================================================
// Test 7: Audit trail — run timeline with phase markers
// ============================================================================
test("audit trail generates phased timeline from workflow events", async () => {
  const store = new InMemoryWorkflowLogStore();
  const runId = "run_timeline_1";
  await seedWorkflowEvents(store, runId);

  const audit = new AuditTrail(store);
  const timeline = await audit.generateRunTimeline(runId);

  assert.ok(timeline.includes("── Initialization ──"));
  assert.ok(timeline.includes("── Execution ──"));
  assert.ok(timeline.includes("── Clarification ──"));
  assert.ok(timeline.includes("── Approval ──"));
  assert.ok(timeline.includes("── Completion ──"));
  assert.ok(timeline.includes("run_created"));
  assert.ok(timeline.includes("browser_action_executed"));
  assert.ok(timeline.includes("run_completed"));
});

// ============================================================================
// Test 8: Audit trail — failed run summary
// ============================================================================
test("audit trail captures failure reason in summary", async () => {
  const store = new InMemoryWorkflowLogStore();
  const runId = "run_failed_1";

  await store.append({ id: "e1", runId, type: "run_created", summary: "Task started: Bad task", createdAt: "2026-03-12T10:00:00.000Z", payload: {} });
  await store.append({ id: "e2", runId, type: "run_failed", summary: "Navigation timeout after 30s", createdAt: "2026-03-12T10:00:31.000Z", payload: {} });

  const audit = new AuditTrail(store);
  const summary = await audit.generateRunSummary(runId);

  assert.equal(summary.status, "failed");
  assert.equal(summary.failureReason, "Navigation timeout after 30s");
  assert.equal(summary.totalSteps, 2);
});

// ============================================================================
// Test 9: Audit trail — recovery events counted
// ============================================================================
test("audit trail counts recovery events in summary", async () => {
  const store = new InMemoryWorkflowLogStore();
  const runId = "run_recovered_1";

  await store.append({ id: "e1", runId, type: "run_created", summary: "Task started: Monitor price", createdAt: "2026-03-12T10:00:00.000Z", payload: {} });
  await store.append({ id: "e2", runId, type: "run_recovered", summary: "Recovered from crash", createdAt: "2026-03-12T10:00:05.000Z", payload: {} });
  await store.append({ id: "e3", runId, type: "browser_action_executed", summary: "Extract price", createdAt: "2026-03-12T10:00:06.000Z", payload: {} });
  await store.append({ id: "e4", runId, type: "run_completed", summary: "Done", createdAt: "2026-03-12T10:00:07.000Z", payload: {} });

  const audit = new AuditTrail(store);
  const summary = await audit.generateRunSummary(runId);

  assert.equal(summary.status, "completed");
  assert.equal(summary.recoveryEvents, 1);
  assert.equal(summary.browserActions, 1);
  assert.equal(summary.totalSteps, 4);
});

// ============================================================================
// Test 10: LogReplayer still works with new event types
// ============================================================================
test("log replayer handles new recovery event types", async () => {
  const store = new InMemoryWorkflowLogStore();
  const runId = "run_replay_recovery";

  await store.append({ id: "e1", runId, type: "run_created", summary: "Task started", createdAt: "2026-03-12T10:00:00.000Z", payload: {} });
  await store.append({ id: "e2", runId, type: "run_recovered", summary: "Recovered", createdAt: "2026-03-12T10:00:01.000Z", payload: {} });
  await store.append({ id: "e3", runId, type: "recovery_skipped", summary: "Skipped run", createdAt: "2026-03-12T10:00:02.000Z", payload: {} });

  const replayer = new LogReplayer(store);
  const steps = await replayer.replay(runId);

  assert.equal(steps.length, 3);
  assert.equal(steps[0].event.type, "run_created");
  assert.equal(steps[1].event.type, "run_recovered");
  assert.equal(steps[2].event.type, "recovery_skipped");

  const formatted = await replayer.replayFormatted(runId);
  assert.ok(formatted.includes("run_recovered"));
  assert.ok(formatted.includes("recovery_skipped"));
});
