import test from "node:test";
import assert from "node:assert/strict";

import { buildHandoffArtifact, renderHandoffMarkdown } from "../packages/observability/dist/RunHandoff.js";

// --- Helper: minimal TaskRun ---

function makeRun(overrides = {}) {
  return {
    id: "run_1",
    taskIntentId: "intent_1",
    status: "completed",
    goal: "Buy concert tickets",
    source: "chat",
    constraints: [],
    metadata: {},
    createdAt: "2026-03-16T10:00:00Z",
    updatedAt: "2026-03-16T10:05:00Z",
    checkpoint: {
      summary: "Done",
      notes: [],
      stepCount: 3,
      lastKnownUrl: "https://example.com/tickets",
      lastPageTitle: "Tickets Page",
      lastPageSummary: "Concert ticket listing",
      actionHistory: [],
      ...overrides.checkpoint,
    },
    outcome: { status: "completed", summary: "Tickets purchased", finishedAt: "2026-03-16T10:05:00Z" },
    ...overrides,
    // Re-apply checkpoint overrides after top-level spread
    ...(overrides.checkpoint ? { checkpoint: { summary: "Done", notes: [], stepCount: 3, actionHistory: [], ...overrides.checkpoint } } : {}),
  };
}

// --- buildHandoffArtifact ---

test("buildHandoffArtifact: maps core fields from TaskRun", () => {
  const run = makeRun();
  const artifact = buildHandoffArtifact(run);
  assert.equal(artifact.runId, "run_1");
  assert.equal(artifact.goal, "Buy concert tickets");
  assert.equal(artifact.source, "chat");
  assert.equal(artifact.status, "completed");
  assert.equal(artifact.startedAt, "2026-03-16T10:00:00Z");
  assert.equal(artifact.updatedAt, "2026-03-16T10:05:00Z");
  assert.equal(artifact.stepCount, 3);
});

test("buildHandoffArtifact: maps page context from checkpoint", () => {
  const run = makeRun();
  const artifact = buildHandoffArtifact(run);
  assert.equal(artifact.currentUrl, "https://example.com/tickets");
  assert.equal(artifact.currentPageTitle, "Tickets Page");
  assert.equal(artifact.currentPageSummary, "Concert ticket listing");
});

test("buildHandoffArtifact: maps constraints", () => {
  const run = makeRun({ constraints: ["budget < $100", "front row only"] });
  const artifact = buildHandoffArtifact(run);
  assert.deepEqual(artifact.constraints, ["budget < $100", "front row only"]);
});

test("buildHandoffArtifact: maps suspension info", () => {
  const run = makeRun({
    status: "suspended_for_clarification",
    suspension: {
      type: "clarification",
      requestId: "req_1",
      question: "Which date?",
      createdAt: "2026-03-16T10:03:00Z",
    },
  });
  const artifact = buildHandoffArtifact(run);
  assert.equal(artifact.suspensionType, "clarification");
  assert.equal(artifact.suspensionQuestion, "Which date?");
});

test("buildHandoffArtifact: maps failure info", () => {
  const run = makeRun({
    checkpoint: {
      lastFailureClass: "element_not_found",
      consecutiveSoftFailures: 2,
    },
  });
  const artifact = buildHandoffArtifact(run);
  assert.equal(artifact.lastFailureClass, "element_not_found");
  assert.equal(artifact.consecutiveSoftFailures, 2);
});

test("buildHandoffArtifact: maps outcome summary", () => {
  const run = makeRun();
  const artifact = buildHandoffArtifact(run);
  assert.equal(artifact.outcome, "Tickets purchased");
});

test("buildHandoffArtifact: handles missing outcome gracefully", () => {
  const run = makeRun({ outcome: undefined });
  const artifact = buildHandoffArtifact(run);
  assert.equal(artifact.outcome, undefined);
});

test("buildHandoffArtifact: maps notes from checkpoint", () => {
  const run = makeRun({
    checkpoint: { notes: ["User prefers aisle seats", "Budget is flexible"] },
  });
  const artifact = buildHandoffArtifact(run);
  assert.deepEqual(artifact.notes, ["User prefers aisle seats", "Budget is flexible"]);
});

test("buildHandoffArtifact: maps action history", () => {
  const history = [
    { step: 1, type: "navigate", description: "Go to tickets page", ok: true },
    { step: 2, type: "click", description: "Click buy button", ok: false, failureClass: "timeout" },
  ];
  const run = makeRun({ checkpoint: { actionHistory: history } });
  const artifact = buildHandoffArtifact(run);
  assert.equal(artifact.actionHistory.length, 2);
  assert.equal(artifact.actionHistory[0].step, 1);
  assert.equal(artifact.actionHistory[1].ok, false);
});

