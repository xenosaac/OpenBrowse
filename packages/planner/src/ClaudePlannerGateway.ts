import Anthropic from "@anthropic-ai/sdk";
import type { BrowserAction, PlannerDecision } from "@openbrowse/contracts";
import type { PlannerGateway, PlannerInput } from "./PlannerGateway.js";
import { buildPlannerPrompt } from "./buildPlannerPrompt.js";
import { parsePlannerResponse } from "./parsePlannerResponse.js";

// Flat JSON schema for PlannerDecision — all type-specific fields are optional
// at the schema level; parsePlannerResponse validates semantic correctness.
// Using a flat (non-union) schema avoids anyOf complexity while still
// guaranteeing syntactically valid JSON output from the model.
const PLANNER_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: ["browser_action", "clarification_request", "approval_request", "task_complete", "task_failed"]
    },
    reasoning: { type: "string" },
    action: {
      type: "object",
      properties: {
        type: { type: "string" },
        targetId: { type: "string" },
        value: { type: "string" },
        description: { type: "string" }
      },
      required: ["type", "description"],
      additionalProperties: false
    },
    clarificationRequest: {
      type: "object",
      properties: {
        id: { type: "string" },
        runId: { type: "string" },
        question: { type: "string" },
        contextSummary: { type: "string" },
        options: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              summary: { type: "string" }
            },
            required: ["label"],
            additionalProperties: false
          }
        },
        createdAt: { type: "string" }
      },
      required: ["question"],
      additionalProperties: false
    },
    approvalRequest: {
      type: "object",
      properties: {
        id: { type: "string" },
        runId: { type: "string" },
        question: { type: "string" },
        irreversibleActionSummary: { type: "string" },
        createdAt: { type: "string" }
      },
      required: ["question"],
      additionalProperties: false
    },
    completionSummary: { type: "string" },
    failureSummary: { type: "string" }
  },
  required: ["type", "reasoning"],
  additionalProperties: false
} as const;

export interface ClaudePlannerConfig {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}

export class ClaudePlannerGateway implements PlannerGateway {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(config: ClaudePlannerConfig = {}) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model ?? "claude-sonnet-4-6";
    this.maxTokens = config.maxTokens ?? 4096;
  }

  async decide(input: PlannerInput): Promise<PlannerDecision<BrowserAction>> {
    const { system, user } = buildPlannerPrompt(input.run, input.pageModel);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      thinking: { type: "adaptive" },
      system,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      output_config: { format: { type: "json_schema", name: "planner_decision", schema: PLANNER_OUTPUT_SCHEMA } } as any,
      messages: [{ role: "user", content: user }]
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return {
        type: "task_failed",
        reasoning: "No text response from Claude",
        failureSummary: "Planner returned empty response"
      };
    }

    try {
      return parsePlannerResponse(textBlock.text);
    } catch (err) {
      return {
        type: "task_failed",
        reasoning: `Failed to parse planner response: ${err instanceof Error ? err.message : String(err)}`,
        failureSummary: "Could not parse planner decision"
      };
    }
  }
}
