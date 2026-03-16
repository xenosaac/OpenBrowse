import test from "node:test";
import assert from "node:assert/strict";

import {
  canTransition,
  assertTransition,
} from "../packages/orchestrator/dist/RunStateMachine.js";

// --- canTransition: valid transitions ---

test("canTransition: queued -> running", () => {
  assert.equal(canTransition("queued", "running"), true);
});

test("canTransition: queued -> cancelled", () => {
  assert.equal(canTransition("queued", "cancelled"), true);
});

test("canTransition: queued -> failed", () => {
  assert.equal(canTransition("queued", "failed"), true);
});

test("canTransition: running -> suspended_for_clarification", () => {
  assert.equal(canTransition("running", "suspended_for_clarification"), true);
});

test("canTransition: running -> suspended_for_approval", () => {
  assert.equal(canTransition("running", "suspended_for_approval"), true);
});

test("canTransition: running -> completed", () => {
  assert.equal(canTransition("running", "completed"), true);
});

test("canTransition: running -> failed", () => {
  assert.equal(canTransition("running", "failed"), true);
});

test("canTransition: running -> cancelled", () => {
  assert.equal(canTransition("running", "cancelled"), true);
});

test("canTransition: running -> running (self-loop)", () => {
  assert.equal(canTransition("running", "running"), true);
});

test("canTransition: suspended_for_clarification -> running", () => {
  assert.equal(canTransition("suspended_for_clarification", "running"), true);
});

test("canTransition: suspended_for_clarification -> cancelled", () => {
  assert.equal(canTransition("suspended_for_clarification", "cancelled"), true);
});

test("canTransition: suspended_for_clarification -> failed", () => {
  assert.equal(canTransition("suspended_for_clarification", "failed"), true);
});

test("canTransition: suspended_for_approval -> running", () => {
  assert.equal(canTransition("suspended_for_approval", "running"), true);
});

test("canTransition: suspended_for_approval -> cancelled", () => {
  assert.equal(canTransition("suspended_for_approval", "cancelled"), true);
});

test("canTransition: suspended_for_approval -> failed", () => {
  assert.equal(canTransition("suspended_for_approval", "failed"), true);
});

// --- canTransition: invalid transitions ---

test("canTransition: queued -> completed (invalid)", () => {
  assert.equal(canTransition("queued", "completed"), false);
});

test("canTransition: queued -> suspended_for_clarification (invalid)", () => {
  assert.equal(canTransition("queued", "suspended_for_clarification"), false);
});

test("canTransition: completed -> running (terminal)", () => {
  assert.equal(canTransition("completed", "running"), false);
});

test("canTransition: completed -> failed (terminal)", () => {
  assert.equal(canTransition("completed", "failed"), false);
});

test("canTransition: failed -> running (terminal)", () => {
  assert.equal(canTransition("failed", "running"), false);
});

test("canTransition: cancelled -> running (terminal)", () => {
  assert.equal(canTransition("cancelled", "running"), false);
});

test("canTransition: cancelled -> completed (terminal)", () => {
  assert.equal(canTransition("cancelled", "completed"), false);
});

test("canTransition: suspended_for_clarification -> completed (invalid)", () => {
  assert.equal(canTransition("suspended_for_clarification", "completed"), false);
});

test("canTransition: suspended_for_approval -> completed (invalid)", () => {
  assert.equal(canTransition("suspended_for_approval", "completed"), false);
});

// --- assertTransition ---

test("assertTransition: valid transition does not throw", () => {
  assert.doesNotThrow(() => assertTransition("queued", "running"));
});

test("assertTransition: invalid transition throws", () => {
  assert.throws(
    () => assertTransition("completed", "running"),
    /Invalid task-run transition: completed -> running/
  );
});

test("assertTransition: terminal -> terminal throws", () => {
  assert.throws(
    () => assertTransition("failed", "cancelled"),
    /Invalid task-run transition/
  );
});
