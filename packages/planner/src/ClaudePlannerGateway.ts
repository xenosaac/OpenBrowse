import Anthropic from "@anthropic-ai/sdk";
import type { BrowserAction, PlannerDecision } from "@openbrowse/contracts";
import type { PlannerGateway, PlannerInput } from "./PlannerGateway.js";
import { buildPlannerPrompt } from "./buildPlannerPrompt.js";
import { BROWSER_TOOLS, mapToolCallToDecision, type ToolInput } from "./toolMapping.js";

// ---------------------------------------------------------------------------
// Gateway
// ---------------------------------------------------------------------------

export interface ClaudePlannerConfig {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}

const PLANNER_TIMEOUT_MS = 60_000;

export class ClaudePlannerGateway implements PlannerGateway {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(config: ClaudePlannerConfig = {}) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model ?? "claude-opus-4-6";
    this.maxTokens = config.maxTokens ?? 4096;
  }

  async decide(input: PlannerInput): Promise<PlannerDecision<BrowserAction>> {
    const { system, user } = buildPlannerPrompt(input.run, input.pageModel);

    // Build user message content — include screenshot as image block when available
    const userContent: Anthropic.ContentBlockParam[] = [];
    if (input.screenshotBase64) {
      userContent.push({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: input.screenshotBase64
        }
      });
    }
    userContent.push({ type: "text", text: user });

    const messages: Anthropic.MessageParam[] = [{ role: "user", content: userContent }];

    // First call: tool_choice "auto" so Claude can reason before acting
    let response: Anthropic.Message;
    try {
      response = await this.callWithTimeout({
        model: this.model,
        max_tokens: this.maxTokens,
        system,
        tools: BROWSER_TOOLS,
        tool_choice: { type: "auto" },
        messages
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Planner timed out")) {
        return { type: "task_failed", reasoning: msg, failureSummary: msg };
      }
      throw err;
    }

    // Extract reasoning from text blocks
    const textBlocks = response.content.filter((b) => b.type === "text");
    const reasoning = textBlocks.map((b) => b.type === "text" ? b.text : "").join("\n").trim() || "No reasoning provided";

    // Extract tool use block
    let toolUseBlock = response.content.find((b) => b.type === "tool_use");

    // If Claude responded with text only (no tool call), retry with forced tool_choice
    if (!toolUseBlock || toolUseBlock.type !== "tool_use") {
      let retryError: string | undefined;
      try {
        const retryResponse = await this.callWithTimeout({
          model: this.model,
          max_tokens: this.maxTokens,
          system,
          tools: BROWSER_TOOLS,
          tool_choice: { type: "any" },
          messages: [
            ...messages,
            { role: "assistant", content: response.content },
            { role: "user", content: "You must now call exactly one tool to take action based on your analysis above." }
          ]
        });
        toolUseBlock = retryResponse.content.find((b) => b.type === "tool_use");
      } catch (err) {
        retryError = err instanceof Error ? err.message : String(err);
      }

      if (!toolUseBlock || toolUseBlock.type !== "tool_use") {
        const detail = retryError ? ` (retry error: ${retryError})` : "";
        return {
          type: "task_failed",
          reasoning: reasoning || "No tool call in Claude response",
          failureSummary: `Planner returned no tool call after retry${detail}`
        };
      }
    }

    const decision = mapToolCallToDecision(
      toolUseBlock.name,
      toolUseBlock.input as ToolInput,
      reasoning,
      input.run.id
    );

    // Attach API token usage for cost measurement (T50)
    if (response.usage) {
      decision.usage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens
      };
    }

    return decision;
  }

  private async callWithTimeout(
    params: Anthropic.MessageCreateParamsNonStreaming
  ): Promise<Anthropic.Message> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Planner timed out after ${PLANNER_TIMEOUT_MS / 1000}s`)), PLANNER_TIMEOUT_MS)
    );
    return Promise.race([this.client.messages.create(params), timeout]);
  }
}
