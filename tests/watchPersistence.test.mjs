import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// The persistence module is in the desktop app (Electron), but the functions
// are pure Node file I/O with no Electron dependencies. Import directly.
const { saveWatches, loadWatches } = await import(
  "../apps/desktop/src/main/runtime/watchPersistence.ts"
);

describe("watchPersistence", () => {
  let tmpDir;
  let filePath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ob-watch-test-"));
    filePath = path.join(tmpDir, "watches.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("save and load round-trip preserves watch data", async () => {
    const watches = [
      { goal: "check BTC price", startUrl: "https://coinbase.com", intervalMinutes: 15 },
      { goal: "monitor news", intervalMinutes: 60 },
    ];
    await saveWatches(filePath, watches);
    const loaded = await loadWatches(filePath);
    assert.deepStrictEqual(loaded, watches);
  });

  it("loadWatches returns empty array for missing file", async () => {
    const loaded = await loadWatches(path.join(tmpDir, "nonexistent.json"));
    assert.deepStrictEqual(loaded, []);
  });

  it("loadWatches returns empty array for corrupt JSON", async () => {
    fs.writeFileSync(filePath, "not json{{{", "utf-8");
    const loaded = await loadWatches(filePath);
    assert.deepStrictEqual(loaded, []);
  });

  it("loadWatches returns empty array for non-array JSON", async () => {
    fs.writeFileSync(filePath, JSON.stringify({ foo: "bar" }), "utf-8");
    const loaded = await loadWatches(filePath);
    assert.deepStrictEqual(loaded, []);
  });

  it("loadWatches filters out malformed entries", async () => {
    const data = [
      { goal: "valid watch", intervalMinutes: 5 },
      { goal: 123, intervalMinutes: 5 },       // goal is not string
      { goal: "missing interval" },             // no intervalMinutes
      null,
      { goal: "also valid", startUrl: "https://example.com", intervalMinutes: 30 },
    ];
    fs.writeFileSync(filePath, JSON.stringify(data), "utf-8");
    const loaded = await loadWatches(filePath);
    assert.equal(loaded.length, 2);
    assert.equal(loaded[0].goal, "valid watch");
    assert.equal(loaded[1].goal, "also valid");
    assert.equal(loaded[1].startUrl, "https://example.com");
  });

  it("saveWatches creates parent directories if needed", async () => {
    const nested = path.join(tmpDir, "a", "b", "watches.json");
    await saveWatches(nested, [{ goal: "test", intervalMinutes: 10 }]);
    const loaded = await loadWatches(nested);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].goal, "test");
  });

  it("saveWatches overwrites previous data", async () => {
    await saveWatches(filePath, [{ goal: "old", intervalMinutes: 5 }]);
    await saveWatches(filePath, [{ goal: "new", intervalMinutes: 10 }]);
    const loaded = await loadWatches(filePath);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].goal, "new");
    assert.equal(loaded[0].intervalMinutes, 10);
  });

  it("empty watches array round-trips correctly", async () => {
    await saveWatches(filePath, []);
    const loaded = await loadWatches(filePath);
    assert.deepStrictEqual(loaded, []);
  });
});
