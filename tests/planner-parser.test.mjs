import test from "node:test";
import assert from "node:assert/strict";

import { parsePlannerResponse } from "../packages/planner/dist/index.js";

// ---------------------------------------------------------------------------
// browser_action
// ---------------------------------------------------------------------------

test("parses clean JSON browser_action", () => {
  const raw = JSON.stringify({
    type: "browser_action",
    reasoning: "Click the search button",
    action: { type: "click", targetId: "btn_1", description: "Click search" }
  });

  const d = parsePlannerResponse(raw);
  assert.equal(d.type, "browser_action");
  assert.equal(d.action.type, "click");
  assert.equal(d.action.targetId, "btn_1");
  assert.equal(d.action.description, "Click search");
});

test("parses markdown code block", () => {
  const raw = "```json\n" + JSON.stringify({
    type: "browser_action",
    reasoning: "Navigate to page",
    action: { type: "navigate", value: "https://example.com", description: "Go to example" }
  }) + "\n```";

  const d = parsePlannerResponse(raw);
  assert.equal(d.type, "browser_action");
  assert.equal(d.action.type, "navigate");
  assert.equal(d.action.value, "https://example.com");
});

test("extracts JSON from surrounding prose", () => {
  const json = JSON.stringify({
    type: "browser_action",
    reasoning: "Scroll down",
    action: { type: "scroll", value: "down", description: "Scroll down" }
  });
  const raw = `Here's my plan: ${json} Hope that helps!`;

  const d = parsePlannerResponse(raw);
  assert.equal(d.type, "browser_action");
  assert.equal(d.action.type, "scroll");
});

test("handles escaped quotes in JSON strings", () => {
  const raw = JSON.stringify({
    type: "browser_action",
    reasoning: 'Click the "Submit" button',
    action: { type: "click", targetId: "btn_2", description: 'Click "Submit"' }
  });

  const d = parsePlannerResponse(raw);
  assert.equal(d.action.description, 'Click "Submit"');
});

// ---------------------------------------------------------------------------
// clarification_request
// ---------------------------------------------------------------------------

test("parses clarification_request with options", () => {
  const raw = JSON.stringify({
    type: "clarification_request",
    reasoning: "Need date",
    clarificationRequest: {
      id: "c1",
      runId: "r1",
      question: "Which date?",
      contextSummary: "Multiple dates available",
      options: [
        { id: "o1", label: "Monday", summary: "March 10" },
        { id: "o2", label: "Tuesday", summary: "March 11" }
      ],
      createdAt: "2026-03-15T00:00:00Z"
    }
  });

  const d = parsePlannerResponse(raw);
  assert.equal(d.type, "clarification_request");
  assert.equal(d.clarificationRequest.question, "Which date?");
  assert.equal(d.clarificationRequest.options.length, 2);
  assert.equal(d.clarificationRequest.options[0].id, "o1");
  assert.equal(d.clarificationRequest.options[0].label, "Monday");
  assert.equal(d.clarificationRequest.options[0].summary, "March 10");
});

test("parses clarification_request with missing optional fields", () => {
  const raw = JSON.stringify({
    type: "clarification_request",
    reasoning: "Ambiguous query",
    clarificationRequest: {
      question: "What do you mean?"
    }
  });

  const d = parsePlannerResponse(raw);
  assert.equal(d.type, "clarification_request");
  assert.ok(d.clarificationRequest.id); // auto-generated
  assert.equal(d.clarificationRequest.contextSummary, "");
  assert.deepEqual(d.clarificationRequest.options, []);
});

// ---------------------------------------------------------------------------
// task_complete
// ---------------------------------------------------------------------------

test("parses task_complete with completionSummary", () => {
  const raw = JSON.stringify({
    type: "task_complete",
    reasoning: "All done",
    completionSummary: "Flight booked successfully"
  });

  const d = parsePlannerResponse(raw);
  assert.equal(d.type, "task_complete");
  assert.equal(d.completionSummary, "Flight booked successfully");
});

test("parses task_complete falls back to reasoning when no completionSummary", () => {
  const raw = JSON.stringify({
    type: "task_complete",
    reasoning: "Task finished"
  });

  const d = parsePlannerResponse(raw);
  assert.equal(d.completionSummary, "Task finished");
});

// ---------------------------------------------------------------------------
// task_failed
// ---------------------------------------------------------------------------

test("parses task_failed with failureSummary", () => {
  const raw = JSON.stringify({
    type: "task_failed",
    reasoning: "Cannot proceed",
    failureSummary: "Login required"
  });

  const d = parsePlannerResponse(raw);
  assert.equal(d.type, "task_failed");
  assert.equal(d.failureSummary, "Login required");
});

// ---------------------------------------------------------------------------
// approval_request
// ---------------------------------------------------------------------------

test("parses approval_request with full fields", () => {
  const raw = JSON.stringify({
    type: "approval_request",
    reasoning: "About to purchase",
    approvalRequest: {
      id: "ap_1",
      runId: "r1",
      question: "Approve purchase?",
      irreversibleActionSummary: "Will charge $50",
      createdAt: "2026-03-15T00:00:00Z"
    }
  });

  const d = parsePlannerResponse(raw);
  assert.equal(d.type, "approval_request");
  assert.equal(d.approvalRequest.id, "ap_1");
  assert.equal(d.approvalRequest.question, "Approve purchase?");
  assert.equal(d.approvalRequest.irreversibleActionSummary, "Will charge $50");
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

test("throws on missing type", () => {
  const raw = JSON.stringify({ reasoning: "hello" });
  assert.throws(() => parsePlannerResponse(raw), /missing type or reasoning/);
});

test("throws on invalid type", () => {
  const raw = JSON.stringify({ type: "unknown_type", reasoning: "hello" });
  assert.throws(() => parsePlannerResponse(raw), /unsupported type/);
});

test("throws on no JSON found", () => {
  assert.throws(() => parsePlannerResponse("Just some plain text with no braces"), /No JSON object found/);
});

test("throws on incomplete JSON", () => {
  assert.throws(() => parsePlannerResponse('{ "type": "browser_action"'), /Incomplete JSON|Unexpected end/);
});
