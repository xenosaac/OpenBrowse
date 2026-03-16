import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapToolCallToDecision, BROWSER_TOOLS } from "../packages/planner/dist/toolMapping.js";

// ---------------------------------------------------------------------------
// BROWSER_TOOLS schema validation
// ---------------------------------------------------------------------------

describe("BROWSER_TOOLS", () => {
  it("defines exactly 12 tools", () => {
    assert.equal(BROWSER_TOOLS.length, 12);
  });

  it("has unique tool names", () => {
    const names = BROWSER_TOOLS.map((t) => t.name);
    assert.equal(new Set(names).size, names.length);
  });

  it("every tool has a name, description, and input_schema", () => {
    for (const tool of BROWSER_TOOLS) {
      assert.ok(tool.name, `tool missing name`);
      assert.ok(tool.description, `${tool.name} missing description`);
      assert.ok(tool.input_schema, `${tool.name} missing input_schema`);
      assert.equal(tool.input_schema.type, "object");
    }
  });

  it("contains all expected tool names", () => {
    const names = new Set(BROWSER_TOOLS.map((t) => t.name));
    const expected = [
      "browser_navigate", "browser_click", "browser_type", "browser_select",
      "browser_scroll", "browser_hover", "browser_press_key", "browser_wait",
      "browser_screenshot", "task_complete", "task_failed", "ask_user"
    ];
    for (const name of expected) {
      assert.ok(names.has(name), `missing tool: ${name}`);
    }
  });
});

// ---------------------------------------------------------------------------
// mapToolCallToDecision — browser actions
// ---------------------------------------------------------------------------

describe("mapToolCallToDecision — browser_navigate", () => {
  it("maps to navigate action with url and description", () => {
    const result = mapToolCallToDecision(
      "browser_navigate",
      { url: "https://example.com", description: "Go to example" },
      "reasoning text",
      "run_1"
    );
    assert.equal(result.type, "browser_action");
    assert.equal(result.action.type, "navigate");
    assert.equal(result.action.value, "https://example.com");
    assert.equal(result.action.description, "Go to example");
    assert.equal(result.reasoning, "reasoning text");
  });

  it("uses default description when missing", () => {
    const result = mapToolCallToDecision("browser_navigate", { url: "https://x.com" }, "r", "run_1");
    assert.equal(result.action.description, "Navigate");
  });
});

describe("mapToolCallToDecision — browser_click", () => {
  it("maps to click action with targetId", () => {
    const result = mapToolCallToDecision(
      "browser_click",
      { ref: "el_5", description: "Click submit" },
      "clicking submit",
      "run_1"
    );
    assert.equal(result.type, "browser_action");
    assert.equal(result.action.type, "click");
    assert.equal(result.action.targetId, "el_5");
    assert.equal(result.action.description, "Click submit");
  });

  it("uses default description when missing", () => {
    const result = mapToolCallToDecision("browser_click", { ref: "el_0" }, "r", "run_1");
    assert.equal(result.action.description, "Click");
  });
});

describe("mapToolCallToDecision — browser_type", () => {
  it("maps to type action with targetId, value, and description", () => {
    const result = mapToolCallToDecision(
      "browser_type",
      { ref: "el_3", text: "hello world", description: "Type greeting" },
      "typing",
      "run_1"
    );
    assert.equal(result.type, "browser_action");
    assert.equal(result.action.type, "type");
    assert.equal(result.action.targetId, "el_3");
    assert.equal(result.action.value, "hello world");
    assert.equal(result.action.description, "Type greeting");
  });

  it("uses default description when missing", () => {
    const result = mapToolCallToDecision("browser_type", { ref: "el_1", text: "x" }, "r", "run_1");
    assert.equal(result.action.description, "Type text");
  });
});

describe("mapToolCallToDecision — browser_select", () => {
  it("maps to select action with targetId and value", () => {
    const result = mapToolCallToDecision(
      "browser_select",
      { ref: "el_7", value: "option_2", description: "Select country" },
      "selecting",
      "run_1"
    );
    assert.equal(result.type, "browser_action");
    assert.equal(result.action.type, "select");
    assert.equal(result.action.targetId, "el_7");
    assert.equal(result.action.value, "option_2");
    assert.equal(result.action.description, "Select country");
  });

  it("uses default description when missing", () => {
    const result = mapToolCallToDecision("browser_select", { ref: "el_7", value: "v" }, "r", "run_1");
    assert.equal(result.action.description, "Select option");
  });
});

