import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSemver, isNewerVersion } from "../packages/runtime-core/src/checkForUpdate.ts";

describe("parseSemver", () => {
  it("parses standard semver", () => {
    assert.deepStrictEqual(parseSemver("1.2.3"), [1, 2, 3]);
  });

  it("strips leading v", () => {
    assert.deepStrictEqual(parseSemver("v0.1.0"), [0, 1, 0]);
  });

  it("handles missing minor/patch", () => {
    assert.deepStrictEqual(parseSemver("2"), [2, 0, 0]);
    assert.deepStrictEqual(parseSemver("3.4"), [3, 4, 0]);
  });

  it("returns [0,0,0] for empty string", () => {
    assert.deepStrictEqual(parseSemver(""), [0, 0, 0]);
  });

  it("returns [0,0,0] for garbage input", () => {
    assert.deepStrictEqual(parseSemver("abc"), [0, 0, 0]);
  });

  it("trims whitespace", () => {
    assert.deepStrictEqual(parseSemver("  v1.0.5  "), [1, 0, 5]);
  });
});

describe("isNewerVersion", () => {
  it("returns true when latest major is higher", () => {
    assert.strictEqual(isNewerVersion("0.1.0", "1.0.0"), true);
  });

  it("returns true when latest minor is higher", () => {
    assert.strictEqual(isNewerVersion("0.1.0", "0.2.0"), true);
  });

  it("returns true when latest patch is higher", () => {
    assert.strictEqual(isNewerVersion("0.1.0", "0.1.1"), true);
  });

  it("returns false when versions are equal", () => {
    assert.strictEqual(isNewerVersion("0.1.0", "0.1.0"), false);
  });

  it("returns false when current is newer", () => {
    assert.strictEqual(isNewerVersion("1.0.0", "0.9.9"), false);
  });

  it("handles v prefix on latest", () => {
    assert.strictEqual(isNewerVersion("0.1.0", "v0.2.0"), true);
  });

  it("handles v prefix on both", () => {
    assert.strictEqual(isNewerVersion("v0.1.0", "v0.1.0"), false);
  });

  it("handles major downgrade with minor upgrade", () => {
    assert.strictEqual(isNewerVersion("2.0.0", "1.9.9"), false);
  });
});
