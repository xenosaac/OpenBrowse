import test from "node:test";
import assert from "node:assert/strict";

import { parsePlannerResponse } from "../packages/planner/dist/parsePlannerResponse.js";

// --- Raw JSON parsing ---

test("parsePlannerResponse: parses raw JSON browser_action", () => {
  const raw = JSON.stringify({
    type: "browser_action",
    reasoning: "Click the login button",
    action: { type: "click", targetId: "el_5", description: "Login button" },
  });
  const result = parsePlannerResponse(raw);
  assert.equal(result.type, "browser_action");
  assert.equal(result.reasoning, "Click the login button");
  assert.equal(result.action.type, "click");
  assert.equal(result.action.targetId, "el_5");
});

test("parsePlannerResponse: parses task_complete", () => {
  const raw = JSON.stringify({
    type: "task_complete",
    reasoning: "Found the price",
    completionSummary: "Price is $42",
  });
  const result = parsePlannerResponse(raw);
  assert.equal(result.type, "task_complete");
  assert.equal(result.completionSummary, "Price is $42");
});

test("parsePlannerResponse: parses task_failed", () => {
  const raw = JSON.stringify({
    type: "task_failed",
    reasoning: "Page not found",
    failureSummary: "404 error",
  });
  const result = parsePlannerResponse(raw);
  assert.equal(result.type, "task_failed");
  assert.equal(result.failureSummary, "404 error");
});

// --- Markdown code block extraction ---

test("parsePlannerResponse: extracts JSON from markdown code block", () => {
  const raw = `Here's the decision:\n\`\`\`json\n{"type": "task_complete", "reasoning": "Done", "completionSummary": "All set"}\n\`\`\`\nThat should work.`;
  const result = parsePlannerResponse(raw);
  assert.equal(result.type, "task_complete");
  assert.equal(result.completionSummary, "All set");
});

test("parsePlannerResponse: extracts JSON from code block without json tag", () => {
  const raw = `\`\`\`\n{"type": "task_complete", "reasoning": "Done"}\n\`\`\``;
  const result = parsePlannerResponse(raw);
  assert.equal(result.type, "task_complete");
});

// --- Brace-depth extraction ---

test("parsePlannerResponse: extracts JSON embedded in prose", () => {
  const raw = `I think the best action is {"type": "browser_action", "reasoning": "Navigate", "action": {"type": "navigate", "value": "https://example.com", "description": "Go to example"}} and that should do it.`;
  const result = parsePlannerResponse(raw);
  assert.equal(result.type, "browser_action");
  assert.equal(result.action.type, "navigate");
  assert.equal(result.action.value, "https://example.com");
});

// --- clarification_request ---

test("parsePlannerResponse: parses clarification_request with options", () => {
  const raw = JSON.stringify({
    type: "clarification_request",
    reasoning: "Need to know preference",
    clarificationRequest: {
      question: "Which size?",
      options: [
        { label: "Small" },
        { label: "Large", summary: "Extra large" },
      ],
    },
  });
  const result = parsePlannerResponse(raw);
  assert.equal(result.type, "clarification_request");
  assert.equal(result.clarificationRequest.question, "Which size?");
  assert.equal(result.clarificationRequest.options.length, 2);
  assert.equal(result.clarificationRequest.options[0].label, "Small");
  assert.equal(result.clarificationRequest.options[0].id, "opt_0");
  assert.equal(result.clarificationRequest.options[1].summary, "Extra large");
});

// --- approval_request ---

test("parsePlannerResponse: parses approval_request", () => {
  const raw = JSON.stringify({
    type: "approval_request",
    reasoning: "About to submit payment",
    approvalRequest: {
      question: "Confirm purchase?",
      irreversibleActionSummary: "Will charge $99",
    },
  });
  const result = parsePlannerResponse(raw);
  assert.equal(result.type, "approval_request");
  assert.equal(result.approvalRequest.question, "Confirm purchase?");
  assert.equal(result.approvalRequest.irreversibleActionSummary, "Will charge $99");
});

// --- Defaults and fallbacks ---

test("parsePlannerResponse: task_complete uses reasoning as fallback summary", () => {
  const raw = JSON.stringify({
    type: "task_complete",
    reasoning: "All done",
  });
  const result = parsePlannerResponse(raw);
  assert.equal(result.completionSummary, "All done");
});

test("parsePlannerResponse: task_failed uses reasoning as fallback summary", () => {
  const raw = JSON.stringify({
    type: "task_failed",
    reasoning: "Something broke",
  });
  const result = parsePlannerResponse(raw);
  assert.equal(result.failureSummary, "Something broke");
});

test("parsePlannerResponse: browser_action action description defaults to reasoning", () => {
  const raw = JSON.stringify({
    type: "browser_action",
    reasoning: "Click button",
    action: { type: "click", targetId: "el_1" },
  });
  const result = parsePlannerResponse(raw);
  assert.equal(result.action.description, "Click button");
});

// --- Edge cases ---

test("parsePlannerResponse: handles escaped quotes in JSON strings", () => {
  const raw = JSON.stringify({
    type: "browser_action",
    reasoning: 'Click the "Submit" button',
    action: { type: "click", targetId: "btn_2", description: 'Click "Submit"' },
  });
  const result = parsePlannerResponse(raw);
  assert.equal(result.action.description, 'Click "Submit"');
});

test("parsePlannerResponse: parses clarification_request with missing optional fields", () => {
  const raw = JSON.stringify({
    type: "clarification_request",
    reasoning: "Ambiguous query",
    clarificationRequest: {
      question: "What do you mean?",
    },
  });
  const result = parsePlannerResponse(raw);
  assert.equal(result.type, "clarification_request");
  assert.ok(result.clarificationRequest.id); // auto-generated
  assert.equal(result.clarificationRequest.contextSummary, "");
  assert.deepEqual(result.clarificationRequest.options, []);
});

// --- Error cases ---

test("parsePlannerResponse: throws on missing type", () => {
  const raw = JSON.stringify({ reasoning: "No type" });
  assert.throws(() => parsePlannerResponse(raw), /missing type or reasoning/);
});

test("parsePlannerResponse: throws on missing reasoning", () => {
  const raw = JSON.stringify({ type: "task_complete" });
  assert.throws(() => parsePlannerResponse(raw), /missing type or reasoning/);
});

test("parsePlannerResponse: throws on unsupported type", () => {
  const raw = JSON.stringify({ type: "unknown_type", reasoning: "test" });
  assert.throws(() => parsePlannerResponse(raw), /unsupported type/);
});

test("parsePlannerResponse: throws on no JSON in response", () => {
  assert.throws(() => parsePlannerResponse("Just some text with no JSON"), /No JSON object found/);
});

test("parsePlannerResponse: throws on empty string", () => {
  assert.throws(() => parsePlannerResponse(""), /No JSON object found/);
});

test("parsePlannerResponse: throws on incomplete JSON", () => {
  assert.throws(
    () => parsePlannerResponse('{"type": "task_complete", "reasoning": '),
    /Incomplete JSON|Unexpected end/
  );
});
