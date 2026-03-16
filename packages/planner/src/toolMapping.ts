import type Anthropic from "@anthropic-ai/sdk";
import type { BrowserAction, PlannerDecision } from "@openbrowse/contracts";

// ---------------------------------------------------------------------------
// Tool definitions for Claude tool_use
// ---------------------------------------------------------------------------

export const BROWSER_TOOLS: Anthropic.Tool[] = [
  {
    name: "browser_navigate",
    description: "Navigate to a URL. Use when you need to go to a specific page.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "The URL to navigate to" },
        description: { type: "string", description: "Why you are navigating here" }
      },
      required: ["url", "description"]
    }
  },
  {
    name: "browser_click",
    description: "Click on an interactive element identified by its ref ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        ref: { type: "string", description: "The element ID (e.g. el_5)" },
        description: { type: "string", description: "What you expect this click to do" }
      },
      required: ["ref", "description"]
    }
  },
  {
    name: "browser_type",
    description: "Type text into a focused input or textarea element.",
    input_schema: {
      type: "object" as const,
      properties: {
        ref: { type: "string", description: "The element ID to type into (e.g. el_3)" },
        text: { type: "string", description: "The text to type" },
        clear_first: { type: "boolean", description: "If true, select all existing text in the field before typing (replaces content instead of appending). Use when the field already has a value you want to replace." },
        description: { type: "string", description: "Why you are typing this" }
      },
      required: ["ref", "text", "description"]
    }
  },
  {
    name: "browser_select",
    description: "Select an option from a dropdown (<select>) element.",
    input_schema: {
      type: "object" as const,
      properties: {
        ref: { type: "string", description: "The element ID of the <select>" },
        value: { type: "string", description: "The option value to select" },
        description: { type: "string", description: "Why you are selecting this option" }
      },
      required: ["ref", "value", "description"]
    }
  },
  {
    name: "browser_scroll",
    description: "Scroll the page or a specific element up or down.",
    input_schema: {
      type: "object" as const,
      properties: {
        direction: { type: "string", enum: ["up", "down"], description: "Scroll direction" },
        ref: { type: "string", description: "Optional element ID to scroll within" },
        description: { type: "string", description: "Why you are scrolling" }
      },
      required: ["direction", "description"]
    }
  },
  {
    name: "browser_hover",
    description: "Hover over an element to reveal tooltips or dropdown menus.",
    input_schema: {
      type: "object" as const,
      properties: {
        ref: { type: "string", description: "The element ID to hover over" },
        description: { type: "string", description: "What you expect hovering to reveal" }
      },
      required: ["ref", "description"]
    }
  },
  {
    name: "browser_press_key",
    description: "Press a key or key combination (e.g. Enter, Escape, Tab, Ctrl+A).",
    input_schema: {
      type: "object" as const,
      properties: {
        key: { type: "string", description: "The key or combination (e.g. 'Enter', 'Tab', 'Escape', 'Ctrl+A')" },
        description: { type: "string", description: "Why you are pressing this key" }
      },
      required: ["key", "description"]
    }
  },
  {
    name: "browser_wait",
    description: "Wait for a specified duration (milliseconds). Use when you need to wait for content to load.",
    input_schema: {
      type: "object" as const,
      properties: {
        duration: { type: "number", description: "Duration in milliseconds (default 1000)" },
        description: { type: "string", description: "Why you are waiting" }
      },
      required: ["description"]
    }
  },
  {
    name: "browser_screenshot",
    description: "Capture a screenshot of the current page. Use when you need to see the visual layout.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: []
    }
  },
  {
    name: "browser_go_back",
    description: "Navigate back to the previous page (like pressing the browser back button). Use after visiting a page to return to search results or a previous page.",
    input_schema: {
      type: "object" as const,
      properties: {
        description: { type: "string", description: "Why you are going back" }
      },
      required: ["description"]
    }
  },
  {
    name: "browser_read_text",
    description: "Read the full text content (up to 2000 chars) from a specific element and its children. Use when you need to read detailed content from a particular section, paragraph, article body, search result, or any element whose text was truncated in the element list.",
    input_schema: {
      type: "object" as const,
      properties: {
        ref: { type: "string", description: "The element ID to read text from (e.g. el_5)" },
        description: { type: "string", description: "What content you expect to find" }
      },
      required: ["ref", "description"]
    }
  },
  {
    name: "browser_wait_for_text",
    description: "Wait for specific text to appear on the page. Use after actions that trigger dynamic content loading (submitting a search, clicking a navigation link on an SPA, submitting a form). More reliable than browser_wait because it returns as soon as the text appears instead of waiting a fixed duration.",
    input_schema: {
      type: "object" as const,
      properties: {
        text: { type: "string", description: "The text to wait for on the page (case-sensitive substring match)" },
        timeout: { type: "number", description: "Maximum time to wait in milliseconds (default 5000)" },
        description: { type: "string", description: "Why you are waiting for this text" }
      },
      required: ["text", "description"]
    }
  },
  {
    name: "browser_wait_for_navigation",
    description: "Wait for the page URL to change (navigation to a new page). Use after submitting a form, clicking a login button, or any action that should redirect to a different URL. More reliable than browser_wait because it returns as soon as the URL changes instead of waiting a fixed duration.",
    input_schema: {
      type: "object" as const,
      properties: {
        timeout: { type: "number", description: "Maximum time to wait in milliseconds (default 10000)" },
        description: { type: "string", description: "Why you expect navigation to occur" }
      },
      required: ["description"]
    }
  },
  {
    name: "browser_save_note",
    description: "Save a note to your scratchpad for later reference. Use this to record intermediate findings, extracted data, or context you'll need on a future page (e.g. search results, prices, names, URLs to visit next). Notes persist across page navigations and appear in your context on every subsequent step.",
    input_schema: {
      type: "object" as const,
      properties: {
        key: { type: "string", description: "A short label for this note (e.g. 'Site 1 price', 'Top 3 results', 'Login URL')" },
        value: { type: "string", description: "The note content — the information to remember" },
        description: { type: "string", description: "Why you are saving this note" }
      },
      required: ["key", "value", "description"]
    }
  },
  {
    name: "task_complete",
    description: "Mark the task as successfully completed. When the task involved finding, extracting, or looking up information, include the results in extracted_data as labeled key-value pairs.",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: { type: "string", description: "A summary of what was accomplished" },
        extracted_data: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Label for this data item (e.g. 'Top result', 'Price', 'Email')" },
              value: { type: "string", description: "The extracted value" }
            },
            required: ["label", "value"]
          },
          description: "Structured data extracted during the task. Use for search results, extracted fields, looked-up values, etc."
        }
      },
      required: ["summary"]
    }
  },
  {
    name: "task_failed",
    description: "Mark the task as failed when it is truly impossible to complete.",
    input_schema: {
      type: "object" as const,
      properties: {
        reason: { type: "string", description: "Why the task cannot be completed" }
      },
      required: ["reason"]
    }
  },
  {
    name: "ask_user",
    description: "Ask the user a question when you need clarification or cannot proceed without human input (e.g. CAPTCHA, ambiguous instructions).",
    input_schema: {
      type: "object" as const,
      properties: {
        question: { type: "string", description: "The question to ask" },
        options: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              summary: { type: "string" }
            },
            required: ["label"]
          },
          description: "Optional multiple-choice options"
        }
      },
      required: ["question"]
    }
  }
];