describe("mapToolCallToDecision — browser_scroll", () => {
  it("maps to scroll action with direction", () => {
    const result = mapToolCallToDecision(
      "browser_scroll",
      { direction: "up", description: "Scroll to top" },
      "scrolling",
      "run_1"
    );
    assert.equal(result.type, "browser_action");
    assert.equal(result.action.type, "scroll");
    assert.equal(result.action.value, "up");
    assert.equal(result.action.description, "Scroll to top");
  });

  it("includes optional ref for element-scoped scrolling", () => {
    const result = mapToolCallToDecision(
      "browser_scroll",
      { direction: "down", ref: "el_10", description: "Scroll list" },
      "r",
      "run_1"
    );
    assert.equal(result.action.targetId, "el_10");
    assert.equal(result.action.value, "down");
  });

  it("defaults direction to 'down' when missing", () => {
    const result = mapToolCallToDecision("browser_scroll", { description: "Scroll" }, "r", "run_1");
    assert.equal(result.action.value, "down");
  });

  it("uses default description when missing", () => {
    const result = mapToolCallToDecision("browser_scroll", { direction: "down" }, "r", "run_1");
    assert.equal(result.action.description, "Scroll");
  });
});

describe("mapToolCallToDecision — browser_hover", () => {
  it("maps to hover action with targetId", () => {
    const result = mapToolCallToDecision(
      "browser_hover",
      { ref: "el_2", description: "Hover menu" },
      "hovering",
      "run_1"
    );
    assert.equal(result.type, "browser_action");
    assert.equal(result.action.type, "hover");
    assert.equal(result.action.targetId, "el_2");
    assert.equal(result.action.description, "Hover menu");
  });

  it("uses default description when missing", () => {
    const result = mapToolCallToDecision("browser_hover", { ref: "el_2" }, "r", "run_1");
    assert.equal(result.action.description, "Hover");
  });
});

describe("mapToolCallToDecision — browser_press_key", () => {
  it("maps to pressKey action with key value", () => {
    const result = mapToolCallToDecision(
      "browser_press_key",
      { key: "Enter", description: "Submit form" },
      "pressing enter",
      "run_1"
    );
    assert.equal(result.type, "browser_action");
    assert.equal(result.action.type, "pressKey");
    assert.equal(result.action.value, "Enter");
    assert.equal(result.action.description, "Submit form");
  });

  it("handles key combinations", () => {
    const result = mapToolCallToDecision(
      "browser_press_key",
      { key: "Ctrl+A", description: "Select all" },
      "r",
      "run_1"
    );
    assert.equal(result.action.value, "Ctrl+A");
  });

  it("uses default description when missing", () => {
    const result = mapToolCallToDecision("browser_press_key", { key: "Tab" }, "r", "run_1");
    assert.equal(result.action.description, "Press key");
  });
});

describe("mapToolCallToDecision — browser_wait", () => {
  it("maps to wait action with duration as string", () => {
    const result = mapToolCallToDecision(
      "browser_wait",
      { duration: 2000, description: "Wait for load" },
      "waiting",
      "run_1"
    );
    assert.equal(result.type, "browser_action");
    assert.equal(result.action.type, "wait");
    assert.equal(result.action.value, "2000");
    assert.equal(result.action.description, "Wait for load");
  });

  it("defaults duration to 1000 when missing", () => {
    const result = mapToolCallToDecision("browser_wait", { description: "Wait" }, "r", "run_1");
    assert.equal(result.action.value, "1000");
  });

  it("uses default description when missing", () => {
    const result = mapToolCallToDecision("browser_wait", { duration: 500 }, "r", "run_1");
    assert.equal(result.action.description, "Wait");
  });
});

describe("mapToolCallToDecision — browser_screenshot", () => {
  it("maps to screenshot action with fixed description", () => {
    const result = mapToolCallToDecision("browser_screenshot", {}, "taking screenshot", "run_1");
    assert.equal(result.type, "browser_action");
    assert.equal(result.action.type, "screenshot");
    assert.equal(result.action.description, "Capture screenshot");
    assert.equal(result.reasoning, "taking screenshot");
  });
});

// ---------------------------------------------------------------------------
// mapToolCallToDecision — terminal decisions
// ---------------------------------------------------------------------------

describe("mapToolCallToDecision — task_complete", () => {
  it("maps to task_complete with summary", () => {
    const result = mapToolCallToDecision(
      "task_complete",
      { summary: "Booked the flight" },
      "task done",
      "run_1"
    );
    assert.equal(result.type, "task_complete");
    assert.equal(result.completionSummary, "Booked the flight");
    assert.equal(result.reasoning, "task done");
  });

  it("falls back to reasoning when summary missing", () => {
    const result = mapToolCallToDecision("task_complete", {}, "the reasoning", "run_1");
    assert.equal(result.completionSummary, "the reasoning");
  });
});

