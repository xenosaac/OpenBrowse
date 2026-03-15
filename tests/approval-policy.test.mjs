import test from "node:test";
import assert from "node:assert/strict";

import { DefaultApprovalPolicy } from "../packages/security/dist/index.js";

function makeRun(overrides = {}) {
  return {
    id: "run_intent_1",
    taskIntentId: "intent_1",
    status: "running",
    goal: "Buy concert tickets",
    source: "desktop",
    constraints: [],
    metadata: {},
    createdAt: "2026-03-11T10:00:00.000Z",
    updatedAt: "2026-03-11T10:00:00.000Z",
    checkpoint: {
      summary: "Run started.",
      notes: []
    },
    ...overrides
  };
}

test("approval policy flags finalizing and sensitive actions", () => {
  const policy = new DefaultApprovalPolicy();
  const run = makeRun();

  assert.equal(
    policy.requiresApproval(run, {
      type: "click",
      description: "Click Buy now to complete checkout"
    }),
    true
  );

  assert.equal(
    policy.requiresApproval(run, {
      type: "type",
      description: "Enter password into account password field",
      value: "secret"
    }),
    true
  );

  assert.equal(
    policy.requiresApproval(run, {
      type: "click",
      description: "Open the airline filters panel"
    }),
    false
  );
});

test("approval policy builds user-facing approval copy with risk class", () => {
  const policy = new DefaultApprovalPolicy();
  const run = makeRun({
    metadata: {
      approval_mode: "strict"
    }
  });

  const request = policy.buildApprovalRequest(run, {
    type: "click",
    description: "Click Send reply"
  });

  assert.equal(request.runId, run.id);
  assert.match(request.question, /Buy concert tickets/);
  assert.match(request.question, /HIGH:SUBMISSION/);
  assert.equal(request.riskClass, "submission");
  assert.match(request.irreversibleActionSummary, /strict approval mode/i);
  assert.match(request.irreversibleActionSummary, /finalizing action/i);
});

// ---------------------------------------------------------------------------
// classifyRiskClass
// ---------------------------------------------------------------------------

test("classifyRiskClass returns financial for purchase keywords", () => {
  const policy = new DefaultApprovalPolicy();
  const cls = policy.classifyRiskClass(makeRun(), { type: "click", description: "Click Purchase now" });
  assert.equal(cls, "financial");
});

test("classifyRiskClass returns credential for password fields", () => {
  const policy = new DefaultApprovalPolicy();
  const cls = policy.classifyRiskClass(makeRun(), { type: "type", description: "Enter password", value: "secret" });
  assert.equal(cls, "credential");
});

test("classifyRiskClass returns destructive for delete actions", () => {
  const policy = new DefaultApprovalPolicy();
  const cls = policy.classifyRiskClass(makeRun(), { type: "click", description: "Click Delete account" });
  assert.equal(cls, "destructive");
});

test("classifyRiskClass returns submission for confirm/submit", () => {
  const policy = new DefaultApprovalPolicy();
  const cls = policy.classifyRiskClass(makeRun(), { type: "click", description: "Click Submit form" });
  assert.equal(cls, "submission");
});

test("classifyRiskClass returns navigation for navigate actions", () => {
  const policy = new DefaultApprovalPolicy();
  const cls = policy.classifyRiskClass(makeRun(), { type: "navigate", description: "Navigate to google.com" });
  assert.equal(cls, "navigation");
});

test("classifyRiskClass returns general for benign actions", () => {
  const policy = new DefaultApprovalPolicy();
  const cls = policy.classifyRiskClass(makeRun(), { type: "click", description: "Open the filters panel" });
  assert.equal(cls, "general");
});

test("classifyRiskClass prioritizes financial over submission when both match", () => {
  const policy = new DefaultApprovalPolicy();
  // "purchase" matches financial, "confirm" matches submission — financial wins
  const cls = policy.classifyRiskClass(makeRun(), { type: "click", description: "Confirm purchase" });
  assert.equal(cls, "financial");
});

test("buildApprovalRequest includes riskClass field", () => {
  const policy = new DefaultApprovalPolicy();
  const request = policy.buildApprovalRequest(makeRun(), { type: "click", description: "Click Purchase now" });
  assert.equal(request.riskClass, "financial");
  assert.match(request.question, /FINANCIAL/);
});
