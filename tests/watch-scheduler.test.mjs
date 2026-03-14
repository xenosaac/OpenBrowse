import test from "node:test";
import assert from "node:assert/strict";

import { IntervalWatchScheduler } from "../packages/scheduler/dist/index.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 500) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }

    await sleep(5);
  }

  throw new Error("Timed out waiting for scheduler state");
}

test("watch scheduler backs off after failure and resets after success", async () => {
  let attempts = 0;
  const scheduler = new IntervalWatchScheduler(
    async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("temporary outage");
      }
    },
    {
      minuteMs: 30,
      multiplier: 2,
      maxBackoffMinutes: 4
    }
  );

  const watchId = await scheduler.registerWatch(
    {
      id: "intent_watch_1",
      source: "scheduler",
      goal: "Monitor unread messages",
      constraints: [],
      metadata: {}
    },
    1
  );

  await waitFor(async () => attempts >= 1);

  let [watch] = await scheduler.listWatches();
  assert.equal(watch.id, watchId);
  assert.equal(watch.consecutiveFailures, 1);
  assert.match(watch.lastError ?? "", /temporary outage/);
  assert.ok(watch.backoffUntil);

  await waitFor(async () => attempts >= 2);

  [watch] = await scheduler.listWatches();
  assert.equal(watch.consecutiveFailures, 0);
  assert.equal(watch.lastError, undefined);
  assert.ok(watch.lastCompletedAt);
  assert.equal(watch.backoffUntil, undefined);

  await scheduler.dispose();
});
