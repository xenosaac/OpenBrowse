import Anthropic from "@anthropic-ai/sdk";
import type { BrowserAction, PlannerDecision } from "@openbrowse/contracts";
import type { PlannerGateway, PlannerInput } from "./PlannerGateway.js";
import { buildPlannerPrompt } from "./buildPlannerPrompt.js";
import { parsePlannerResponse } from "./parsePlannerResponse.js";

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
    this.maxTokens = config.maxTokens ?? 1024;
  }

  async decide(input: PlannerInput): Promise<PlannerDecision<BrowserAction>> {
    const { system, user } = buildPlannerPrompt(input.run, input.pageModel);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system,
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