// ---------------------------------------------------------------------------
// Tool call → PlannerDecision mapping
// ---------------------------------------------------------------------------

export interface ToolInput {
  url?: string;
  ref?: string;
  text?: string;
  value?: string;
  direction?: string;
  key?: string;
  duration?: number;
  timeout?: number;
  clear_first?: boolean;
  description?: string;
  summary?: string;
  reason?: string;
  question?: string;
  options?: Array<{ label: string; summary?: string }>;
  extracted_data?: Array<Record<string, unknown>>;
  // Note: 'key' is used by both browser_press_key (keyboard key) and browser_save_note (note label).
  // The mapping function disambiguates by tool name.
}

export function mapToolCallToDecision(
  toolName: string,
  input: ToolInput,
  reasoning: string,
  runId: string
): PlannerDecision<BrowserAction> {
  const fail = (msg: string): PlannerDecision<BrowserAction> => ({
    type: "task_failed",
    reasoning,
    failureSummary: msg
  });

  switch (toolName) {
    case "browser_navigate":
      if (!input.url) return fail("browser_navigate called without url");
      return {
        type: "browser_action",
        reasoning,
        action: {
          type: "navigate",
          value: input.url,
          description: input.description ?? "Navigate"
        }
      };

    case "browser_click":
      if (!input.ref) return fail("browser_click called without ref");
      return {
        type: "browser_action",
        reasoning,
        action: {
          type: "click",
          targetId: input.ref,
          description: input.description ?? "Click"
        }
      };

    case "browser_type":
      if (!input.ref) return fail("browser_type called without ref");
      if (!input.text) return fail("browser_type called without text");
      return {
        type: "browser_action",
        reasoning,
        action: {
          type: "type",
          targetId: input.ref,
          value: input.text,
          description: input.description ?? "Type text",
          clearFirst: input.clear_first === true ? true : undefined
        }
      };

    case "browser_select":
      if (!input.ref) return fail("browser_select called without ref");
      if (!input.value) return fail("browser_select called without value");
      return {
        type: "browser_action",
        reasoning,
        action: {
          type: "select",
          targetId: input.ref,
          value: input.value,
          description: input.description ?? "Select option"
        }
      };

    case "browser_scroll":
      return {
        type: "browser_action",
        reasoning,
        action: {
          type: "scroll",
          targetId: input.ref,
          value: input.direction ?? "down",
          description: input.description ?? "Scroll"
        }
      };

    case "browser_hover":
      if (!input.ref) return fail("browser_hover called without ref");
      return {
        type: "browser_action",
        reasoning,
        action: {
          type: "hover",
          targetId: input.ref,
          description: input.description ?? "Hover"
        }
      };

    case "browser_press_key":
      if (!input.key) return fail("browser_press_key called without key");
      return {
        type: "browser_action",
        reasoning,
        action: {
          type: "pressKey",
          value: input.key,
          description: input.description ?? "Press key"
        }
      };

    case "browser_wait":
      return {
        type: "browser_action",
        reasoning,
        action: {
          type: "wait",
          value: String(input.duration ?? 1000),
          description: input.description ?? "Wait"
        }
      };

    case "browser_screenshot":
      return {
        type: "browser_action",
        reasoning,
        action: {
          type: "screenshot",
          description: "Capture screenshot"
        }
      };

    case "browser_go_back":
      return {
        type: "browser_action",
        reasoning,
        action: {
          type: "go_back",
          description: input.description ?? "Go back to previous page"
        }
      };

    case "browser_read_text":
      if (!input.ref) return fail("browser_read_text called without ref");
      return {
        type: "browser_action",
        reasoning,
        action: {
          type: "read_text",
          targetId: input.ref,
          description: input.description ?? "Read element text"
        }
      };

    case "browser_wait_for_text":
      if (!input.text) return fail("browser_wait_for_text called without text");
      return {
        type: "browser_action",
        reasoning,
        action: {
          type: "wait_for_text",
          value: input.text,
          description: input.description ?? "Wait for text",
          interactionHint: String(input.timeout ?? 5000)
        }
      };

    case "browser_wait_for_navigation":
      return {
        type: "browser_action",
        reasoning,
        action: {
          type: "wait_for_navigation",
          description: input.description ?? "Wait for navigation",
          interactionHint: String(input.timeout ?? 10000)
        }
      };

    case "browser_save_note":
      if (!input.key) return fail("browser_save_note called without key");
      if (!input.value) return fail("browser_save_note called without value");
      return {
        type: "browser_action",
        reasoning,
        action: {
          type: "save_note",
          value: input.value,
          description: input.description ?? "Save note",
          interactionHint: input.key
        }
      };

    case "task_complete": {
      const extractedData = Array.isArray(input.extracted_data)
        ? input.extracted_data
            .filter((item: Record<string, unknown>) => typeof item.label === "string" && typeof item.value === "string")
            .map((item: Record<string, unknown>) => ({ label: item.label as string, value: item.value as string }))
        : undefined;
      return {
        type: "task_complete",
        reasoning,
        completionSummary: input.summary ?? reasoning,
        extractedData: extractedData && extractedData.length > 0 ? extractedData : undefined
      };
    }

    case "task_failed":
      return {
        type: "task_failed",
        reasoning,
        failureSummary: input.reason ?? reasoning
      };

    case "ask_user": {
      const options = (input.options ?? []).map((o, i) => ({
        id: `opt_${i}`,
        label: o.label,
        summary: o.summary ?? o.label
      }));
      return {
        type: "clarification_request",
        reasoning,
        clarificationRequest: {
          id: `clarify_${runId}_${Date.now()}`,
          runId,
          question: input.question ?? reasoning,
          contextSummary: reasoning,
          options,
          createdAt: new Date().toISOString()
        }
      };
    }

    default:
      return {
        type: "task_failed",
        reasoning,
        failureSummary: `Unknown tool call: ${toolName}`
      };
  }
}
