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

// ---------------------------------------------------------------------------
// T24: Approval gate calibration — false positive fixes
// ---------------------------------------------------------------------------

test("T24: navigate actions do not trigger approval (default mode)", () => {
  const policy = new DefaultApprovalPolicy();
  const run = makeRun({ goal: "look up toucan price in california" });

  // Database false positive: "Search Google for toucan price in California"
  assert.equal(
    policy.requiresApproval(run, {
      type: "navigate",
      description: "Search Google for toucan price in California"
    }),
    false
  );

  // Database false positive: "Navigate to birdbreeders.com listing page"
  assert.equal(
    policy.requiresApproval(run, {
      type: "navigate",
      description: "Navigate to birdbreeders.com listing page"
    }),
    false
  );

  // Navigate to a regular website — no approval
  assert.equal(
    policy.requiresApproval(run, {
      type: "navigate",
      description: "Navigate to google.com",
      value: "https://www.google.com"
    }),
    false
  );
});

test("T24: navigate TO transactional URLs still triggers approval", () => {
  const policy = new DefaultApprovalPolicy();
  const run = makeRun();

  assert.equal(
    policy.requiresApproval(run, {
      type: "navigate",
      description: "Navigate to checkout page",
      value: "https://example.com/checkout"
    }),
    true
  );

  assert.equal(
    policy.requiresApproval(run, {
      type: "navigate",
      description: "Go to payment form",
      value: "https://store.com/payment/step2"
    }),
    true
  );
});

test("T24: read-only actions never trigger approval even with risky keywords", () => {
  const policy = new DefaultApprovalPolicy();
  const run = makeRun();

  // read_text mentioning checkout — still no approval
  assert.equal(
    policy.requiresApproval(run, {
      type: "read_text",
      description: "Read text to check the purchase total"
    }),
    false
  );

  // screenshot — always exempt
  assert.equal(
    policy.requiresApproval(run, {
      type: "screenshot",
      description: "Screenshot the payment confirmation"
    }),
    false
  );

  // go_back — always exempt
  assert.equal(
    policy.requiresApproval(run, {
      type: "go_back",
      description: "Go back from checkout page"
    }),
    false
  );

  // wait — exempt
  assert.equal(
    policy.requiresApproval(run, {
      type: "wait",
      description: "Wait for payment to process"
    }),
    false
  );

  // scroll — exempt
  assert.equal(
    policy.requiresApproval(run, {
      type: "scroll",
      description: "Scroll to the submit button"
    }),
    false
  );

  // hover — exempt
  assert.equal(
    policy.requiresApproval(run, {
      type: "hover",
      description: "Hover over the buy now button"
    }),
    false
  );
});

test("T24: 'submit' without transactional context does not trigger (Wordle fix)", () => {
  const policy = new DefaultApprovalPolicy();
  const run = makeRun({ goal: "complete today's wordle" });

  // Database false positive: pressing Enter to submit a Wordle guess
  assert.equal(
    policy.requiresApproval(run, {
      type: "click",
      description: "Press Enter to submit the word CRANE"
    }),
    false
  );

  // "confirm" in a game context — no transactional context
  assert.equal(
    policy.requiresApproval(run, {
      type: "click",
      description: "Click to confirm the guess SLATE"
    }),
    false
  );
});

test("T24: 'submit' WITH transactional context still triggers", () => {
  const policy = new DefaultApprovalPolicy();
  const run = makeRun();

  // Submit a registration form — has transactional context
  assert.equal(
    policy.requiresApproval(run, {
      type: "click",
      description: "Click Submit on the registration form"
    }),
    true
  );

  // Confirm order — has transactional context
  assert.equal(
    policy.requiresApproval(run, {
      type: "click",
      description: "Click Confirm to place the order"
    }),
    true
  );

  // Submit application — has transactional context
  assert.equal(
    policy.requiresApproval(run, {
      type: "click",
      description: "Submit the job application"
    }),
    true
  );
});

test("T24: genuinely risky actions still trigger (regression)", () => {
  const policy = new DefaultApprovalPolicy();
  const run = makeRun();

  // Buy Now — critical
  assert.equal(
    policy.requiresApproval(run, {
      type: "click",
      description: "Click Buy Now"
    }),
    true
  );

  // Delete Account — high (destructive)
  assert.equal(
    policy.requiresApproval(run, {
      type: "click",
      description: "Click Delete Account"
    }),
    true
  );

  // Credit card entry — high (credential)
  assert.equal(
    policy.requiresApproval(run, {
      type: "type",
      description: "Enter credit card number",
      value: "4111111111111111"
    }),
    true
  );

  // Password entry — high (credential)
  assert.equal(
    policy.requiresApproval(run, {
      type: "type",
      description: "Type password",
      value: "secret123"
    }),
    true
  );

  // Send (strong keyword, not context-dependent) — high
  assert.equal(
    policy.requiresApproval(run, {
      type: "click",
      description: "Click Send to email the invoice"
    }),
    true
  );
});

test("T24: classifyRisk returns low for read-only actions", () => {
  const policy = new DefaultApprovalPolicy();
  const run = makeRun();

  assert.equal(
    policy.classifyRisk(run, { type: "read_text", description: "Read the purchase total" }),
    "low"
  );
  assert.equal(
    policy.classifyRisk(run, { type: "screenshot", description: "Screenshot payment page" }),
    "low"
  );
});

test("T24: classifyRisk returns low for non-transactional navigate", () => {
  const policy = new DefaultApprovalPolicy();
  const run = makeRun();

  assert.equal(
    policy.classifyRisk(run, { type: "navigate", description: "Navigate to google.com" }),
    "low"
  );
  assert.equal(
    policy.classifyRisk(run, { type: "navigate", description: "Go to Wikipedia article" }),
    "low"
  );
});
