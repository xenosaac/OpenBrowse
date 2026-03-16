import test from "node:test";
import assert from "node:assert/strict";

import {
  DefaultClarificationPolicy,
  formatClarificationSummary,
} from "../packages/orchestrator/dist/ClarificationPolicy.js";

// --- DefaultClarificationPolicy.shouldSuspend ---

test("shouldSuspend returns true when running + clarification_request", () => {
  const policy = new DefaultClarificationPolicy();
  const run = { status: "running" };
  const decision = { type: "clarification_request" };
  assert.equal(policy.shouldSuspend(run, decision), true);
});

test("shouldSuspend returns false when running + browser_action", () => {
  const policy = new DefaultClarificationPolicy();
  const run = { status: "running" };
  const decision = { type: "browser_action" };
  assert.equal(policy.shouldSuspend(run, decision), false);
});

test("shouldSuspend returns false when running + task_complete", () => {
  const policy = new DefaultClarificationPolicy();
  const run = { status: "running" };
  const decision = { type: "task_complete" };
  assert.equal(policy.shouldSuspend(run, decision), false);
});

test("shouldSuspend returns false when running + task_failed", () => {
  const policy = new DefaultClarificationPolicy();
  const run = { status: "running" };
  const decision = { type: "task_failed" };
  assert.equal(policy.shouldSuspend(run, decision), false);
});

test("shouldSuspend returns false when running + approval_request", () => {
  const policy = new DefaultClarificationPolicy();
  const run = { status: "running" };
  const decision = { type: "approval_request" };
  assert.equal(policy.shouldSuspend(run, decision), false);
});

test("shouldSuspend returns false when suspended + clarification_request", () => {
  const policy = new DefaultClarificationPolicy();
  const run = { status: "suspended" };
  const decision = { type: "clarification_request" };
  assert.equal(policy.shouldSuspend(run, decision), false);
});

test("shouldSuspend returns false when completed + clarification_request", () => {
  const policy = new DefaultClarificationPolicy();
  const run = { status: "completed" };
  const decision = { type: "clarification_request" };
  assert.equal(policy.shouldSuspend(run, decision), false);
});

test("shouldSuspend returns false when failed + clarification_request", () => {
  const policy = new DefaultClarificationPolicy();
  const run = { status: "failed" };
  const decision = { type: "clarification_request" };
  assert.equal(policy.shouldSuspend(run, decision), false);
});

test("shouldSuspend returns false when cancelled + clarification_request", () => {
  const policy = new DefaultClarificationPolicy();
  const run = { status: "cancelled" };
  const decision = { type: "clarification_request" };
  assert.equal(policy.shouldSuspend(run, decision), false);
});

test("shouldSuspend returns false when queued + clarification_request", () => {
  const policy = new DefaultClarificationPolicy();
  const run = { status: "queued" };
  const decision = { type: "clarification_request" };
  assert.equal(policy.shouldSuspend(run, decision), false);
});

// --- formatClarificationSummary ---

test("formatClarificationSummary with no options", () => {
  const request = {
    id: "c1",
    runId: "r1",
    question: "Which account to use?",
    contextSummary: "ctx",
    options: [],
    createdAt: "2026-01-01T00:00:00Z",
  };
  const result = formatClarificationSummary(request);
  assert.equal(result, "Which account to use? No structured options provided.");
});

test("formatClarificationSummary with single option", () => {
  const request = {
    id: "c2",
    runId: "r1",
    question: "Choose a plan:",
    contextSummary: "ctx",
    options: [{ label: "Basic", summary: "Free tier" }],
    createdAt: "2026-01-01T00:00:00Z",
  };
  const result = formatClarificationSummary(request);
  assert.equal(result, "Choose a plan: Basic: Free tier");
});

test("formatClarificationSummary with multiple options", () => {
  const request = {
    id: "c3",
    runId: "r1",
    question: "Pick one:",
    contextSummary: "ctx",
    options: [
      { label: "A", summary: "Option A" },
      { label: "B", summary: "Option B" },
      { label: "C", summary: "Option C" },
    ],
    createdAt: "2026-01-01T00:00:00Z",
  };
  const result = formatClarificationSummary(request);
  assert.equal(result, "Pick one: A: Option A | B: Option B | C: Option C");
});

test("formatClarificationSummary trims whitespace", () => {
  const request = {
    id: "c4",
    runId: "r1",
    question: "  Question with spaces  ",
    contextSummary: "ctx",
    options: [],
    createdAt: "2026-01-01T00:00:00Z",
  };
  const result = formatClarificationSummary(request);
  // trim() is applied to the final concatenation
  assert.ok(!result.endsWith(" "));
});
