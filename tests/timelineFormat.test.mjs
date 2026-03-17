import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { formatTimelineEvent } = await import(
  "../apps/desktop/src/renderer/lib/timelineFormat.ts"
);

describe("formatTimelineEvent", () => {
  it("formats a completed run event", () => {
    const entry = formatTimelineEvent(
      "run_completed",
      "Task completed successfully with 3 extracted items",
      "2026-03-17T06:39:21.439Z",
      {},
    );
    assert.equal(entry.label, "Completed");
    assert.equal(entry.summary, "Task completed successfully with 3 extracted items");
    assert.equal(entry.color, "#10b981");
    assert.equal(entry.isTerminal, true);
    assert.equal(entry.url, undefined);
    assert.ok(entry.time.length > 0, "time should be a non-empty string");
  });

  it("formats a failed run event", () => {
    const entry = formatTimelineEvent(
      "run_failed",
      "Stuck: repeated click on page 3 times",
      "2026-03-16T10:11:54.883Z",
      { url: "https://www.nytimes.com/games/wordle" },
    );
    assert.equal(entry.label, "Failed");
    assert.equal(entry.summary, "Stuck: repeated click on page 3 times");
    assert.equal(entry.color, "#ef4444");
    assert.equal(entry.isTerminal, true);
    assert.equal(entry.url, "https://www.nytimes.com/games/wordle");
  });

  it("formats a browser action event with url from payload", () => {
    const entry = formatTimelineEvent(
      "browser_action_executed",
      "Clicked 'Search' button",
      "2026-03-17T08:00:00.000Z",
      { url: "https://google.com", action: "click" },
    );
    assert.equal(entry.label, "Action");
    assert.equal(entry.color, "#10b981");
    assert.equal(entry.isTerminal, false);
    assert.equal(entry.url, "https://google.com");
  });

  it("extracts url from targetUrl payload when url is absent", () => {
    const entry = formatTimelineEvent(
      "browser_action_executed",
      "Navigated to Amazon",
      "2026-03-17T08:00:00.000Z",
      { targetUrl: "https://amazon.com" },
    );
    assert.equal(entry.url, "https://amazon.com");
  });

  it("formats a clarification_requested event", () => {
    const entry = formatTimelineEvent(
      "clarification_requested",
      "Which product did you want?",
      "2026-03-17T08:00:00.000Z",
      {},
    );
    assert.equal(entry.label, "Asked user");
    assert.equal(entry.color, "#eab308");
    assert.equal(entry.isTerminal, false);
  });

  it("formats an approval_requested event", () => {
    const entry = formatTimelineEvent(
      "approval_requested",
      "Click Place Order on checkout page",
      "2026-03-17T08:00:00.000Z",
      { url: "https://example.com/checkout" },
    );
    assert.equal(entry.label, "Approval needed");
    assert.equal(entry.color, "#f97316");
    assert.equal(entry.url, "https://example.com/checkout");
  });

  it("handles unknown event types gracefully", () => {
    const entry = formatTimelineEvent(
      "custom_event",
      "Something happened",
      "2026-03-17T08:00:00.000Z",
      {},
    );
    assert.equal(entry.label, "custom event");
    assert.equal(entry.color, "#6b7280");
    assert.equal(entry.isTerminal, false);
  });

  it("handles page_modeled event", () => {
    const entry = formatTimelineEvent(
      "page_modeled",
      "Captured 42 elements on Google search results",
      "2026-03-17T08:00:00.000Z",
      { url: "https://www.google.com/search?q=toucan+price" },
    );
    assert.equal(entry.label, "Page captured");
    assert.equal(entry.color, "#3b82f6");
    assert.equal(entry.url, "https://www.google.com/search?q=toucan+price");
  });

  it("formats run_cancelled as terminal", () => {
    const entry = formatTimelineEvent(
      "run_cancelled",
      "Run cancelled by user.",
      "2026-03-17T08:00:00.000Z",
      {},
    );
    assert.equal(entry.label, "Cancelled");
    assert.equal(entry.isTerminal, true);
    assert.equal(entry.color, "#6b7280");
  });

  it("prefers url over targetUrl in payload", () => {
    const entry = formatTimelineEvent(
      "browser_action_executed",
      "Navigated",
      "2026-03-17T08:00:00.000Z",
      { url: "https://a.com", targetUrl: "https://b.com" },
    );
    assert.equal(entry.url, "https://a.com");
  });

  // T70: Token usage enrichment tests

  it("appends token counts to planner_decision summary when present", () => {
    const entry = formatTimelineEvent(
      "planner_decision",
      "Navigate to Google search",
      "2026-03-17T08:00:00.000Z",
      { plannerDecision: "browser_action", inputTokens: "8421", outputTokens: "312" },
    );
    assert.equal(entry.summary, "Navigate to Google search (8421 in / 312 out)");
    assert.equal(entry.label, "Decision");
    assert.equal(entry.color, "#3b82f6");
  });

  it("does not append token counts to planner_decision when missing", () => {
    const entry = formatTimelineEvent(
      "planner_decision",
      "Navigate to Google search",
      "2026-03-17T08:00:00.000Z",
      { plannerDecision: "browser_action" },
    );
    assert.equal(entry.summary, "Navigate to Google search");
  });

  it("formats screenshot_captured with estimated tokens", () => {
    const entry = formatTimelineEvent(
      "screenshot_captured",
      "Screenshot: 42KB",
      "2026-03-17T08:00:00.000Z",
      { base64Bytes: "57344", fileKB: "42", source: "always_on" },
    );
    assert.equal(entry.label, "Screenshot");
    assert.equal(entry.color, "#8b5cf6");
    assert.ok(entry.summary.includes("Screenshot: 42KB"), "should keep original summary");
    assert.ok(entry.summary.includes("tokens"), "should include token estimate");
    assert.match(entry.summary, /~\d+ tokens/);
  });

  it("handles screenshot_captured without base64Bytes gracefully", () => {
    const entry = formatTimelineEvent(
      "screenshot_captured",
      "Screenshot: unknown",
      "2026-03-17T08:00:00.000Z",
      { source: "always_on" },
    );
    assert.equal(entry.summary, "Screenshot: unknown");
    assert.equal(entry.label, "Screenshot");
  });
});
