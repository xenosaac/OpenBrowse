import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { ClaudePlannerGateway } from "../packages/planner/dist/ClaudePlannerGateway.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRun(overrides = {}) {
  return {
    id: overrides.id ?? "run_1",
    taskIntentId: "intent_1",
    status: "running",
    goal: "Test task",
    source: "desktop",
    constraints: [],
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    checkpoint: {
      step: 1,
      stepCount: 1,
      browserSessionId: "sess_1",
      summary: "",
      lastKnownUrl: "https://example.com",
      lastPageTitle: "Example",
      actionHistory: [],
      consecutiveSoftFailures: 0,
      totalSoftFailures: 0,
      notes: [],
      urlVisitCounts: {},
      ...overrides.checkpoint,
    },
    outcome: overrides.outcome,
    suspension: overrides.suspension,
  };
}

function makePageModel() {
  return {
    id: "pm_1",
    url: "https://example.com",
    title: "Example",
    summary: "A test page",
    elements: [],
    visibleText: "",
    createdAt: new Date().toISOString(),
    forms: [],
    alerts: [],
    captchaDetected: false,
  };
}

function makeInput(overrides = {}) {
  return {
    run: overrides.run ?? makeRun(),
    pageModel: overrides.pageModel ?? makePageModel(),
  };
}

/**
 * Create a ClaudePlannerGateway with a mocked API client.
 * @param {Function} createFn - async function called for client.messages.create
 */
function makeGatewayWithMock(createFn) {
  const gateway = new ClaudePlannerGateway({ apiKey: "test-key" });
  const calls = [];
  gateway.client = {
    messages: {
      create: async (params) => {
        calls.push(params);
        return createFn(params, calls.length);
      },
    },
  };
  return { gateway, calls };
}

/** A standard tool_use response block for browser_click */
function toolUseResponse(toolName = "browser_click", input = { ref: "el_1", description: "Click button" }) {
  return {
    content: [
      { type: "text", text: "I will click the button." },
      { type: "tool_use", id: "tu_1", name: toolName, input },
    ],
  };
}

