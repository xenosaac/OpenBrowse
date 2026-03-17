import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// Provide a minimal globalThis.window so the module can load.
// Each test overrides window.openbrowse to simulate failures.
const originalWindow = globalThis.window;

beforeEach(() => {
  globalThis.window = /** @type {any} */ ({});
});

afterEach(() => {
  if (originalWindow !== undefined) {
    globalThis.window = originalWindow;
  } else {
    delete globalThis.window;
  }
});

describe("safeCall", () => {
  it("returns the result when the function succeeds (sync)", async () => {
    const { safeCall } = await import(
      "../apps/desktop/src/renderer/lib/ipc.ts"
    );
    const result = await safeCall(() => [1, 2, 3], [], "test:sync");
    assert.deepEqual(result, [1, 2, 3]);
  });

  it("returns the result when the function succeeds (async)", async () => {
    const { safeCall } = await import(
      "../apps/desktop/src/renderer/lib/ipc.ts"
    );
    const result = await safeCall(
      () => Promise.resolve({ ok: true }),
      { ok: false },
      "test:async"
    );
    assert.deepEqual(result, { ok: true });
  });

  it("returns the fallback when the function throws synchronously", async () => {
    const { safeCall } = await import(
      "../apps/desktop/src/renderer/lib/ipc.ts"
    );
    const result = await safeCall(
      () => { throw new Error("handler missing"); },
      [],
      "test:syncThrow"
    );
    assert.deepEqual(result, []);
  });

  it("returns the fallback when the promise rejects", async () => {
    const { safeCall } = await import(
      "../apps/desktop/src/renderer/lib/ipc.ts"
    );
    const result = await safeCall(
      () => Promise.reject(new Error("IPC timeout")),
      null,
      "test:asyncReject"
    );
    assert.equal(result, null);
  });
});

describe("safeVoid", () => {
  it("does not throw when the function succeeds", async () => {
    const { safeVoid } = await import(
      "../apps/desktop/src/renderer/lib/ipc.ts"
    );
    let called = false;
    safeVoid(() => { called = true; }, "test:void");
    assert.equal(called, true);
  });

  it("swallows synchronous throw without crashing", async () => {
    const { safeVoid } = await import(
      "../apps/desktop/src/renderer/lib/ipc.ts"
    );
    // Should not throw
    safeVoid(() => { throw new Error("missing handler"); }, "test:voidThrow");
  });
});

describe("ipc degradation (integrated)", () => {
  it("tasks.list returns empty array when handler is missing", async () => {
    globalThis.window = /** @type {any} */ ({
      openbrowse: {}  // listRuns not defined
    });
    // Re-import to pick up the new window mock
    const mod = await import(
      "../apps/desktop/src/renderer/lib/ipc.ts?" + Date.now() + "a"
    );
    const result = await mod.ipc.tasks.list();
    assert.deepEqual(result, []);
  });

  it("tasks.get returns null when handler rejects", async () => {
    globalThis.window = /** @type {any} */ ({
      openbrowse: {
        getRun: () => Promise.reject(new Error("no such run")),
      },
    });
    const mod = await import(
      "../apps/desktop/src/renderer/lib/ipc.ts?" + Date.now() + "b"
    );
    const result = await mod.ipc.tasks.get("run_123");
    assert.equal(result, null);
  });

  it("scheduler.unregister returns { ok: false } when handler throws", async () => {
    globalThis.window = /** @type {any} */ ({
      openbrowse: {
        unregisterWatch: () => { throw new Error("not registered"); },
      },
    });
    const mod = await import(
      "../apps/desktop/src/renderer/lib/ipc.ts?" + Date.now() + "c"
    );
    const result = await mod.ipc.scheduler.unregister("watch_1");
    assert.deepEqual(result, { ok: false });
  });

  it("templates.delete returns { ok: false } when handler is missing", async () => {
    globalThis.window = /** @type {any} */ ({
      openbrowse: {},
    });
    const mod = await import(
      "../apps/desktop/src/renderer/lib/ipc.ts?" + Date.now() + "d"
    );
    const result = await mod.ipc.templates.delete("tpl_123");
    assert.deepEqual(result, { ok: false });
  });

  it("events.subscribe returns no-op cleanup when handler throws", async () => {
    globalThis.window = /** @type {any} */ ({
      openbrowse: {},  // onRuntimeEvent not defined
    });
    const mod = await import(
      "../apps/desktop/src/renderer/lib/ipc.ts?" + Date.now() + "e"
    );
    const cleanup = mod.ipc.events.subscribe(() => {});
    assert.equal(typeof cleanup, "function");
    // Calling the no-op cleanup should not throw
    cleanup();
  });

  it("browser.showSession does not throw when handler is missing", async () => {
    globalThis.window = /** @type {any} */ ({
      openbrowse: {},
    });
    const mod = await import(
      "../apps/desktop/src/renderer/lib/ipc.ts?" + Date.now() + "f"
    );
    // Should not throw
    mod.ipc.browser.showSession("session_123");
  });

  it("scheduler.list returns empty array when handler is missing", async () => {
    globalThis.window = /** @type {any} */ ({
      openbrowse: {},
    });
    const mod = await import(
      "../apps/desktop/src/renderer/lib/ipc.ts?" + Date.now() + "g"
    );
    const result = await mod.ipc.scheduler.list();
    assert.deepEqual(result, []);
  });
});
