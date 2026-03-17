import test from "node:test";
import assert from "node:assert/strict";

import {
  validateElementTargetId,
  validateUrl,
  validateScrollDirection,
  classifyFailure,
  parseKeyboardShortcut,
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

// --- Frame-prefixed element IDs (iframe support) ---

test("validateElementTargetId: accepts frame0_el_0", () => {
  assert.equal(validateElementTargetId("frame0_el_0"), 0);
});

test("validateElementTargetId: accepts frame2_el_15", () => {
  assert.equal(validateElementTargetId("frame2_el_15"), 15);
});

test("validateElementTargetId: rejects frameX_el_5 (non-numeric frame index)", () => {
  assert.throws(() => validateElementTargetId("frameX_el_5"), /Invalid element target ID/);
});

test("validateElementTargetId: rejects frame0_5 (missing el_ prefix)", () => {
  assert.throws(() => validateElementTargetId("frame0_5"), /Invalid element target ID/);
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

// --- classifyFailure ---

test("classifyFailure: 'Target not found' → element_not_found", () => {
  assert.equal(classifyFailure("Target not found: el_5"), "element_not_found");
});

test("classifyFailure: generic 'not found' → element_not_found", () => {
  assert.equal(classifyFailure("Element not found on page"), "element_not_found");
});

test("classifyFailure: 'timed out' → navigation_timeout", () => {
  assert.equal(classifyFailure("Navigation to https://example.com timed out after 30000ms"), "navigation_timeout");
});

test("classifyFailure: 'timeout' → navigation_timeout", () => {
  assert.equal(classifyFailure("Connection timeout"), "navigation_timeout");
});

test("classifyFailure: 'Invalid' → validation_error", () => {
  assert.equal(classifyFailure("Invalid element target ID: bad"), "validation_error");
});

test("classifyFailure: 'Disallowed' → validation_error", () => {
  assert.equal(classifyFailure("Disallowed URL scheme: javascript:"), "validation_error");
});

test("classifyFailure: ERR_NAME_NOT_RESOLVED → network_error", () => {
  assert.equal(classifyFailure("net::ERR_NAME_NOT_RESOLVED"), "network_error");
});

test("classifyFailure: ERR_CONNECTION_REFUSED → network_error", () => {
  assert.equal(classifyFailure("net::ERR_CONNECTION_REFUSED"), "network_error");
});

test("classifyFailure: ERR_INTERNET_DISCONNECTED → network_error", () => {
  assert.equal(classifyFailure("ERR_INTERNET_DISCONNECTED"), "network_error");
});

test("classifyFailure: ERR_NETWORK → network_error", () => {
  assert.equal(classifyFailure("ERR_NETWORK_CHANGED"), "network_error");
});

test("classifyFailure: ERR_SSL → network_error", () => {
  assert.equal(classifyFailure("ERR_SSL_PROTOCOL_ERROR"), "network_error");
});

test("classifyFailure: ERR_ABORTED → network_error", () => {
  assert.equal(classifyFailure("ERR_ABORTED"), "network_error");
});

test("classifyFailure: ERR_BLOCKED → network_error", () => {
  assert.equal(classifyFailure("ERR_BLOCKED_BY_CLIENT"), "network_error");
});

test("classifyFailure: generic net::ERR_ → network_error", () => {
  assert.equal(classifyFailure("net::ERR_CERT_COMMON_NAME_INVALID"), "network_error");
});

test("classifyFailure: unknown error → interaction_failed", () => {
  assert.equal(classifyFailure("Something went wrong"), "interaction_failed");
});

test("classifyFailure: empty string → interaction_failed", () => {
  assert.equal(classifyFailure(""), "interaction_failed");
});

test("classifyFailure: priority — 'not found' before 'timed out'", () => {
  // 'not found' is checked first, so it wins if both match
  assert.equal(classifyFailure("not found and timed out"), "element_not_found");
});

// --- parseKeyboardShortcut ---

test("parseKeyboardShortcut: simple letter key", () => {
  const { modifiers, key } = parseKeyboardShortcut("a");
  assert.equal(modifiers, 0);
  assert.equal(key, "a");
});

test("parseKeyboardShortcut: Ctrl+A", () => {
  const { modifiers, key } = parseKeyboardShortcut("Ctrl+A");
  assert.equal(modifiers, 2); // Ctrl=2
  assert.equal(key, "A");
});

test("parseKeyboardShortcut: Shift+Tab", () => {
  const { modifiers, key } = parseKeyboardShortcut("Shift+Tab");
  assert.equal(modifiers, 4); // Shift=4
  assert.equal(key, "Tab");
});

test("parseKeyboardShortcut: Ctrl+Shift+Enter", () => {
  const { modifiers, key } = parseKeyboardShortcut("Ctrl+Shift+Enter");
  assert.equal(modifiers, 6); // Ctrl=2 | Shift=4
  assert.equal(key, "Return");
});

test("parseKeyboardShortcut: Alt+Escape", () => {
  const { modifiers, key } = parseKeyboardShortcut("Alt+Escape");
  assert.equal(modifiers, 1); // Alt=1
  assert.equal(key, "Escape");
});

test("parseKeyboardShortcut: Meta+Backspace", () => {
  const { modifiers, key } = parseKeyboardShortcut("Meta+Backspace");
  assert.equal(modifiers, 8); // Meta=8
  assert.equal(key, "Backspace");
});

test("parseKeyboardShortcut: Cmd maps to Meta (8)", () => {
  const { modifiers, key } = parseKeyboardShortcut("Cmd+C");
  assert.equal(modifiers, 8);
  assert.equal(key, "C");
});

test("parseKeyboardShortcut: Enter → Return", () => {
  const { modifiers, key } = parseKeyboardShortcut("Enter");
  assert.equal(modifiers, 0);
  assert.equal(key, "Return");
});

test("parseKeyboardShortcut: Space → ' '", () => {
  const { modifiers, key } = parseKeyboardShortcut("Space");
  assert.equal(modifiers, 0);
  assert.equal(key, " ");
});

test("parseKeyboardShortcut: ArrowUp → ArrowUp", () => {
  const { modifiers, key } = parseKeyboardShortcut("ArrowUp");
  assert.equal(key, "ArrowUp");
});

test("parseKeyboardShortcut: Delete key", () => {
  const { modifiers, key } = parseKeyboardShortcut("Delete");
  assert.equal(modifiers, 0);
  assert.equal(key, "Delete");
});

test("parseKeyboardShortcut: arrow keys all resolve", () => {
  assert.equal(parseKeyboardShortcut("ArrowDown").key, "ArrowDown");
  assert.equal(parseKeyboardShortcut("ArrowLeft").key, "ArrowLeft");
  assert.equal(parseKeyboardShortcut("ArrowRight").key, "ArrowRight");
});

test("parseKeyboardShortcut: all modifiers combined", () => {
  const { modifiers } = parseKeyboardShortcut("Ctrl+Shift+Alt+Meta+x");
  assert.equal(modifiers, 2 | 4 | 1 | 8); // 15
});

test("parseKeyboardShortcut: handles whitespace around parts", () => {
  const { modifiers, key } = parseKeyboardShortcut("Ctrl + Shift + a");
  assert.equal(modifiers, 6);
  assert.equal(key, "a");
});

test("parseKeyboardShortcut: unknown key passes through", () => {
  const { key } = parseKeyboardShortcut("F5");
  assert.equal(key, "F5");
});
