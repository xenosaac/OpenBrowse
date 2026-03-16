import test from "node:test";
import assert from "node:assert/strict";

import { LogReplayer } from "../packages/observability/dist/LogReplayer.js";

// --- Helper: mock WorkflowLogReader ---

function makeReader(eventsByRun) {
  return {
    async listByRun(runId) {
      return eventsByRun[runId] ?? [];
    }
  };
}

function makeEvent(overrides = {}) {
  return {
    id: "evt_1",
    runId: "run_1",
    type: "browser_action_executed",
    summary: "Clicked button",
    createdAt: "2026-03-16T10:00:00.000Z",
    payload: {},
    ...overrides
  };
}

// --- replay ---

test("LogReplayer.replay: returns empty array for unknown run", async () => {
  const replayer = new LogReplayer(makeReader({}));
  const result = await replayer.replay("run_nonexistent");
  assert.deepEqual(result, []);
});

test("LogReplayer.replay: returns single step with elapsed=0", async () => {
  const event = makeEvent();
  const replayer = new LogReplayer(makeReader({ run_1: [event] }));
  const steps = await replayer.replay("run_1");
  assert.equal(steps.length, 1);
  assert.equal(steps[0].index, 0);
  assert.equal(steps[0].elapsed, 0);
  assert.strictEqual(steps[0].event, event);
});

test("LogReplayer.replay: computes elapsed times from first event", async () => {
  const events = [
    makeEvent({ id: "e1", createdAt: "2026-03-16T10:00:00.000Z" }),
    makeEvent({ id: "e2", createdAt: "2026-03-16T10:00:02.500Z" }),
    makeEvent({ id: "e3", createdAt: "2026-03-16T10:00:10.000Z" })
  ];
  const replayer = new LogReplayer(makeReader({ run_1: events }));
  const steps = await replayer.replay("run_1");
  assert.equal(steps.length, 3);
  assert.equal(steps[0].elapsed, 0);
  assert.equal(steps[1].elapsed, 2500);
  assert.equal(steps[2].elapsed, 10000);
  assert.equal(steps[0].index, 0);
  assert.equal(steps[1].index, 1);
  assert.equal(steps[2].index, 2);
});

test("LogReplayer.replay: preserves event references", async () => {
  const event = makeEvent();
  const replayer = new LogReplayer(makeReader({ run_1: [event] }));
  const steps = await replayer.replay("run_1");
  assert.strictEqual(steps[0].event, event);
});

// --- replayFormatted ---

test("LogReplayer.replayFormatted: returns no-events message for empty run", async () => {
  const replayer = new LogReplayer(makeReader({}));
  const result = await replayer.replayFormatted("run_1");
  assert.equal(result, "No events found for run run_1");
});

test("LogReplayer.replayFormatted: formats single event with +0.0s", async () => {
  const event = makeEvent({ type: "run_created", summary: "Task started: Buy tickets" });
  const replayer = new LogReplayer(makeReader({ run_1: [event] }));
  const result = await replayer.replayFormatted("run_1");
  assert.equal(result, "[+0.0s] run_created: Task started: Buy tickets");
});

test("LogReplayer.replayFormatted: formats multiple events with elapsed times", async () => {
  const events = [
    makeEvent({ id: "e1", type: "run_created", summary: "Started", createdAt: "2026-03-16T10:00:00.000Z" }),
    makeEvent({ id: "e2", type: "browser_action_executed", summary: "Clicked", createdAt: "2026-03-16T10:00:03.200Z" }),
    makeEvent({ id: "e3", type: "run_completed", summary: "Done", createdAt: "2026-03-16T10:00:15.750Z" })
  ];
  const replayer = new LogReplayer(makeReader({ run_1: events }));
  const result = await replayer.replayFormatted("run_1");
  const lines = result.split("\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[0], "[+0.0s] run_created: Started");
  assert.equal(lines[1], "[+3.2s] browser_action_executed: Clicked");
  assert.equal(lines[2], "[+15.8s] run_completed: Done");
});

test("LogReplayer.replay: different runIds return independent results", async () => {
  const eventsA = [makeEvent({ id: "e1", runId: "run_a" })];
  const eventsB = [
    makeEvent({ id: "e2", runId: "run_b", createdAt: "2026-03-16T11:00:00.000Z" }),
    makeEvent({ id: "e3", runId: "run_b", createdAt: "2026-03-16T11:00:05.000Z" })
  ];
  const replayer = new LogReplayer(makeReader({ run_a: eventsA, run_b: eventsB }));
  const stepsA = await replayer.replay("run_a");
  const stepsB = await replayer.replay("run_b");
  assert.equal(stepsA.length, 1);
  assert.equal(stepsB.length, 2);
  assert.equal(stepsB[1].elapsed, 5000);
});
