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
    name: "task_complete",
    description: "Mark the task as successfully completed.",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: { type: "string", description: "A summary of what was accomplished" }
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
  description?: string;
  summary?: string;
  reason?: string;
  question?: string;
  options?: Array<{ label: string; summary?: string }>;
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
          description: input.description ?? "Type text"
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

    case "task_complete":
      return {
        type: "task_complete",
        reasoning,
        completionSummary: input.summary ?? reasoning
      };

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
