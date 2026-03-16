import test from "node:test";
import assert from "node:assert/strict";

import { parseApprovalAnswer } from "../packages/runtime-core/dist/approvalParsing.js";

// ---------------------------------------------------------------------------
// Affirmative answers → true
// ---------------------------------------------------------------------------

test("approve returns true", () => {
  assert.strictEqual(parseApprovalAnswer("approve"), true);
});

test("approved returns true", () => {
  assert.strictEqual(parseApprovalAnswer("approved"), true);
});

test("yes returns true", () => {
  assert.strictEqual(parseApprovalAnswer("yes"), true);
});

test("y returns true", () => {
  assert.strictEqual(parseApprovalAnswer("y"), true);
});

test("ok returns true", () => {
  assert.strictEqual(parseApprovalAnswer("ok"), true);
});

test("allow returns true", () => {
  assert.strictEqual(parseApprovalAnswer("allow"), true);
});

test("go returns true", () => {
  assert.strictEqual(parseApprovalAnswer("go"), true);
});

// ---------------------------------------------------------------------------
// Negative answers → false
// ---------------------------------------------------------------------------

test("deny returns false", () => {
  assert.strictEqual(parseApprovalAnswer("deny"), false);
});

test("denied returns false", () => {
  assert.strictEqual(parseApprovalAnswer("denied"), false);
});

test("no returns false", () => {
  assert.strictEqual(parseApprovalAnswer("no"), false);
});

test("n returns false", () => {
  assert.strictEqual(parseApprovalAnswer("n"), false);
});

test("block returns false", () => {
  assert.strictEqual(parseApprovalAnswer("block"), false);
});

test("cancel returns false", () => {
  assert.strictEqual(parseApprovalAnswer("cancel"), false);
});

test("stop returns false", () => {
  assert.strictEqual(parseApprovalAnswer("stop"), false);
});

// ---------------------------------------------------------------------------
// Ambiguous / unrecognized → null
// ---------------------------------------------------------------------------

test("empty string returns null", () => {
  assert.strictEqual(parseApprovalAnswer(""), null);
});

test("random text returns null", () => {
  assert.strictEqual(parseApprovalAnswer("maybe"), null);
});

test("partial match returns null", () => {
  assert.strictEqual(parseApprovalAnswer("approved!"), null);
});

test("sentence returns null", () => {
  assert.strictEqual(parseApprovalAnswer("I approve this action"), null);
});

// ---------------------------------------------------------------------------
// Case insensitivity
// ---------------------------------------------------------------------------

test("APPROVE (uppercase) returns true", () => {
  assert.strictEqual(parseApprovalAnswer("APPROVE"), true);
});

test("Yes (mixed case) returns true", () => {
  assert.strictEqual(parseApprovalAnswer("Yes"), true);
});

test("DENY (uppercase) returns false", () => {
  assert.strictEqual(parseApprovalAnswer("DENY"), false);
});

test("No (mixed case) returns false", () => {
  assert.strictEqual(parseApprovalAnswer("No"), false);
});

// ---------------------------------------------------------------------------
// Whitespace handling
// ---------------------------------------------------------------------------

test("leading/trailing whitespace is trimmed for approve", () => {
  assert.strictEqual(parseApprovalAnswer("  yes  "), true);
});

test("leading/trailing whitespace is trimmed for deny", () => {
  assert.strictEqual(parseApprovalAnswer("  no  "), false);
});

test("whitespace-only returns null", () => {
  assert.strictEqual(parseApprovalAnswer("   "), null);
});
