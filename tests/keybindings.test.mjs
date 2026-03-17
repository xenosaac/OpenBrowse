import { describe, it } from "node:test";
import assert from "node:assert/strict";

// The keybindings module lives in the renderer lib, built as part of the
// desktop app TypeScript. We import the compiled output from the dist.
// Since the module is pure logic with no DOM or Electron dependency,
// we can test it under plain Node.

// Build path — the desktop tsc outputs to apps/desktop/dist
import {
  DEFAULT_KEYBINDINGS,
  resolveBindings,
  matchesCombo,
  formatCombo,
  eventToCombo,
  serialiseOverrides,
  deserialiseOverrides,
} from "../apps/desktop/dist/renderer/lib/keybindings.js";

describe("keybindings registry", () => {
  it("DEFAULT_KEYBINDINGS has 11 entries", () => {
    assert.equal(DEFAULT_KEYBINDINGS.length, 11);
  });

  it("all entries have unique IDs", () => {
    const ids = DEFAULT_KEYBINDINGS.map((b) => b.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("all entries have valid categories", () => {
    const validCategories = new Set(["tabs", "navigation", "view", "tools"]);
    for (const def of DEFAULT_KEYBINDINGS) {
      assert.ok(validCategories.has(def.category), `${def.id} has invalid category: ${def.category}`);
    }
  });
});

describe("resolveBindings", () => {
  it("returns defaults when no overrides", () => {
    const map = resolveBindings({});
    assert.equal(map.size, 11);
    const newTab = map.get("newTab");
    assert.deepStrictEqual(newTab, { key: "t", meta: true });
  });

  it("applies overrides", () => {
    const map = resolveBindings({ newTab: { key: "n", meta: true, shift: true } });
    const newTab = map.get("newTab");
    assert.deepStrictEqual(newTab, { key: "n", meta: true, shift: true });
  });

  it("preserves non-overridden defaults", () => {
    const map = resolveBindings({ newTab: { key: "n", meta: true } });
    const closeTab = map.get("closeTab");
    assert.deepStrictEqual(closeTab, { key: "w", meta: true });
  });
});

describe("matchesCombo", () => {
  function fakeEvent(overrides) {
    return {
      key: "t",
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      ...overrides,
    };
  }

  it("matches exact combo", () => {
    const e = fakeEvent({ key: "t", metaKey: true });
    assert.ok(matchesCombo(e, { key: "t", meta: true }));
  });

  it("rejects wrong key", () => {
    const e = fakeEvent({ key: "w", metaKey: true });
    assert.ok(!matchesCombo(e, { key: "t", meta: true }));
  });

  it("rejects missing modifier", () => {
    const e = fakeEvent({ key: "t", metaKey: false });
    assert.ok(!matchesCombo(e, { key: "t", meta: true }));
  });

  it("rejects extra modifier", () => {
    const e = fakeEvent({ key: "t", metaKey: true, shiftKey: true });
    assert.ok(!matchesCombo(e, { key: "t", meta: true }));
  });

  it("matches shift combo", () => {
    const e = fakeEvent({ key: "t", metaKey: true, shiftKey: true });
    assert.ok(matchesCombo(e, { key: "t", meta: true, shift: true }));
  });

  it("is case-insensitive on key", () => {
    const e = fakeEvent({ key: "T", metaKey: true });
    assert.ok(matchesCombo(e, { key: "t", meta: true }));
  });
});

describe("formatCombo", () => {
  it("formats simple meta+key", () => {
    const result = formatCombo({ key: "t", meta: true });
    assert.equal(result, "\u2318T");
  });

  it("formats meta+shift+key", () => {
    const result = formatCombo({ key: "t", meta: true, shift: true });
    assert.equal(result, "\u2318\u21E7T");
  });

  it("formats special key display", () => {
    const result = formatCombo({ key: "=", meta: true });
    assert.equal(result, "\u2318+");
  });

  it("formats ctrl+alt combo", () => {
    const result = formatCombo({ key: "n", ctrl: true, alt: true });
    assert.equal(result, "Ctrl\u2325N");
  });
});

describe("eventToCombo", () => {
  function fakeEvent(overrides) {
    return {
      key: "a",
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      ...overrides,
    };
  }

  it("returns null for bare modifier press", () => {
    assert.equal(eventToCombo(fakeEvent({ key: "Meta", metaKey: true })), null);
  });

  it("returns null without any modifier", () => {
    assert.equal(eventToCombo(fakeEvent({ key: "a" })), null);
  });

  it("captures meta+key", () => {
    const combo = eventToCombo(fakeEvent({ key: "n", metaKey: true }));
    assert.deepStrictEqual(combo, { key: "n", meta: true });
  });

  it("captures meta+shift+key", () => {
    const combo = eventToCombo(fakeEvent({ key: "p", metaKey: true, shiftKey: true }));
    assert.deepStrictEqual(combo, { key: "p", meta: true, shift: true });
  });

  it("does not include false modifiers", () => {
    const combo = eventToCombo(fakeEvent({ key: "x", ctrlKey: true }));
    assert.deepStrictEqual(combo, { key: "x", ctrl: true });
    assert.ok(!("meta" in combo));
    assert.ok(!("shift" in combo));
    assert.ok(!("alt" in combo));
  });
});

describe("serialiseOverrides / deserialiseOverrides round-trip", () => {
  it("round-trips correctly", () => {
    const original = {
      newTab: { key: "n", meta: true, shift: true },
      zoomIn: { key: "=", ctrl: true },
    };
    const entries = serialiseOverrides(original);
    const restored = deserialiseOverrides(entries);
    assert.deepStrictEqual(restored, original);
  });

  it("skips malformed entries", () => {
    const entries = [
      { key: "newTab", value: JSON.stringify({ key: "n", meta: true }) },
      { key: "bad", value: "not-json{" },
    ];
    const result = deserialiseOverrides(entries);
    assert.equal(Object.keys(result).length, 1);
    assert.deepStrictEqual(result.newTab, { key: "n", meta: true });
  });

  it("returns empty for empty input", () => {
    assert.deepStrictEqual(deserialiseOverrides([]), {});
  });
});
