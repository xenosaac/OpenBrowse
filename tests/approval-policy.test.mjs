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

test("approval policy builds user-facing approval copy", () => {
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
  assert.match(request.irreversibleActionSummary, /strict approval mode/i);
  assert.match(request.irreversibleActionSummary, /finalizing action/i);
});
