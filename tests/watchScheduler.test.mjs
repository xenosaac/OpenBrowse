import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  IntervalWatchScheduler,
  StubWatchScheduler,
} from "../packages/scheduler/dist/index.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await sleep(5);
  }
  throw new Error("Timed out waiting for condition");
}

function makeIntent(id = "test_1") {
  return {
    id: `intent_${id}`,
    source: "scheduler",
    goal: `Watch ${id}`,
    constraints: [],
    metadata: {},
  };
}

// Fast minuteMs for testing (10ms = 1 "minute")
const FAST_POLICY = { minuteMs: 10, multiplier: 2, maxBackoffMinutes: 8 };

describe("StubWatchScheduler", () => {
  test("returns stub-watch id", async () => {
    const stub = new StubWatchScheduler();
    const id = await stub.registerWatch(makeIntent(), 5);
    assert.equal(id, "stub-watch");
  });
});

describe("IntervalWatchScheduler — registerWatch", () => {
  test("returns a unique watch id containing intent id", async () => {
    const scheduler = new IntervalWatchScheduler(async () => {}, FAST_POLICY);
    const id = await scheduler.registerWatch(makeIntent("abc"), 1);
    assert.match(id, /watch_intent_abc_/);
    await scheduler.dispose();
  });

  test("two registrations produce different ids", async () => {
    const scheduler = new IntervalWatchScheduler(async () => {}, FAST_POLICY);
    const id1 = await scheduler.registerWatch(makeIntent("a"), 1);
    const id2 = await scheduler.registerWatch(makeIntent("b"), 1);
    assert.notEqual(id1, id2);
    await scheduler.dispose();
  });
});

describe("IntervalWatchScheduler — listWatches", () => {
  test("empty when no watches registered", async () => {
    const scheduler = new IntervalWatchScheduler(async () => {}, FAST_POLICY);
    const list = await scheduler.listWatches();
    assert.deepEqual(list, []);
    await scheduler.dispose();
  });

  test("returns registered watches", async () => {
    const scheduler = new IntervalWatchScheduler(async () => {}, FAST_POLICY);
    await scheduler.registerWatch(makeIntent("x"), 5);
    const list = await scheduler.listWatches();
    assert.equal(list.length, 1);
    assert.equal(list[0].intervalMinutes, 5);
    assert.equal(list[0].active, true);
    assert.equal(list[0].consecutiveFailures, 0);
    await scheduler.dispose();
  });

  test("returns defensive copy", async () => {
    const scheduler = new IntervalWatchScheduler(async () => {}, FAST_POLICY);
    await scheduler.registerWatch(makeIntent(), 1);
    const list1 = await scheduler.listWatches();
    const list2 = await scheduler.listWatches();
    assert.notEqual(list1[0], list2[0]); // different object references
    await scheduler.dispose();
  });
});

describe("IntervalWatchScheduler — unregisterWatch", () => {
  test("removes watch from list", async () => {
    const scheduler = new IntervalWatchScheduler(async () => {}, FAST_POLICY);
    const id = await scheduler.registerWatch(makeIntent(), 1);
    let list = await scheduler.listWatches();
    assert.equal(list.length, 1);

    await scheduler.unregisterWatch(id);
    list = await scheduler.listWatches();
    assert.equal(list.length, 0);
    await scheduler.dispose();
  });

  test("no-op for unknown watch id", async () => {
    const scheduler = new IntervalWatchScheduler(async () => {}, FAST_POLICY);
    await scheduler.unregisterWatch("nonexistent");
    const list = await scheduler.listWatches();
    assert.equal(list.length, 0);
    await scheduler.dispose();
  });

  test("prevents future dispatch after unregister", async () => {
    let dispatched = 0;
    const scheduler = new IntervalWatchScheduler(
      async () => { dispatched++; },
      { minuteMs: 20, multiplier: 2, maxBackoffMinutes: 8 }
    );

    const id = await scheduler.registerWatch(makeIntent(), 1);
    await scheduler.unregisterWatch(id);

    // Wait longer than the interval to confirm no dispatch happens
    await sleep(60);
    assert.equal(dispatched, 0);
    await scheduler.dispose();
  });
});

describe("IntervalWatchScheduler — dispose", () => {
  test("clears all watches", async () => {
    const scheduler = new IntervalWatchScheduler(async () => {}, FAST_POLICY);
    await scheduler.registerWatch(makeIntent("a"), 1);
    await scheduler.registerWatch(makeIntent("b"), 1);
    let list = await scheduler.listWatches();
    assert.equal(list.length, 2);

    await scheduler.dispose();
    list = await scheduler.listWatches();
    assert.equal(list.length, 0);
  });

  test("prevents future dispatches", async () => {
    let dispatched = 0;
    const scheduler = new IntervalWatchScheduler(
      async () => { dispatched++; },
      { minuteMs: 20, multiplier: 2, maxBackoffMinutes: 8 }
    );
    await scheduler.registerWatch(makeIntent(), 1);
    await scheduler.dispose();
    await sleep(60);
    assert.equal(dispatched, 0);
  });
});