describe("mapToolCallToDecision — task_failed", () => {
  it("maps to task_failed with reason", () => {
    const result = mapToolCallToDecision(
      "task_failed",
      { reason: "CAPTCHA blocked" },
      "cannot proceed",
      "run_1"
    );
    assert.equal(result.type, "task_failed");
    assert.equal(result.failureSummary, "CAPTCHA blocked");
    assert.equal(result.reasoning, "cannot proceed");
  });

  it("falls back to reasoning when reason missing", () => {
    const result = mapToolCallToDecision("task_failed", {}, "fail reason", "run_1");
    assert.equal(result.failureSummary, "fail reason");
  });
});

// ---------------------------------------------------------------------------
// mapToolCallToDecision — clarification (ask_user)
// ---------------------------------------------------------------------------

describe("mapToolCallToDecision — ask_user", () => {
  it("maps to clarification_request with question and options", () => {
    const result = mapToolCallToDecision(
      "ask_user",
      {
        question: "Which date?",
        options: [
          { label: "March 1", summary: "First of March" },
          { label: "March 15" }
        ]
      },
      "need date",
      "run_42"
    );
    assert.equal(result.type, "clarification_request");
    assert.equal(result.clarificationRequest.question, "Which date?");
    assert.equal(result.clarificationRequest.runId, "run_42");
    assert.equal(result.clarificationRequest.contextSummary, "need date");
    assert.equal(result.clarificationRequest.options.length, 2);
    assert.equal(result.clarificationRequest.options[0].id, "opt_0");
    assert.equal(result.clarificationRequest.options[0].label, "March 1");
    assert.equal(result.clarificationRequest.options[0].summary, "First of March");
    assert.equal(result.clarificationRequest.options[1].id, "opt_1");
    assert.equal(result.clarificationRequest.options[1].summary, "March 15"); // falls back to label
  });

  it("handles no options", () => {
    const result = mapToolCallToDecision(
      "ask_user",
      { question: "What URL?" },
      "need url",
      "run_1"
    );
    assert.equal(result.type, "clarification_request");
    assert.equal(result.clarificationRequest.options.length, 0);
  });

  it("falls back to reasoning when question missing", () => {
    const result = mapToolCallToDecision("ask_user", {}, "fallback q", "run_1");
    assert.equal(result.clarificationRequest.question, "fallback q");
  });

  it("generates clarification id with runId prefix", () => {
    const result = mapToolCallToDecision("ask_user", { question: "?" }, "r", "run_99");
    assert.ok(result.clarificationRequest.id.startsWith("clarify_run_99_"));
  });

  it("includes createdAt ISO timestamp", () => {
    const before = new Date().toISOString();
    const result = mapToolCallToDecision("ask_user", { question: "?" }, "r", "run_1");
    const after = new Date().toISOString();
    assert.ok(result.clarificationRequest.createdAt >= before);
    assert.ok(result.clarificationRequest.createdAt <= after);
  });
});

// ---------------------------------------------------------------------------
// mapToolCallToDecision — unknown tool
// ---------------------------------------------------------------------------

describe("mapToolCallToDecision — unknown tool", () => {
  it("returns task_failed for unrecognized tool name", () => {
    const result = mapToolCallToDecision("browser_drag", {}, "tried drag", "run_1");
    assert.equal(result.type, "task_failed");
    assert.equal(result.failureSummary, "Unknown tool call: browser_drag");
    assert.equal(result.reasoning, "tried drag");
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: reasoning is always preserved
// ---------------------------------------------------------------------------

describe("mapToolCallToDecision — cross-cutting", () => {
  it("preserves reasoning across all action types", () => {
    const tools = [
      ["browser_navigate", { url: "u" }],
      ["browser_click", { ref: "r" }],
      ["browser_type", { ref: "r", text: "t" }],
      ["browser_select", { ref: "r", value: "v" }],
      ["browser_scroll", { direction: "down" }],
      ["browser_hover", { ref: "r" }],
      ["browser_press_key", { key: "k" }],
      ["browser_wait", {}],
      ["browser_screenshot", {}],
      ["task_complete", { summary: "s" }],
      ["task_failed", { reason: "f" }],
      ["ask_user", { question: "q" }],
    ];
    for (const [name, input] of tools) {
      const result = mapToolCallToDecision(name, input, "my_reasoning", "run_1");
      assert.equal(result.reasoning, "my_reasoning", `reasoning not preserved for ${name}`);
    }
  });
});