/** A text-only response (no tool_use block) */
function textOnlyResponse(text = "Let me think about this...") {
  return {
    content: [{ type: "text", text }],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ClaudePlannerGateway.decide", () => {
  // --- Happy path ---

  it("returns browser_action when first call includes tool_use", async () => {
    const { gateway } = makeGatewayWithMock(() =>
      toolUseResponse("browser_click", { ref: "el_5", description: "Click submit" })
    );

    const decision = await gateway.decide(makeInput());

    assert.equal(decision.type, "browser_action");
    assert.equal(decision.action.type, "click");
    assert.equal(decision.action.targetId, "el_5");
    assert.equal(decision.action.description, "Click submit");
    assert.ok(decision.reasoning.includes("I will click"));
  });

  it("returns task_complete when tool is task_complete", async () => {
    const { gateway } = makeGatewayWithMock(() =>
      toolUseResponse("task_complete", { summary: "All done" })
    );

    const decision = await gateway.decide(makeInput());

    assert.equal(decision.type, "task_complete");
    assert.equal(decision.completionSummary, "All done");
  });

  it("returns task_failed when tool is task_failed", async () => {
    const { gateway } = makeGatewayWithMock(() =>
      toolUseResponse("task_failed", { reason: "Page not found" })
    );

    const decision = await gateway.decide(makeInput());

    assert.equal(decision.type, "task_failed");
    assert.equal(decision.failureSummary, "Page not found");
  });

  it("returns clarification_request when tool is ask_user", async () => {
    const { gateway } = makeGatewayWithMock(() =>
      toolUseResponse("ask_user", { question: "Which option?", options: [{ label: "A" }, { label: "B" }] })
    );

    const decision = await gateway.decide(makeInput());

    assert.equal(decision.type, "clarification_request");
    assert.equal(decision.clarificationRequest.question, "Which option?");
    assert.equal(decision.clarificationRequest.options.length, 2);
    assert.equal(decision.clarificationRequest.runId, "run_1");
  });

  it("returns navigate action for browser_navigate tool", async () => {
    const { gateway } = makeGatewayWithMock(() =>
      toolUseResponse("browser_navigate", { url: "https://test.com", description: "Go to test" })
    );

    const decision = await gateway.decide(makeInput());

    assert.equal(decision.type, "browser_action");
    assert.equal(decision.action.type, "navigate");
    assert.equal(decision.action.value, "https://test.com");
  });

  // --- Reasoning extraction ---

  it("extracts reasoning from multiple text blocks", async () => {
    const { gateway } = makeGatewayWithMock(() => ({
      content: [
        { type: "text", text: "First thought." },
        { type: "text", text: "Second thought." },
        { type: "tool_use", id: "tu_1", name: "browser_click", input: { ref: "el_1", description: "Click" } },
      ],
    }));

    const decision = await gateway.decide(makeInput());

    assert.equal(decision.reasoning, "First thought.\nSecond thought.");
  });

  it("uses fallback reasoning when no text blocks present", async () => {
    const { gateway } = makeGatewayWithMock(() => ({
      content: [
        { type: "tool_use", id: "tu_1", name: "browser_click", input: { ref: "el_1", description: "Click" } },
      ],
    }));

    const decision = await gateway.decide(makeInput());

    assert.equal(decision.reasoning, "No reasoning provided");
  });

  // --- Retry path (text-only first response) ---

  it("retries with forced tool_choice when first response is text-only", async () => {
    const { gateway, calls } = makeGatewayWithMock((params, callNum) => {
      if (callNum === 1) return textOnlyResponse("Thinking...");
      return toolUseResponse("browser_scroll", { direction: "down", description: "Scroll down" });
    });

    const decision = await gateway.decide(makeInput());

    assert.equal(calls.length, 2);
    // First call uses "auto" tool_choice
    assert.equal(calls[0].tool_choice.type, "auto");
    // Second call uses "any" tool_choice
    assert.equal(calls[1].tool_choice.type, "any");
    // Decision should come from the retry
    assert.equal(decision.type, "browser_action");
    assert.equal(decision.action.type, "scroll");
  });

  it("retry includes original response in messages for context", async () => {
    const { gateway, calls } = makeGatewayWithMock((params, callNum) => {
      if (callNum === 1) return textOnlyResponse("Let me analyze...");
      return toolUseResponse("browser_click", { ref: "el_1", description: "Click" });
    });

    await gateway.decide(makeInput());

    assert.equal(calls[1].messages.length, 3);
    // Original user message
    assert.equal(calls[1].messages[0].role, "user");
    // Assistant's text-only response
    assert.equal(calls[1].messages[1].role, "assistant");
    // Follow-up prompt to force tool use
    assert.equal(calls[1].messages[2].role, "user");
    assert.ok(calls[1].messages[2].content.includes("must now call exactly one tool"));
  });

  // --- Retry failure paths ---

  it("returns task_failed when retry also returns text-only", async () => {
    const { gateway } = makeGatewayWithMock(() => textOnlyResponse("Still thinking..."));

    const decision = await gateway.decide(makeInput());

    assert.equal(decision.type, "task_failed");
    assert.equal(decision.failureSummary, "Planner returned no tool call after retry");
    assert.equal(decision.reasoning, "Still thinking...");
  });

  it("returns task_failed when retry throws", async () => {
    const { gateway } = makeGatewayWithMock((params, callNum) => {
      if (callNum === 1) return textOnlyResponse("Thinking...");
      throw new Error("API rate limit");
    });

    const decision = await gateway.decide(makeInput());

    assert.equal(decision.type, "task_failed");
    assert.equal(decision.failureSummary, "Planner returned no tool call after retry");
  });

  // --- Timeout ---

  it("returns task_failed on timeout error", async () => {
    const { gateway } = makeGatewayWithMock(() => {
      throw new Error("Planner timed out after 60s");
    });

    const decision = await gateway.decide(makeInput());

    assert.equal(decision.type, "task_failed");
    assert.ok(decision.reasoning.includes("Planner timed out"));
    assert.ok(decision.failureSummary.includes("Planner timed out"));
  });

  // --- Non-timeout errors re-throw ---

  it("re-throws non-timeout errors from first call", async () => {
    const { gateway } = makeGatewayWithMock(() => {
      throw new Error("Authentication failed");
    });

    await assert.rejects(
      () => gateway.decide(makeInput()),
      { message: "Authentication failed" }
    );
  });

  // --- Model and config ---

  it("uses configured model and maxTokens", async () => {
    const gateway = new ClaudePlannerGateway({ apiKey: "test", model: "claude-sonnet-4-5-20250514", maxTokens: 2048 });
    const calls = [];
    gateway.client = {
      messages: {
        create: async (params) => {
          calls.push(params);
          return toolUseResponse();
        },
      },
    };

    await gateway.decide(makeInput());

    assert.equal(calls[0].model, "claude-sonnet-4-5-20250514");
    assert.equal(calls[0].max_tokens, 2048);
  });

  it("uses default model and maxTokens when not configured", async () => {
    const gateway = new ClaudePlannerGateway({ apiKey: "test" });
    const calls = [];
    gateway.client = {
      messages: {
        create: async (params) => {
          calls.push(params);
          return toolUseResponse();
        },
      },
    };

    await gateway.decide(makeInput());

    assert.equal(calls[0].model, "claude-opus-4-6");
    assert.equal(calls[0].max_tokens, 4096);
  });

  it("passes BROWSER_TOOLS and system prompt to API", async () => {
    const { gateway, calls } = makeGatewayWithMock(() => toolUseResponse());

    await gateway.decide(makeInput());

    assert.ok(calls[0].tools.length > 0, "should pass tools");
    assert.ok(calls[0].system, "should pass system prompt");
    assert.equal(calls[0].messages.length, 1);
    assert.equal(calls[0].messages[0].role, "user");
  });

  it("passes run id to mapToolCallToDecision for ask_user", async () => {
    const customRun = makeRun({ id: "run_custom_42" });
    const { gateway } = makeGatewayWithMock(() =>
      toolUseResponse("ask_user", { question: "Which?", options: [] })
    );

    const decision = await gateway.decide(makeInput({ run: customRun }));

    assert.equal(decision.type, "clarification_request");
    assert.equal(decision.clarificationRequest.runId, "run_custom_42");
  });
});
