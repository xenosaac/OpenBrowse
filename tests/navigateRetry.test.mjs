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

  it("retries twice (double-retry) and succeeds on third attempt", async () => {
    let callCount = 0;
    await navigateWithRetry(
      async () => {
        callCount++;
        if (callCount <= 2) throw new Error("ERR_ABORTED transient");
        // third call succeeds
      },
      classifyFn,
      10
    );
    assert.equal(callCount, 3, "should attempt initial + 2 retries");
  });

  it("throws last error when all 3 attempts fail with network_error", async () => {
    let callCount = 0;
    await assert.rejects(
      () => navigateWithRetry(
        async () => {
          callCount++;
          if (callCount === 1) throw new Error("ERR_ABORTED first");
          if (callCount === 2) throw new Error("ERR_ABORTED second");
          throw new Error("ERR_NAME_NOT_RESOLVED third");
        },
        classifyFn,
        10
      ),
      { message: "ERR_NAME_NOT_RESOLVED third" }
    );
    assert.equal(callCount, 3, "should attempt initial + 2 retries before giving up");
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

  it("uses exponential backoff between retries", async () => {
    let callCount = 0;
    const timestamps = [];
    await navigateWithRetry(
      async () => {
        callCount++;
        timestamps.push(Date.now());
        if (callCount <= 2) throw new Error("ERR_ABORTED");
        // third call succeeds
      },
      classifyFn,
      50 // base delay 50ms, so retries at ~50ms and ~100ms
    );
    assert.equal(callCount, 3);
    const firstDelay = timestamps[1] - timestamps[0];
    const secondDelay = timestamps[2] - timestamps[1];
    assert.ok(firstDelay >= 40, `first delay should be ~50ms, got ${firstDelay}ms`);
    assert.ok(secondDelay >= 80, `second delay should be ~100ms (2x), got ${secondDelay}ms`);
    assert.ok(secondDelay > firstDelay, `second delay (${secondDelay}ms) should be longer than first (${firstDelay}ms)`);
  });

  it("respects maxRetries=1 for single retry behavior", async () => {
    let callCount = 0;
    await assert.rejects(
      () => navigateWithRetry(
        async () => {
          callCount++;
          throw new Error("ERR_ABORTED");
        },
        classifyFn,
        10,
        1 // single retry
      ),
      { message: "ERR_ABORTED" }
    );
    assert.equal(callCount, 2, "initial + 1 retry = 2 calls");
  });

  it("stops retrying when a non-retryable error occurs on retry", async () => {
    let callCount = 0;
    await assert.rejects(
      () => navigateWithRetry(
        async () => {
          callCount++;
          if (callCount === 1) throw new Error("ERR_ABORTED transient");
          throw new Error("Invalid URL: permanent");
        },
        classifyFn,
        10
      ),
      { message: "Invalid URL: permanent" }
    );
    assert.equal(callCount, 2, "should stop on non-retryable error during retry");
  });
});