test("buildHandoffArtifact: accepts optional pageModelSnapshot", () => {
  const run = makeRun();
  const pageModel = { title: "Page", elements: [], summary: "Summary" };
  const artifact = buildHandoffArtifact(run, pageModel);
  assert.equal(artifact.pageModelSnapshot, pageModel);
});

test("buildHandoffArtifact: stepCount defaults to 0 when undefined", () => {
  const run = makeRun({ checkpoint: { stepCount: undefined } });
  const artifact = buildHandoffArtifact(run);
  assert.equal(artifact.stepCount, 0);
});

// --- renderHandoffMarkdown ---

test("renderHandoffMarkdown: includes title with goal", () => {
  const artifact = buildHandoffArtifact(makeRun());
  const md = renderHandoffMarkdown(artifact);
  assert.ok(md.includes("# Run Handoff: Buy concert tickets"));
});

test("renderHandoffMarkdown: includes status with emoji", () => {
  const artifact = buildHandoffArtifact(makeRun());
  const md = renderHandoffMarkdown(artifact);
  assert.ok(md.includes("**Status**: ✅ completed"));
});

test("renderHandoffMarkdown: includes run metadata", () => {
  const artifact = buildHandoffArtifact(makeRun());
  const md = renderHandoffMarkdown(artifact);
  assert.ok(md.includes("**Run ID**: `run_1`"));
  assert.ok(md.includes("**Source**: chat"));
  assert.ok(md.includes("**Steps completed**: 3"));
});

test("renderHandoffMarkdown: includes constraints section when present", () => {
  const run = makeRun({ constraints: ["budget < $100"] });
  const artifact = buildHandoffArtifact(run);
  const md = renderHandoffMarkdown(artifact);
  assert.ok(md.includes("## Constraints"));
  assert.ok(md.includes("- budget < $100"));
});

test("renderHandoffMarkdown: omits constraints section when empty", () => {
  const artifact = buildHandoffArtifact(makeRun());
  const md = renderHandoffMarkdown(artifact);
  assert.ok(!md.includes("## Constraints"));
});

test("renderHandoffMarkdown: includes current page section", () => {
  const artifact = buildHandoffArtifact(makeRun());
  const md = renderHandoffMarkdown(artifact);
  assert.ok(md.includes("## Current Page"));
  assert.ok(md.includes("**URL**: https://example.com/tickets"));
  assert.ok(md.includes("**Title**: Tickets Page"));
});

test("renderHandoffMarkdown: includes action history table", () => {
  const run = makeRun({
    checkpoint: {
      actionHistory: [
        { step: 1, type: "navigate", description: "Go to site", ok: true, targetUrl: "https://example.com" },
      ],
    },
  });
  const artifact = buildHandoffArtifact(run);
  const md = renderHandoffMarkdown(artifact);
  assert.ok(md.includes("## Action History"));
  assert.ok(md.includes("| Step | Action |"));
  assert.ok(md.includes("| 1 | navigate |"));
});

test("renderHandoffMarkdown: action history truncates long descriptions", () => {
  const longDesc = "A".repeat(60);
  const run = makeRun({
    checkpoint: {
      actionHistory: [
        { step: 1, type: "click", description: longDesc, ok: true },
      ],
    },
  });
  const artifact = buildHandoffArtifact(run);
  const md = renderHandoffMarkdown(artifact);
  assert.ok(md.includes("AAA..."));
  assert.ok(!md.includes(longDesc));
});

test("renderHandoffMarkdown: includes suspension section", () => {
  const run = makeRun({
    status: "suspended_for_clarification",
    suspension: {
      type: "clarification",
      requestId: "req_1",
      question: "Which date?",
      createdAt: "2026-03-16T10:03:00Z",
    },
  });
  const artifact = buildHandoffArtifact(run);
  const md = renderHandoffMarkdown(artifact);
  assert.ok(md.includes("## Pending Input Required"));
  assert.ok(md.includes("**Type**: clarification"));
  assert.ok(md.includes("**Question**: Which date?"));
});

test("renderHandoffMarkdown: includes failure section", () => {
  const run = makeRun({
    checkpoint: {
      lastFailureClass: "timeout",
      consecutiveSoftFailures: 3,
    },
  });
  const artifact = buildHandoffArtifact(run);
  const md = renderHandoffMarkdown(artifact);
  assert.ok(md.includes("## Last Failure"));
  assert.ok(md.includes("**Class**: timeout"));
  assert.ok(md.includes("**Consecutive soft failures**: 3"));
});