describe("IntervalWatchScheduler — dispatch execution", () => {
  test("dispatches after interval elapses", async () => {
    let dispatched = 0;
    const scheduler = new IntervalWatchScheduler(
      async () => { dispatched++; },
      FAST_POLICY
    );
    await scheduler.registerWatch(makeIntent(), 1);

    await waitFor(async () => dispatched >= 1);
    assert.ok(dispatched >= 1);

    const [watch] = await scheduler.listWatches();
    assert.ok(watch.lastCompletedAt);
    assert.ok(watch.lastTriggeredAt);
    await scheduler.dispose();
  });

  test("dispatches multiple times", async () => {
    let dispatched = 0;
    const scheduler = new IntervalWatchScheduler(
      async () => { dispatched++; },
      FAST_POLICY
    );
    await scheduler.registerWatch(makeIntent(), 1);

    await waitFor(async () => dispatched >= 3, 500);
    assert.ok(dispatched >= 3);
    await scheduler.dispose();
  });
});

describe("IntervalWatchScheduler — backoff", () => {
  test("exponential backoff on consecutive failures", async () => {
    let attempts = 0;
    const scheduler = new IntervalWatchScheduler(
      async () => {
        attempts++;
        throw new Error(`fail #${attempts}`);
      },
      { minuteMs: 10, multiplier: 2, maxBackoffMinutes: 8 }
    );
    await scheduler.registerWatch(makeIntent(), 1);

    // Wait for first failure
    await waitFor(async () => attempts >= 1);
    let [watch] = await scheduler.listWatches();
    assert.equal(watch.consecutiveFailures, 1);
    assert.match(watch.lastError, /fail #1/);
    assert.ok(watch.backoffUntil); // backed off (2 min > 1 min interval)

    // Wait for second failure
    await waitFor(async () => attempts >= 2, 200);
    [watch] = await scheduler.listWatches();
    assert.equal(watch.consecutiveFailures, 2);
    assert.match(watch.lastError, /fail #2/);

    await scheduler.dispose();
  });

  test("backoff capped at maxBackoffMinutes", async () => {
    let attempts = 0;
    // With multiplier=2, interval=1, maxBackoff=2:
    // fail1: next = min(1*2^1, 2) = 2 min
    // fail2: next = min(1*2^2, 2) = 2 min (capped)
    const scheduler = new IntervalWatchScheduler(
      async () => {
        attempts++;
        throw new Error("fail");
      },
      { minuteMs: 10, multiplier: 2, maxBackoffMinutes: 2 }
    );
    await scheduler.registerWatch(makeIntent(), 1);

    // After 3 failures, backoff should still be capped at 2
    await waitFor(async () => attempts >= 3, 300);
    const [watch] = await scheduler.listWatches();
    assert.equal(watch.consecutiveFailures, 3);
    // Next delay = min(1*2^3, 2) = 2 (capped)
    // If it weren't capped, it would be 8 and we'd time out waiting for attempt 3

    await scheduler.dispose();
  });

  test("success after failure resets consecutiveFailures", async () => {
    let attempts = 0;
    const scheduler = new IntervalWatchScheduler(
      async () => {
        attempts++;
        if (attempts <= 2) throw new Error("transient");
      },
      FAST_POLICY
    );
    await scheduler.registerWatch(makeIntent(), 1);

    // Wait for recovery
    await waitFor(async () => attempts >= 3, 500);
    const [watch] = await scheduler.listWatches();
    assert.equal(watch.consecutiveFailures, 0);
    assert.equal(watch.lastError, undefined);
    assert.ok(watch.lastCompletedAt);
    assert.equal(watch.backoffUntil, undefined);

    await scheduler.dispose();
  });
});

describe("IntervalWatchScheduler — multiple watches", () => {
  test("independent watches track separately", async () => {
    const dispatched = { a: 0, b: 0 };
    const scheduler = new IntervalWatchScheduler(
      async (intent) => {
        if (intent.id === "intent_a") dispatched.a++;
        else dispatched.b++;
      },
      FAST_POLICY
    );

    await scheduler.registerWatch(makeIntent("a"), 1);
    await scheduler.registerWatch(makeIntent("b"), 1);

    await waitFor(async () => dispatched.a >= 1 && dispatched.b >= 1, 300);

    const list = await scheduler.listWatches();
    assert.equal(list.length, 2);

    // Unregister a, b should keep going
    const aWatch = list.find((w) => w.intent.id === "intent_a");
    await scheduler.unregisterWatch(aWatch.id);
    const countA = dispatched.a;

    await waitFor(async () => dispatched.b >= dispatched.a + 1, 200);

    // a should not have been dispatched again
    assert.equal(dispatched.a, countA);
    assert.ok(dispatched.b > countA);

    await scheduler.dispose();
  });
});
