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

// ---------------------------------------------------------------------------
// classifyRisk
// ---------------------------------------------------------------------------

test("classifyRisk returns critical for purchase keywords", () => {
  const policy = new DefaultApprovalPolicy();
  const risk = policy.classifyRisk(makeRun(), {
    type: "click",
    description: "Click Purchase now"
  });
  assert.equal(risk, "critical");
});

test("classifyRisk returns high for submit/confirm keywords", () => {
  const policy = new DefaultApprovalPolicy();
  assert.equal(
    policy.classifyRisk(makeRun(), { type: "click", description: "Click Submit form" }),
    "high"
  );
  assert.equal(
    policy.classifyRisk(makeRun(), { type: "click", description: "Click Confirm booking" }),
    "high"
  );
});

test("classifyRisk returns medium for non-keyword but approval-triggering actions", () => {
  const policy = new DefaultApprovalPolicy();
  // Strict mode adds a reason even for benign actions
  const run = makeRun({ metadata: { approval_mode: "strict" } });
  const risk = policy.classifyRisk(run, {
    type: "click",
    description: "Open the filters panel"
  });
  assert.equal(risk, "medium");
});

test("classifyRisk returns low for benign actions", () => {
  const policy = new DefaultApprovalPolicy();
  const risk = policy.classifyRisk(makeRun(), {
    type: "click",
    description: "Click the filters panel"
  });
  assert.equal(risk, "low");
});

// ---------------------------------------------------------------------------
// resolveDenial
// ---------------------------------------------------------------------------

test("resolveDenial returns denied for critical risk", () => {
  const policy = new DefaultApprovalPolicy();
  const outcome = policy.resolveDenial(makeRun(), {
    type: "click",
    description: "Click Purchase now"
  });
  assert.equal(outcome, "denied");
});

test("resolveDenial returns denied for high risk", () => {
  const policy = new DefaultApprovalPolicy();
  const outcome = policy.resolveDenial(makeRun(), {
    type: "click",
    description: "Click Submit form"
  });
  assert.equal(outcome, "denied");
});

test("resolveDenial returns denied_continue for medium risk", () => {
  const policy = new DefaultApprovalPolicy();
  const run = makeRun({ metadata: { approval_mode: "strict" } });
  const outcome = policy.resolveDenial(run, {
    type: "click",
    description: "Open settings"
  });
  assert.equal(outcome, "denied_continue");
});

test("resolveDenial returns denied_continue for low risk", () => {
  const policy = new DefaultApprovalPolicy();
  // Low-risk path in resolveDenial falls through to denied_continue
  const outcome = policy.resolveDenial(makeRun(), {
    type: "click",
    description: "Click the filters panel"
  });
  assert.equal(outcome, "denied_continue");
});

// ---------------------------------------------------------------------------
// approval modes
// ---------------------------------------------------------------------------

test("auto mode only requires approval for critical actions", () => {
  const policy = new DefaultApprovalPolicy();
  const run = makeRun({ metadata: { approval_mode: "auto" } });

  assert.equal(policy.requiresApproval(run, { type: "click", description: "Click Purchase now" }), true);   // critical
  assert.equal(policy.requiresApproval(run, { type: "click", description: "Click Submit form" }), false);   // high
  assert.equal(policy.requiresApproval(run, { type: "click", description: "Click Next" }), false);          // low
});

test("strict mode requires approval for all actions", () => {
  const policy = new DefaultApprovalPolicy();
  const run = makeRun({ metadata: { approval_mode: "strict" } });

  assert.equal(policy.requiresApproval(run, { type: "click", description: "Click Purchase now" }), true);
  assert.equal(policy.requiresApproval(run, { type: "click", description: "Click Submit form" }), true);
  assert.equal(policy.requiresApproval(run, { type: "click", description: "Open filters" }), true);
  assert.equal(policy.requiresApproval(run, { type: "scroll", description: "Scroll down" }), true);
});

// ---------------------------------------------------------------------------
// sensitive / destructive keyword classification
// ---------------------------------------------------------------------------

test("sensitive field keywords in type actions classify as high", () => {
  const policy = new DefaultApprovalPolicy();
  const risk = policy.classifyRisk(makeRun(), {
    type: "type",
    description: "Enter credit card number",
    value: "4111111111111111"
  });
  // "credit card" is in CRITICAL_KEYWORDS
  assert.equal(risk, "critical");
});

test("destructive keywords in click actions classify as high", () => {
  const policy = new DefaultApprovalPolicy();
  const risk = policy.classifyRisk(makeRun(), {
    type: "click",
    description: "Click Delete account"
  });
  assert.equal(risk, "high");
});

// ---------------------------------------------------------------------------
// per-class approval policies
// ---------------------------------------------------------------------------

test("per-class always_ask overrides auto run mode", () => {
  const policy = new DefaultApprovalPolicy({ riskClassPolicies: { submission: "always_ask" } });
  const run = makeRun({ metadata: { approval_mode: "auto" } });
  // Submit is "high" risk — auto mode skips high, but always_ask forces approval
  assert.equal(policy.requiresApproval(run, { type: "click", description: "Click Submit form" }), true);
});

test("per-class auto_approve skips approval in default mode", () => {
  const policy = new DefaultApprovalPolicy({ riskClassPolicies: { submission: "auto_approve" } });
  const run = makeRun();
  // Submit is normally "high" risk (requires approval), but auto_approve bypasses
  assert.equal(policy.requiresApproval(run, { type: "click", description: "Click Submit form" }), false);
});

test("per-class auto_approve does NOT override strict run mode", () => {
  const policy = new DefaultApprovalPolicy({ riskClassPolicies: { submission: "auto_approve" } });
  const run = makeRun({ metadata: { approval_mode: "strict" } });
  // Strict means strict — auto_approve is overridden
  assert.equal(policy.requiresApproval(run, { type: "click", description: "Click Submit form" }), true);
});

test("per-class default preserves existing behavior", () => {
  const policy = new DefaultApprovalPolicy({ riskClassPolicies: { submission: "default" } });
  const run = makeRun();
  // Submit is high risk — same as no config
  assert.equal(policy.requiresApproval(run, { type: "click", description: "Click Submit form" }), true);
});

test("unconfigured class falls through to default behavior", () => {
  const policy = new DefaultApprovalPolicy({ riskClassPolicies: { financial: "always_ask" } });
  const run = makeRun();
  // Destructive class is not configured — uses default risk-level logic
  assert.equal(policy.requiresApproval(run, { type: "click", description: "Click Delete account" }), true);   // high risk
  assert.equal(policy.requiresApproval(run, { type: "click", description: "Open filters" }), false);          // low risk
});

test("per-class always_ask on navigation forces approval for navigate actions", () => {
  const policy = new DefaultApprovalPolicy({ riskClassPolicies: { navigation: "always_ask" } });
  const run = makeRun();
  // Navigate actions are normally low risk — always_ask overrides
  assert.equal(policy.requiresApproval(run, { type: "navigate", description: "Go to google.com" }), true);
});

test("per-class auto_approve on financial bypasses even critical risk", () => {
  const policy = new DefaultApprovalPolicy({ riskClassPolicies: { financial: "auto_approve" } });
  const run = makeRun();
  // Purchase is critical risk, but user configured auto_approve for financial
  assert.equal(policy.requiresApproval(run, { type: "click", description: "Click Purchase now" }), false);
});
