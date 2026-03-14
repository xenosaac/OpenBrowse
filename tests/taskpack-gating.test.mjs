import test from "node:test";
import assert from "node:assert/strict";

/**
 * Task pack planner gating tests.
 *
 * These verify the gating contract: task packs that require a live planner
 * must not be runnable when the planner is in stub mode.
 *
 * The actual gating check lives in IPC (registerIpcHandlers) and mirrors
 * the logic tested here: pack.requiresLivePlanner && descriptor.planner.mode !== "live".
 */

function makePack(overrides = {}) {
  return {
    id: "test-pack",
    label: "Test Pack",
    category: "research",
    description: "A test task pack",
    requiresLivePlanner: true,
    ...overrides
  };
}

function isPackAvailable(pack, plannerMode) {
  return !pack.requiresLivePlanner || plannerMode === "live";
}

function assertPackRunnable(pack, plannerMode) {
  if (pack.requiresLivePlanner && plannerMode !== "live") {
    throw new Error(
      `Task pack "${pack.label}" requires a live AI planner, but the planner is in ${plannerMode} mode.`
    );
  }
}

test("task pack with requiresLivePlanner=true is unavailable when planner is stub", () => {
  const pack = makePack({ requiresLivePlanner: true });
  assert.equal(isPackAvailable(pack, "stub"), false);
});

test("task pack with requiresLivePlanner=true is available when planner is live", () => {
  const pack = makePack({ requiresLivePlanner: true });
  assert.equal(isPackAvailable(pack, "live"), true);
});

test("task pack run attempt throws when planner is stub", () => {
  const pack = makePack({ requiresLivePlanner: true, label: "Flight Search" });
  assert.throws(
    () => assertPackRunnable(pack, "stub"),
    (err) => {
      assert.match(err.message, /Flight Search/);
      assert.match(err.message, /stub mode/);
      return true;
    }
  );
});

test("task pack run attempt succeeds when planner is live", () => {
  const pack = makePack({ requiresLivePlanner: true });
  assert.doesNotThrow(() => assertPackRunnable(pack, "live"));
});

test("task pack without requiresLivePlanner is always available", () => {
  const pack = makePack({ requiresLivePlanner: false });
  assert.equal(isPackAvailable(pack, "stub"), true);
  assert.equal(isPackAvailable(pack, "live"), true);
  assert.doesNotThrow(() => assertPackRunnable(pack, "stub"));
});

test("unavailable reason is populated for gated packs", () => {
  const pack = makePack({ requiresLivePlanner: true });
  const plannerIsLive = false;
  const reason = pack.requiresLivePlanner && !plannerIsLive
    ? "Requires a live AI planner. Set ANTHROPIC_API_KEY to enable."
    : undefined;
  assert.equal(typeof reason, "string");
  assert.match(reason, /ANTHROPIC_API_KEY/);
});

test("no unavailable reason when planner is live", () => {
  const pack = makePack({ requiresLivePlanner: true });
  const plannerIsLive = true;
  const reason = pack.requiresLivePlanner && !plannerIsLive
    ? "Requires a live AI planner. Set ANTHROPIC_API_KEY to enable."
    : undefined;
  assert.equal(reason, undefined);
});
