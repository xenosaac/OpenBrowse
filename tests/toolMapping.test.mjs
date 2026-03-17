import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapToolCallToDecision, BROWSER_TOOLS } from "../packages/planner/dist/toolMapping.js";

// ---------------------------------------------------------------------------
// BROWSER_TOOLS schema validation
// ---------------------------------------------------------------------------

describe("BROWSER_TOOLS", () => {
  it("defines exactly 21 tools", () => {
    assert.equal(BROWSER_TOOLS.length, 21);
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

  it("browser_type tool definition includes clear_first parameter", () => {
    const typeTool = BROWSER_TOOLS.find((t) => t.name === "browser_type");
    assert.ok(typeTool, "browser_type tool not found");
    assert.ok(typeTool.input_schema.properties.clear_first, "clear_first property missing");
    assert.equal(typeTool.input_schema.properties.clear_first.type, "boolean");
  });

  it("contains all expected tool names", () => {
    const names = new Set(BROWSER_TOOLS.map((t) => t.name));
    const expected = [
      "browser_navigate", "browser_click", "browser_type", "browser_select",
      "browser_scroll", "browser_hover", "browser_press_key", "browser_wait",
      "browser_go_back", "browser_read_text", "browser_wait_for_text",
      "browser_wait_for_navigation", "browser_save_note", "browser_upload_file",
      "browser_open_in_new_tab", "browser_switch_tab", "browser_screenshot",
      "schedule_recurring", "task_complete", "task_failed", "ask_user"
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

  it("passes clear_first as clearFirst on the action", () => {
    const result = mapToolCallToDecision(
      "browser_type",
      { ref: "el_3", text: "new value", clear_first: true, description: "Replace field" },
      "typing",
      "run_1"
    );
    assert.equal(result.type, "browser_action");
    assert.equal(result.action.clearFirst, true);
  });

  it("omits clearFirst when clear_first is false or missing", () => {
    const r1 = mapToolCallToDecision("browser_type", { ref: "el_1", text: "x" }, "r", "run_1");
    assert.equal(r1.action.clearFirst, undefined);

    const r2 = mapToolCallToDecision(
      "browser_type",
      { ref: "el_1", text: "x", clear_first: false },
      "r",
      "run_1"
    );
    assert.equal(r2.action.clearFirst, undefined);
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
// mapToolCallToDecision — browser_go_back
// ---------------------------------------------------------------------------

describe("mapToolCallToDecision — browser_go_back", () => {
  it("maps to go_back action with description", () => {
    const result = mapToolCallToDecision(
      "browser_go_back",
      { description: "Return to search results" },
      "need to check next result",
      "run_1"
    );
    assert.equal(result.type, "browser_action");
    assert.equal(result.action.type, "go_back");
    assert.equal(result.action.description, "Return to search results");
    assert.equal(result.reasoning, "need to check next result");
  });

  it("uses default description when missing", () => {
    const result = mapToolCallToDecision("browser_go_back", {}, "r", "run_1");
    assert.equal(result.action.type, "go_back");
    assert.equal(result.action.description, "Go back to previous page");
  });
});

// ---------------------------------------------------------------------------
// mapToolCallToDecision — browser_read_text
// ---------------------------------------------------------------------------

describe("mapToolCallToDecision — browser_read_text", () => {
  it("maps to read_text action with ref and description", () => {
    const result = mapToolCallToDecision(
      "browser_read_text",
      { ref: "el_12", description: "Read article paragraph" },
      "need to extract the first paragraph",
      "run_1"
    );
    assert.equal(result.type, "browser_action");
    assert.equal(result.action.type, "read_text");
    assert.equal(result.action.targetId, "el_12");
    assert.equal(result.action.description, "Read article paragraph");
    assert.equal(result.reasoning, "need to extract the first paragraph");
  });

  it("uses default description when missing", () => {
    const result = mapToolCallToDecision("browser_read_text", { ref: "el_5" }, "r", "run_1");
    assert.equal(result.action.type, "read_text");
    assert.equal(result.action.description, "Read element text");
  });

  it("fails when ref is missing", () => {
    const result = mapToolCallToDecision("browser_read_text", {}, "r", "run_1");
    assert.equal(result.type, "task_failed");
    assert.ok(result.failureSummary.includes("without ref"));
  });
});

// ---------------------------------------------------------------------------
// mapToolCallToDecision — browser_wait_for_text
// ---------------------------------------------------------------------------

describe("mapToolCallToDecision — browser_wait_for_text", () => {
  it("maps to wait_for_text action with text and default timeout", () => {
    const result = mapToolCallToDecision(
      "browser_wait_for_text",
      { text: "Search results", description: "Wait for search results to load" },
      "waiting for results",
      "run_1"
    );
    assert.equal(result.type, "browser_action");
    assert.equal(result.action.type, "wait_for_text");
    assert.equal(result.action.value, "Search results");
    assert.equal(result.action.description, "Wait for search results to load");
    assert.equal(result.action.interactionHint, "5000");
    assert.equal(result.reasoning, "waiting for results");
  });

  it("uses custom timeout when provided", () => {
    const result = mapToolCallToDecision(
      "browser_wait_for_text",
      { text: "Success", timeout: 10000, description: "Wait for confirmation" },
      "r",
      "run_1"
    );
    assert.equal(result.action.type, "wait_for_text");
    assert.equal(result.action.interactionHint, "10000");
  });

  it("uses default description when missing", () => {
    const result = mapToolCallToDecision("browser_wait_for_text", { text: "Hello" }, "r", "run_1");
    assert.equal(result.action.description, "Wait for text");
  });

  it("fails when text is missing", () => {
    const result = mapToolCallToDecision("browser_wait_for_text", { description: "Wait" }, "r", "run_1");
    assert.equal(result.type, "task_failed");
    assert.ok(result.failureSummary.includes("without text"));
  });
});

// ---------------------------------------------------------------------------
// mapToolCallToDecision — browser_wait_for_navigation
// ---------------------------------------------------------------------------

describe("mapToolCallToDecision — browser_wait_for_navigation", () => {
  it("maps to wait_for_navigation action with default timeout", () => {
    const result = mapToolCallToDecision(
      "browser_wait_for_navigation",
      { description: "Wait for login redirect" },
      "submitted login form",
      "run_1"
    );
    assert.equal(result.type, "browser_action");
    assert.equal(result.action.type, "wait_for_navigation");
    assert.equal(result.action.description, "Wait for login redirect");
    assert.equal(result.action.interactionHint, "10000");
    assert.equal(result.reasoning, "submitted login form");
  });

  it("uses custom timeout when provided", () => {
    const result = mapToolCallToDecision(
      "browser_wait_for_navigation",
      { timeout: 15000, description: "Wait for slow redirect" },
      "r",
      "run_1"
    );
    assert.equal(result.action.type, "wait_for_navigation");
    assert.equal(result.action.interactionHint, "15000");
  });

  it("uses default description when missing", () => {
    const result = mapToolCallToDecision("browser_wait_for_navigation", {}, "r", "run_1");
    assert.equal(result.action.description, "Wait for navigation");
  });
});

// ---------------------------------------------------------------------------
// mapToolCallToDecision — browser_save_note
// ---------------------------------------------------------------------------

describe("mapToolCallToDecision — browser_save_note", () => {
  it("maps to save_note action with key in interactionHint and value", () => {
    const result = mapToolCallToDecision(
      "browser_save_note",
      { key: "Site 1 price", value: "$299", description: "Record price from Amazon" },
      "saving price for comparison",
      "run_1"
    );
    assert.equal(result.type, "browser_action");
    assert.equal(result.action.type, "save_note");
    assert.equal(result.action.interactionHint, "Site 1 price");
    assert.equal(result.action.value, "$299");
    assert.equal(result.action.description, "Record price from Amazon");
    assert.equal(result.reasoning, "saving price for comparison");
  });

  it("uses default description when missing", () => {
    const result = mapToolCallToDecision(
      "browser_save_note",
      { key: "note1", value: "data" },
      "r",
      "run_1"
    );
    assert.equal(result.action.description, "Save note");
  });

  it("fails when key is missing", () => {
    const result = mapToolCallToDecision(
      "browser_save_note",
      { value: "data", description: "Save" },
      "r",
      "run_1"
    );
    assert.equal(result.type, "task_failed");
    assert.ok(result.failureSummary.includes("without key"));
  });

  it("fails when value is missing", () => {
    const result = mapToolCallToDecision(
      "browser_save_note",
      { key: "note1", description: "Save" },
      "r",
      "run_1"
    );
    assert.equal(result.type, "task_failed");
    assert.ok(result.failureSummary.includes("without value"));
  });
});

// ---------------------------------------------------------------------------
// mapToolCallToDecision — browser_upload_file
// ---------------------------------------------------------------------------

describe("mapToolCallToDecision — browser_upload_file", () => {
  it("maps to upload_file action with ref and description", () => {
    const result = mapToolCallToDecision(
      "browser_upload_file",
      { ref: "el_8", description: "Resume PDF for job application" },
      "need to upload resume",
      "run_1"
    );
    assert.equal(result.type, "browser_action");
    assert.equal(result.action.type, "upload_file");
    assert.equal(result.action.targetId, "el_8");
    assert.equal(result.action.description, "Resume PDF for job application");
    assert.equal(result.reasoning, "need to upload resume");
  });

  it("uses default description when missing", () => {
    const result = mapToolCallToDecision(
      "browser_upload_file",
      { ref: "el_3" },
      "r",
      "run_1"
    );
    assert.equal(result.action.type, "upload_file");
    assert.equal(result.action.description, "Upload file");
  });

  it("fails when ref is missing", () => {
    const result = mapToolCallToDecision(
      "browser_upload_file",
      { description: "Upload" },
      "r",
      "run_1"
    );
    assert.equal(result.type, "task_failed");
    assert.ok(result.failureSummary.includes("without ref"));
  });
});

// ---------------------------------------------------------------------------
// mapToolCallToDecision — browser_open_in_new_tab
// ---------------------------------------------------------------------------

describe("mapToolCallToDecision — browser_open_in_new_tab", () => {
  it("maps to open_in_new_tab action with url and description", () => {
    const result = mapToolCallToDecision(
      "browser_open_in_new_tab",
      { url: "https://store2.com/product", description: "Check competitor price" },
      "comparing prices",
      "run_1"
    );
    assert.equal(result.type, "browser_action");
    assert.equal(result.action.type, "open_in_new_tab");
    assert.equal(result.action.value, "https://store2.com/product");
    assert.equal(result.action.description, "Check competitor price");
    assert.equal(result.reasoning, "comparing prices");
  });

  it("uses default description when missing", () => {
    const result = mapToolCallToDecision(
      "browser_open_in_new_tab",
      { url: "https://example.com" },
      "r",
      "run_1"
    );
    assert.equal(result.action.description, "Open in new tab");
  });

  it("fails when url is missing", () => {
    const result = mapToolCallToDecision(
      "browser_open_in_new_tab",
      { description: "Open tab" },
      "r",
      "run_1"
    );
    assert.equal(result.type, "task_failed");
    assert.ok(result.failureSummary.includes("without url"));
  });
});

// ---------------------------------------------------------------------------
// mapToolCallToDecision — browser_switch_tab
// ---------------------------------------------------------------------------

describe("mapToolCallToDecision — browser_switch_tab", () => {
  it("maps to switch_tab action with tab_index as value", () => {
    const result = mapToolCallToDecision(
      "browser_switch_tab",
      { tab_index: 1, description: "Switch to competitor site" },
      "need to check tab 1",
      "run_1"
    );
    assert.equal(result.type, "browser_action");
    assert.equal(result.action.type, "switch_tab");
    assert.equal(result.action.value, "1");
    assert.equal(result.action.description, "Switch to competitor site");
    assert.equal(result.reasoning, "need to check tab 1");
  });

  it("handles tab_index 0 (original tab)", () => {
    const result = mapToolCallToDecision(
      "browser_switch_tab",
      { tab_index: 0, description: "Return to original tab" },
      "r",
      "run_1"
    );
    assert.equal(result.action.type, "switch_tab");
    assert.equal(result.action.value, "0");
  });

  it("uses default description when missing", () => {
    const result = mapToolCallToDecision(
      "browser_switch_tab",
      { tab_index: 2 },
      "r",
      "run_1"
    );
    assert.equal(result.action.description, "Switch tab");
  });

  it("fails when tab_index is missing", () => {
    const result = mapToolCallToDecision(
      "browser_switch_tab",
      { description: "Switch" },
      "r",
      "run_1"
    );
    assert.equal(result.type, "task_failed");
    assert.ok(result.failureSummary.includes("without tab_index"));
  });
});

// ---------------------------------------------------------------------------
// mapToolCallToDecision — schedule_recurring
// ---------------------------------------------------------------------------

describe("mapToolCallToDecision — schedule_recurring", () => {
  it("maps to schedule_recurring action with goal, interval, and startUrl", () => {
    const result = mapToolCallToDecision(
      "schedule_recurring",
      { goal: "Check iPhone price on Amazon", interval_minutes: 60, start_url: "https://amazon.com/dp/B12345", description: "Monitor price hourly" },
      "user wants price monitoring",
      "run_1"
    );
    assert.equal(result.type, "browser_action");
    assert.equal(result.action.type, "schedule_recurring");
    assert.equal(result.action.value, "Check iPhone price on Amazon");
    assert.equal(result.action.description, "Monitor price hourly");
    assert.equal(result.reasoning, "user wants price monitoring");
    const hint = JSON.parse(result.action.interactionHint);
    assert.equal(hint.intervalMinutes, 60);
    assert.equal(hint.startUrl, "https://amazon.com/dp/B12345");
  });

  it("omits startUrl from hint when not provided", () => {
    const result = mapToolCallToDecision(
      "schedule_recurring",
      { goal: "Check weather", interval_minutes: 1440, description: "Daily check" },
      "r",
      "run_1"
    );
    assert.equal(result.action.type, "schedule_recurring");
    const hint = JSON.parse(result.action.interactionHint);
    assert.equal(hint.intervalMinutes, 1440);
    assert.equal(hint.startUrl, undefined);
  });

  it("uses default description when missing", () => {
    const result = mapToolCallToDecision(
      "schedule_recurring",
      { goal: "Watch page", interval_minutes: 240 },
      "r",
      "run_1"
    );
    assert.equal(result.action.description, "Schedule recurring watch");
  });

  it("fails when goal is missing", () => {
    const result = mapToolCallToDecision(
      "schedule_recurring",
      { interval_minutes: 60, description: "Monitor" },
      "r",
      "run_1"
    );
    assert.equal(result.type, "task_failed");
    assert.ok(result.failureSummary.includes("without goal"));
  });

  it("fails when interval_minutes is missing", () => {
    const result = mapToolCallToDecision(
      "schedule_recurring",
      { goal: "Check price", description: "Monitor" },
      "r",
      "run_1"
    );
    assert.equal(result.type, "task_failed");
    assert.ok(result.failureSummary.includes("without interval_minutes"));
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

  it("includes extractedData when extracted_data is provided", () => {
    const result = mapToolCallToDecision(
      "task_complete",
      {
        summary: "Found the top 3 results",
        extracted_data: [
          { label: "Result 1", value: "Sony WH-1000XM6" },
          { label: "Result 2", value: "Bose QC Ultra" },
          { label: "Result 3", value: "Apple AirPods Max 2" }
        ]
      },
      "done",
      "run_1"
    );
    assert.equal(result.type, "task_complete");
    assert.equal(result.completionSummary, "Found the top 3 results");
    assert.ok(Array.isArray(result.extractedData));
    assert.equal(result.extractedData.length, 3);
    assert.equal(result.extractedData[0].label, "Result 1");
    assert.equal(result.extractedData[0].value, "Sony WH-1000XM6");
    assert.equal(result.extractedData[2].label, "Result 3");
  });

  it("omits extractedData when extracted_data is empty array", () => {
    const result = mapToolCallToDecision(
      "task_complete",
      { summary: "Done", extracted_data: [] },
      "done",
      "run_1"
    );
    assert.equal(result.extractedData, undefined);
  });

  it("filters out malformed items in extracted_data", () => {
    const result = mapToolCallToDecision(
      "task_complete",
      {
        summary: "Done",
        extracted_data: [
          { label: "Good", value: "item" },
          { label: 123, value: "bad label" },
          { label: "No value" },
          { label: "Also good", value: "item 2" }
        ]
      },
      "done",
      "run_1"
    );
    assert.ok(Array.isArray(result.extractedData));
    assert.equal(result.extractedData.length, 2);
    assert.equal(result.extractedData[0].label, "Good");
    assert.equal(result.extractedData[1].label, "Also good");
  });

  it("omits extractedData when extracted_data is not an array", () => {
    const result = mapToolCallToDecision(
      "task_complete",
      { summary: "Done", extracted_data: "not an array" },
      "done",
      "run_1"
    );
    assert.equal(result.extractedData, undefined);
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
// mapToolCallToDecision — missing required fields → task_failed
// ---------------------------------------------------------------------------

describe("mapToolCallToDecision — missing required fields", () => {
  it("browser_navigate without url returns task_failed", () => {
    const result = mapToolCallToDecision("browser_navigate", { description: "Go" }, "r", "run_1");
    assert.equal(result.type, "task_failed");
    assert.equal(result.failureSummary, "browser_navigate called without url");
    assert.equal(result.reasoning, "r");
  });

  it("browser_click without ref returns task_failed", () => {
    const result = mapToolCallToDecision("browser_click", { description: "Click" }, "r", "run_1");
    assert.equal(result.type, "task_failed");
    assert.equal(result.failureSummary, "browser_click called without ref");
  });

  it("browser_type without ref returns task_failed", () => {
    const result = mapToolCallToDecision("browser_type", { text: "hello" }, "r", "run_1");
    assert.equal(result.type, "task_failed");
    assert.equal(result.failureSummary, "browser_type called without ref");
  });

  it("browser_type without text returns task_failed", () => {
    const result = mapToolCallToDecision("browser_type", { ref: "el_1" }, "r", "run_1");
    assert.equal(result.type, "task_failed");
    assert.equal(result.failureSummary, "browser_type called without text");
  });

  it("browser_select without ref returns task_failed", () => {
    const result = mapToolCallToDecision("browser_select", { value: "opt" }, "r", "run_1");
    assert.equal(result.type, "task_failed");
    assert.equal(result.failureSummary, "browser_select called without ref");
  });

  it("browser_select without value returns task_failed", () => {
    const result = mapToolCallToDecision("browser_select", { ref: "el_1" }, "r", "run_1");
    assert.equal(result.type, "task_failed");
    assert.equal(result.failureSummary, "browser_select called without value");
  });

  it("browser_hover without ref returns task_failed", () => {
    const result = mapToolCallToDecision("browser_hover", { description: "Hover" }, "r", "run_1");
    assert.equal(result.type, "task_failed");
    assert.equal(result.failureSummary, "browser_hover called without ref");
  });

  it("browser_press_key without key returns task_failed", () => {
    const result = mapToolCallToDecision("browser_press_key", { description: "Press" }, "r", "run_1");
    assert.equal(result.type, "task_failed");
    assert.equal(result.failureSummary, "browser_press_key called without key");
  });

  it("browser_save_note without key returns task_failed", () => {
    const result = mapToolCallToDecision("browser_save_note", { value: "data" }, "r", "run_1");
    assert.equal(result.type, "task_failed");
    assert.equal(result.failureSummary, "browser_save_note called without key");
  });

  it("browser_save_note without value returns task_failed", () => {
    const result = mapToolCallToDecision("browser_save_note", { key: "k" }, "r", "run_1");
    assert.equal(result.type, "task_failed");
    assert.equal(result.failureSummary, "browser_save_note called without value");
  });

  it("browser_upload_file without ref returns task_failed", () => {
    const result = mapToolCallToDecision("browser_upload_file", { description: "Upload" }, "r", "run_1");
    assert.equal(result.type, "task_failed");
    assert.equal(result.failureSummary, "browser_upload_file called without ref");
  });

  it("browser_open_in_new_tab without url returns task_failed", () => {
    const result = mapToolCallToDecision("browser_open_in_new_tab", { description: "Open" }, "r", "run_1");
    assert.equal(result.type, "task_failed");
    assert.equal(result.failureSummary, "browser_open_in_new_tab called without url");
  });

  it("browser_switch_tab without tab_index returns task_failed", () => {
    const result = mapToolCallToDecision("browser_switch_tab", { description: "Switch" }, "r", "run_1");
    assert.equal(result.type, "task_failed");
    assert.equal(result.failureSummary, "browser_switch_tab called without tab_index");
  });

  it("schedule_recurring without goal returns task_failed", () => {
    const result = mapToolCallToDecision("schedule_recurring", { interval_minutes: 60 }, "r", "run_1");
    assert.equal(result.type, "task_failed");
    assert.equal(result.failureSummary, "schedule_recurring called without goal");
  });

  it("schedule_recurring without interval_minutes returns task_failed", () => {
    const result = mapToolCallToDecision("schedule_recurring", { goal: "Check" }, "r", "run_1");
    assert.equal(result.type, "task_failed");
    assert.equal(result.failureSummary, "schedule_recurring called without interval_minutes");
  });

  it("browser_navigate with empty string url returns task_failed", () => {
    const result = mapToolCallToDecision("browser_navigate", { url: "" }, "r", "run_1");
    assert.equal(result.type, "task_failed");
    assert.equal(result.failureSummary, "browser_navigate called without url");
  });

  it("browser_type with empty string text returns task_failed", () => {
    const result = mapToolCallToDecision("browser_type", { ref: "el_1", text: "" }, "r", "run_1");
    assert.equal(result.type, "task_failed");
    assert.equal(result.failureSummary, "browser_type called without text");
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
      ["browser_go_back", {}],
      ["browser_read_text", { ref: "r" }],
      ["browser_wait_for_text", { text: "t" }],
      ["browser_wait_for_navigation", {}],
      ["browser_save_note", { key: "k", value: "v" }],
      ["browser_upload_file", { ref: "r" }],
      ["browser_open_in_new_tab", { url: "https://example.com" }],
      ["browser_switch_tab", { tab_index: 0 }],
      ["schedule_recurring", { goal: "Check price", interval_minutes: 60 }],
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
