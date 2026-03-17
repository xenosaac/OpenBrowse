import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { computeRunAnalytics } = await import(
  "../apps/desktop/src/renderer/lib/runAnalytics.ts"
);

function makeRun(overrides = {}) {
  return {
    id: `run_${Math.random().toString(36).slice(2)}`,
    goal: "test goal",
    status: "completed",
    updatedAt: "2026-03-17T10:00:00Z",
    checkpoint: { stepCount: 3 },
    ...overrides,
  };
}

describe("computeRunAnalytics", () => {
  it("returns zeroed analytics for empty array", () => {
    const result = computeRunAnalytics([]);
    assert.equal(result.totalRuns, 0);
    assert.equal(result.completed, 0);
    assert.equal(result.failed, 0);
    assert.equal(result.cancelled, 0);
    assert.equal(result.running, 0);
    assert.equal(result.completionRate, 0);
    assert.equal(result.failureRate, 0);
    assert.equal(result.avgStepsCompleted, 0);
    assert.equal(result.recentRuns.length, 0);
  });

  it("counts completed, failed, and cancelled runs correctly", () => {
    const runs = [
      makeRun({ status: "completed" }),
      makeRun({ status: "completed" }),
      makeRun({ status: "failed" }),
      makeRun({ status: "cancelled" }),
    ];
    const result = computeRunAnalytics(runs);
    assert.equal(result.totalRuns, 4);
    assert.equal(result.completed, 2);
    assert.equal(result.failed, 1);
    assert.equal(result.cancelled, 1);
    assert.equal(result.completionRate, 50);
    assert.equal(result.failureRate, 25);
  });

  it("counts running, suspended, and queued as running", () => {
    const runs = [
      makeRun({ status: "running" }),
      makeRun({ status: "suspended_for_clarification" }),
      makeRun({ status: "suspended_for_approval" }),
      makeRun({ status: "queued" }),
    ];
    const result = computeRunAnalytics(runs);
    assert.equal(result.running, 4);
    assert.equal(result.completed, 0);
    assert.equal(result.other, 0);
  });

  it("computes average step count for completed runs only", () => {
    const runs = [
      makeRun({ status: "completed", checkpoint: { stepCount: 4 } }),
      makeRun({ status: "completed", checkpoint: { stepCount: 6 } }),
      makeRun({ status: "failed", checkpoint: { stepCount: 20 } }),
    ];
    const result = computeRunAnalytics(runs);
    assert.equal(result.avgStepsCompleted, 5);
  });

  it("handles missing stepCount gracefully", () => {
    const runs = [
      makeRun({ status: "completed", checkpoint: {} }),
      makeRun({ status: "completed", checkpoint: { stepCount: 4 } }),
    ];
    const result = computeRunAnalytics(runs);
    assert.equal(result.avgStepsCompleted, 2); // (0 + 4) / 2
  });

  it("limits recentRuns to 10 entries", () => {
    const runs = Array.from({ length: 15 }, (_, i) =>
      makeRun({ id: `run_${i}` })
    );
    const result = computeRunAnalytics(runs);
    assert.equal(result.recentRuns.length, 10);
    assert.equal(result.recentRuns[0].id, "run_0");
    assert.equal(result.recentRuns[9].id, "run_9");
  });

  it("recentRuns includes goal, status, stepCount, updatedAt", () => {
    const runs = [
      makeRun({
        id: "run_abc",
        goal: "look up price",
        status: "completed",
        updatedAt: "2026-03-17T12:00:00Z",
        checkpoint: { stepCount: 5 },
      }),
    ];
    const result = computeRunAnalytics(runs);
    assert.equal(result.recentRuns.length, 1);
    const recent = result.recentRuns[0];
    assert.equal(recent.id, "run_abc");
    assert.equal(recent.goal, "look up price");
    assert.equal(recent.status, "completed");
    assert.equal(recent.stepCount, 5);
    assert.equal(recent.updatedAt, "2026-03-17T12:00:00Z");
  });

  it("counts unknown statuses as other", () => {
    const runs = [makeRun({ status: "some_future_status" })];
    const result = computeRunAnalytics(runs);
    assert.equal(result.other, 1);
    assert.equal(result.completed, 0);
  });

  it("rounds percentages to integers", () => {
    const runs = [
      makeRun({ status: "completed" }),
      makeRun({ status: "failed" }),
      makeRun({ status: "failed" }),
    ];
    const result = computeRunAnalytics(runs);
    assert.equal(result.completionRate, 33); // 33.3... → 33
    assert.equal(result.failureRate, 67);    // 66.6... → 67
  });

  it("rounds avgStepsCompleted to one decimal place", () => {
    const runs = [
      makeRun({ status: "completed", checkpoint: { stepCount: 3 } }),
      makeRun({ status: "completed", checkpoint: { stepCount: 4 } }),
      makeRun({ status: "completed", checkpoint: { stepCount: 5 } }),
    ];
    const result = computeRunAnalytics(runs);
    assert.equal(result.avgStepsCompleted, 4); // (3+4+5)/3 = 4.0
  });
});
