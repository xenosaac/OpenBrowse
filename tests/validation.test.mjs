import test from "node:test";
import assert from "node:assert/strict";

import {
  validateElementTargetId,
  validateUrl,
  validateScrollDirection,
} from "../packages/browser-runtime/dist/validation.js";

// --- validateElementTargetId ---

test("validateElementTargetId: parses valid el_0", () => {
  assert.equal(validateElementTargetId("el_0"), 0);
});

test("validateElementTargetId: parses valid el_42", () => {
  assert.equal(validateElementTargetId("el_42"), 42);
});

test("validateElementTargetId: parses large index", () => {
  assert.equal(validateElementTargetId("el_999"), 999);
});

test("validateElementTargetId: rejects empty string", () => {
  assert.throws(() => validateElementTargetId(""), /Invalid element target ID/);
});

test("validateElementTargetId: rejects missing prefix", () => {
  assert.throws(() => validateElementTargetId("42"), /Invalid element target ID/);
});

test("validateElementTargetId: rejects wrong prefix", () => {
  assert.throws(() => validateElementTargetId("elem_5"), /Invalid element target ID/);
});

test("validateElementTargetId: rejects negative index", () => {
  assert.throws(() => validateElementTargetId("el_-1"), /Invalid element target ID/);
});

test("validateElementTargetId: rejects non-numeric suffix", () => {
  assert.throws(() => validateElementTargetId("el_abc"), /Invalid element target ID/);
});

test("validateElementTargetId: rejects trailing characters", () => {
  assert.throws(() => validateElementTargetId("el_5_extra"), /Invalid element target ID/);
});

// --- validateUrl ---

test("validateUrl: accepts http URL", () => {
  assert.equal(validateUrl("http://example.com"), "http://example.com/");
});

test("validateUrl: accepts https URL", () => {
  assert.equal(validateUrl("https://example.com/path?q=1"), "https://example.com/path?q=1");
});

test("validateUrl: accepts about:blank", () => {
  assert.equal(validateUrl("about:blank"), "about:blank");
});

test("validateUrl: rejects javascript: URL", () => {
  assert.throws(() => validateUrl("javascript:alert(1)"), /Disallowed URL scheme/);
});

test("validateUrl: rejects data: URL", () => {
  assert.throws(() => validateUrl("data:text/html,<h1>Hi</h1>"), /Disallowed URL scheme/);
});

test("validateUrl: rejects file: URL", () => {
  assert.throws(() => validateUrl("file:///etc/passwd"), /Disallowed URL scheme/);
});

test("validateUrl: rejects ftp: URL", () => {
  assert.throws(() => validateUrl("ftp://ftp.example.com"), /Disallowed URL scheme/);
});

test("validateUrl: rejects invalid URL format", () => {
  assert.throws(() => validateUrl("not a url at all"), /Invalid URL/);
});

test("validateUrl: rejects empty string", () => {
  assert.throws(() => validateUrl(""), /Invalid URL/);
});

// --- validateScrollDirection ---

test("validateScrollDirection: accepts 'up'", () => {
  assert.equal(validateScrollDirection("up"), "up");
});

test("validateScrollDirection: accepts 'down'", () => {
  assert.equal(validateScrollDirection("down"), "down");
});

test("validateScrollDirection: normalizes 'UP' to 'up'", () => {
  assert.equal(validateScrollDirection("UP"), "up");
});

test("validateScrollDirection: normalizes 'Down' to 'down'", () => {
  assert.equal(validateScrollDirection("Down"), "down");
});

test("validateScrollDirection: trims whitespace", () => {
  assert.equal(validateScrollDirection("  up  "), "up");
});

test("validateScrollDirection: rejects 'left'", () => {
  assert.throws(() => validateScrollDirection("left"), /Invalid scroll direction/);
});

test("validateScrollDirection: rejects empty string", () => {
  assert.throws(() => validateScrollDirection(""), /Invalid scroll direction/);
});

test("validateScrollDirection: rejects arbitrary string", () => {
  assert.throws(() => validateScrollDirection("sideways"), /Invalid scroll direction/);
});
