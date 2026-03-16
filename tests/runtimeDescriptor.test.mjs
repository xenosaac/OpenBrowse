import test from "node:test";
import assert from "node:assert/strict";

import { buildRuntimeDescriptor } from "../packages/runtime-core/dist/runtimeDescriptor.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStatus(overrides = {}) {
  return {
    planner: { mode: "live", detail: "planner live" },
    browser: { mode: "live", detail: "browser live" },
    chatBridge: { mode: "live", detail: "chat live" },
    storage: { mode: "sqlite", detail: "sqlite active" },
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Phase 1 — browser stub
// ---------------------------------------------------------------------------

test("buildRuntimeDescriptor — phase 1 when browser is stub", () => {
  const result = buildRuntimeDescriptor(
    makeStatus({ browser: { mode: "stub", detail: "stub browser" } })
  );
  assert.equal(result.phase, "phase1");
  assert.equal(result.mode, "desktop_skeleton");
  assert.equal(result.notes.length, 3);
  assert.equal(result.deferredCapabilities.length, 4);
});

test("phase 1 regardless of chat/planner when browser is stub", () => {
  const result = buildRuntimeDescriptor(
    makeStatus({
      browser: { mode: "stub", detail: "stub" },
      chatBridge: { mode: "live", detail: "live" },
      planner: { mode: "live", detail: "live" },
      hasDemos: true
    })
  );
  assert.equal(result.phase, "phase1");
  assert.equal(result.mode, "desktop_skeleton");
});

test("phase 1 preserves input status fields", () => {
  const input = makeStatus({
    browser: { mode: "stub", detail: "stub" },
    storage: { mode: "memory", detail: "in-memory" }
  });
  const result = buildRuntimeDescriptor(input);
  assert.equal(result.storage.mode, "memory");
  assert.equal(result.storage.detail, "in-memory");
  assert.equal(result.planner.mode, "live");
});

// ---------------------------------------------------------------------------
// Phase 2 — browser live, chat stub
// ---------------------------------------------------------------------------

test("phase 2 when browser live but chat is stub", () => {
  const result = buildRuntimeDescriptor(
    makeStatus({ chatBridge: { mode: "stub", detail: "stub chat" } })
  );
  assert.equal(result.phase, "phase2");
  assert.equal(result.mode, "desktop_runtime");
  assert.equal(result.notes.length, 3);
});

test("phase 2 with stub planner includes planning in deferred", () => {
  const result = buildRuntimeDescriptor(
    makeStatus({
      chatBridge: { mode: "stub", detail: "stub" },
      planner: { mode: "stub", detail: "stub" }
    })
  );
  assert.equal(result.phase, "phase2");
  const deferred = result.deferredCapabilities;
  assert.ok(deferred.some(d => d.includes("Provider-backed planning")));
});

test("phase 2 with live planner includes demo flows in deferred instead", () => {
  const result = buildRuntimeDescriptor(
    makeStatus({
      chatBridge: { mode: "stub", detail: "stub" },
      planner: { mode: "live", detail: "live" }
    })
  );
  assert.equal(result.phase, "phase2");
  const deferred = result.deferredCapabilities;
  assert.ok(deferred.some(d => d.includes("Multi-site demo")));
  assert.ok(!deferred.some(d => d.includes("Provider-backed planning")));
});

// ---------------------------------------------------------------------------
// Phase 3 — browser + chat live, no demos
// ---------------------------------------------------------------------------

test("phase 3 when browser + chat live, no demos", () => {
  const result = buildRuntimeDescriptor(makeStatus());
  assert.equal(result.phase, "phase3");
  assert.equal(result.mode, "desktop_runtime");
  assert.equal(result.notes.length, 3);
});

test("phase 3 with hasDemos=false is same as no demos", () => {
  const result = buildRuntimeDescriptor(makeStatus({ hasDemos: false }));
  assert.equal(result.phase, "phase3");
});

test("phase 3 with hasDemos=undefined is same as no demos", () => {
  const result = buildRuntimeDescriptor(makeStatus({ hasDemos: undefined }));
  assert.equal(result.phase, "phase3");
});

test("phase 3 with stub planner includes planning deferred", () => {
  const result = buildRuntimeDescriptor(
    makeStatus({ planner: { mode: "stub", detail: "stub" } })
  );
  assert.equal(result.phase, "phase3");
  assert.ok(result.deferredCapabilities.some(d => d.includes("Provider-backed planning")));
});

test("phase 3 with live planner includes demo flows deferred", () => {
  const result = buildRuntimeDescriptor(makeStatus());
  assert.ok(result.deferredCapabilities.some(d => d.includes("Travel")));
});

// ---------------------------------------------------------------------------
// Phase 4 — browser + chat live + demos
// ---------------------------------------------------------------------------

test("phase 4 when all live + hasDemos", () => {
  const result = buildRuntimeDescriptor(makeStatus({ hasDemos: true }));
  assert.equal(result.phase, "phase4");
  assert.equal(result.mode, "desktop_runtime");
});

test("phase 4 with live planner omits API key deferred", () => {
  const result = buildRuntimeDescriptor(makeStatus({ hasDemos: true }));
  assert.ok(!result.deferredCapabilities.some(d => d.includes("ANTHROPIC_API_KEY")));
  assert.ok(result.notes.some(n => n.includes("live Claude planner")));
});

test("phase 4 with stub planner includes API key deferred", () => {
  const result = buildRuntimeDescriptor(
    makeStatus({
      hasDemos: true,
      planner: { mode: "stub", detail: "stub" }
    })
  );
  assert.equal(result.phase, "phase4");
  assert.ok(result.deferredCapabilities.some(d => d.includes("ANTHROPIC_API_KEY")));
  assert.ok(result.notes.some(n => n.includes("stub mode")));
});

test("phase 4 always includes code signing deferred", () => {
  const result = buildRuntimeDescriptor(makeStatus({ hasDemos: true }));
  assert.ok(result.deferredCapabilities.some(d => d.includes("code signing")));
});

// ---------------------------------------------------------------------------
// Cross-cutting
// ---------------------------------------------------------------------------

test("all phases return exactly the required descriptor shape", () => {
  const configs = [
    makeStatus({ browser: { mode: "stub", detail: "s" } }),
    makeStatus({ chatBridge: { mode: "stub", detail: "s" } }),
    makeStatus(),
    makeStatus({ hasDemos: true })
  ];

  for (const cfg of configs) {
    const result = buildRuntimeDescriptor(cfg);
    assert.ok(typeof result.phase === "string");
    assert.ok(typeof result.mode === "string");
    assert.ok(Array.isArray(result.notes));
    assert.ok(Array.isArray(result.deferredCapabilities));
    assert.ok(result.planner);
    assert.ok(result.browser);
    assert.ok(result.chatBridge);
    assert.ok(result.storage);
  }
});

test("input status objects are spread into result (not deep-cloned)", () => {
  const planner = { mode: "live", detail: "test" };
  const result = buildRuntimeDescriptor(makeStatus({ planner }));
  assert.equal(result.planner, planner);
});
