import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { navigateWithRetry } from "../packages/browser-runtime/dist/navigateRetry.js";

// Minimal classifyFn that mirrors the real classifyFailure behavior for tests
function classifyFn(message) {
  if (message.includes("ERR_ABORTED") || message.includes("ERR_NAME_NOT_RESOLVED")) return "network_error";
  if (message.includes("timed out")) return "navigation_timeout";
  if (message.includes("Invalid")) return "validation_error";
  return "interaction_failed";
}

describe("navigateWithRetry", () => {
  it("succeeds on first attempt without retrying", async () => {
    let callCount = 0;
    await navigateWithRetry(
      async () => { callCount++; },
      classifyFn,
      10 // short delay for tests
    );
    assert.equal(callCount, 1);
  });

  it("retries once on network_error and succeeds", async () => {
    let callCount = 0;
    await navigateWithRetry(
      async () => {
        callCount++;
        if (callCount === 1) throw new Error("ERR_ABORTED loading page");
        // second call succeeds
      },
      classifyFn,
      10
    );
    assert.equal(callCount, 2);
  });

  it("retries once on navigation_timeout and succeeds", async () => {
    let callCount = 0;
    await navigateWithRetry(
      async () => {
        callCount++;
        if (callCount === 1) throw new Error("Navigation timed out after 30000ms");
        // second call succeeds
      },
      classifyFn,
      10
    );
    assert.equal(callCount, 2);
  });

  it("throws retry error when both attempts fail with network_error", async () => {
    let callCount = 0;
    await assert.rejects(
      () => navigateWithRetry(
        async () => {
          callCount++;
          if (callCount === 1) throw new Error("ERR_ABORTED first");
          throw new Error("ERR_NAME_NOT_RESOLVED second");
        },
        classifyFn,
        10
      ),
      { message: "ERR_NAME_NOT_RESOLVED second" }
    );
    assert.equal(callCount, 2);
  });

  it("does NOT retry on validation_error", async () => {
    let callCount = 0;
    await assert.rejects(
      () => navigateWithRetry(
        async () => {
          callCount++;
          throw new Error("Invalid URL: bad");
        },
        classifyFn,
        10
      ),
      { message: "Invalid URL: bad" }
    );
    assert.equal(callCount, 1, "should not retry non-transient failure");
  });

  it("does NOT retry on interaction_failed", async () => {
    let callCount = 0;
    await assert.rejects(
      () => navigateWithRetry(
        async () => {
          callCount++;
          throw new Error("Something went wrong");
        },
        classifyFn,
        10
      ),
      { message: "Something went wrong" }
    );
    assert.equal(callCount, 1, "should not retry non-transient failure");
  });

  it("waits the specified delay before retrying", async () => {
    let callCount = 0;
    const start = Date.now();
    await navigateWithRetry(
      async () => {
        callCount++;
        if (callCount === 1) throw new Error("ERR_ABORTED");
      },
      classifyFn,
      50 // 50ms delay
    );
    const elapsed = Date.now() - start;
    assert.equal(callCount, 2);
    assert.ok(elapsed >= 40, `expected ≥40ms delay, got ${elapsed}ms`);
  });
});