test("renderHandoffMarkdown: includes notes section", () => {
  const run = makeRun({
    checkpoint: { notes: ["Note one", "Note two"] },
  });
  const artifact = buildHandoffArtifact(run);
  const md = renderHandoffMarkdown(artifact);
  assert.ok(md.includes("## User Notes / Context"));
  assert.ok(md.includes("1. Note one"));
  assert.ok(md.includes("2. Note two"));
});

test("renderHandoffMarkdown: includes outcome section", () => {
  const artifact = buildHandoffArtifact(makeRun());
  const md = renderHandoffMarkdown(artifact);
  assert.ok(md.includes("## Outcome"));
  assert.ok(md.includes("Tickets purchased"));
});

test("renderHandoffMarkdown: shows different status emojis", () => {
  const statuses = {
    running: "▶",
    suspended_for_clarification: "⏸",
    failed: "❌",
    cancelled: "🚫",
    queued: "⏳",
  };
  for (const [status, emoji] of Object.entries(statuses)) {
    const run = makeRun({ status, outcome: undefined });
    const artifact = buildHandoffArtifact(run);
    const md = renderHandoffMarkdown(artifact);
    assert.ok(md.includes(`${emoji} ${status}`), `Expected ${emoji} for status ${status}`);
  }
});

test("renderHandoffMarkdown: action history shows typed text as target", () => {
  const run = makeRun({
    checkpoint: {
      actionHistory: [
        { step: 1, type: "type_text", description: "Type email", ok: true, typedText: "test@example.com" },
      ],
    },
  });
  const artifact = buildHandoffArtifact(run);
  const md = renderHandoffMarkdown(artifact);
  assert.ok(md.includes('"test@example.com"'));
});

test("renderHandoffMarkdown: action history shows dash when no target or text", () => {
  const run = makeRun({
    checkpoint: {
      actionHistory: [
        { step: 1, type: "scroll", description: "Scroll down", ok: true },
      ],
    },
  });
  const artifact = buildHandoffArtifact(run);
  const md = renderHandoffMarkdown(artifact);
  // The target column should have "—"
  assert.ok(md.includes("—"));
});

// --- extractedData ---

test("buildHandoffArtifact: maps extractedData from outcome", () => {
  const run = makeRun({
    outcome: {
      status: "completed",
      summary: "Found results",
      extractedData: [
        { label: "Result 1", value: "Sony WH-1000XM6" },
        { label: "Result 2", value: "Bose QC Ultra" },
      ],
      finishedAt: "2026-03-16T10:05:00Z",
    },
  });
  const artifact = buildHandoffArtifact(run);
  assert.ok(Array.isArray(artifact.extractedData));
  assert.equal(artifact.extractedData.length, 2);
  assert.equal(artifact.extractedData[0].label, "Result 1");
  assert.equal(artifact.extractedData[0].value, "Sony WH-1000XM6");
});

test("buildHandoffArtifact: extractedData is undefined when outcome has none", () => {
  const run = makeRun();
  const artifact = buildHandoffArtifact(run);
  assert.equal(artifact.extractedData, undefined);
});

test("renderHandoffMarkdown: includes Extracted Data section", () => {
  const artifact = {
    ...buildHandoffArtifact(makeRun()),
    extractedData: [
      { label: "Top result", value: "Sony WH-1000XM6" },
      { label: "Price", value: "$348" },
    ],
  };
  const md = renderHandoffMarkdown(artifact);
  assert.ok(md.includes("## Extracted Data"));
  assert.ok(md.includes("| Label | Value |"));
  assert.ok(md.includes("| Top result | Sony WH-1000XM6 |"));
  assert.ok(md.includes("| Price | $348 |"));
});

test("renderHandoffMarkdown: omits Extracted Data section when empty", () => {
  const artifact = buildHandoffArtifact(makeRun());
  const md = renderHandoffMarkdown(artifact);
  assert.ok(!md.includes("## Extracted Data"));
});

test("renderHandoffMarkdown: escapes pipe characters in extracted data", () => {
  const artifact = {
    ...buildHandoffArtifact(makeRun()),
    extractedData: [
      { label: "Col A | Col B", value: "val | val2" },
    ],
  };
  const md = renderHandoffMarkdown(artifact);
  assert.ok(md.includes("Col A \\| Col B"));
  assert.ok(md.includes("val \\| val2"));
});
