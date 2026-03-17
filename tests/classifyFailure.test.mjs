import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyFailure } from "../apps/desktop/src/renderer/lib/classifyFailure.ts";

describe("classifyFailure", () => {
  describe("navigation_failed", () => {
    it("classifies ERR_ABORTED navigation failure", () => {
      const result = classifyFailure(
        "Failed to execute navigate: ERR_ABORTED (-3) loading 'https://mojavereptiles.com/product/rock-hyrax-for-sale/'"
      );
      assert.equal(result.category, "navigation_failed");
      assert.ok(result.userMessage.includes("didn't respond"));
    });

    it("classifies navigation timeout", () => {
      const result = classifyFailure(
        "Failed to execute navigate: Navigation to https://www.tomsguide.com/news/wordle-answer-today timed out after 30000ms"
      );
      assert.equal(result.category, "navigation_failed");
    });

    it("classifies ERR_NAME_NOT_RESOLVED", () => {
      const result = classifyFailure(
        "Failed to execute navigate: ERR_NAME_NOT_RESOLVED (-105) loading 'https://eval.eee.uci.edu/'"
      );
      assert.equal(result.category, "navigation_failed");
    });
  });

  describe("agent_stuck", () => {
    it("classifies URL visit cap stuck", () => {
      const result = classifyFailure(
        "Stuck: visited https://www.nytimes.com/games/wordle/index.html 13 times. Moving on is not working."
      );
      assert.equal(result.category, "agent_stuck");
      assert.ok(result.userMessage.includes("stuck"));
    });

    it("classifies 2-step cycle", () => {
      const result = classifyFailure(
        "Stuck in 2-step cycle. The agent is repeating the same sequence of actions."
      );
      assert.equal(result.category, "agent_stuck");
    });

    it("classifies repeated action stuck", () => {
      const result = classifyFailure(
        "Stuck: repeated \"click\" on https://www.nytimes.com/games/wordle/index.html 3 times."
      );
      assert.equal(result.category, "agent_stuck");
    });

    it("classifies alternating cycle", () => {
      const result = classifyFailure(
        "Stuck in cycle: alternating between actions. Try a completely different strategy."
      );
      assert.equal(result.category, "agent_stuck");
    });

    it("classifies repeated screenshot stuck", () => {
      const result = classifyFailure(
        "Stuck: repeated \"screenshot\" on https://www.birdbreeders.com/bird/214432/softbill-toucan 3 times. The task may not be actionable."
      );
      assert.equal(result.category, "agent_stuck");
    });

    it("classifies repeated navigate stuck", () => {
      const result = classifyFailure(
        "Stuck: repeated \"navigate\" on https://edtechtools.eee.uci.edu/eee-retirements/ 3 times. The task may not be actionable."
      );
      assert.equal(result.category, "agent_stuck");
    });
  });

  describe("session_lost", () => {
    it("classifies session not found", () => {
      const result = classifyFailure(
        "Browser session lost: Session not found: session_run_task_1773683011883_1773683179738"
      );
      assert.equal(result.category, "session_lost");
      assert.ok(result.userMessage.includes("tab was closed"));
    });

    it("classifies bare session not found", () => {
      const result = classifyFailure(
        "Session not found: session_run_task_1773612218607_1773612218610"
      );
      assert.equal(result.category, "session_lost");
    });
  });

  describe("element_stale", () => {
    it("classifies target not found", () => {
      const result = classifyFailure(
        "Failed to execute click: Target not found: el_65"
      );
      assert.equal(result.category, "element_stale");
      assert.ok(result.userMessage.includes("element disappeared"));
    });
  });

  describe("api_error", () => {
    it("classifies credit balance error", () => {
      const result = classifyFailure(
        'Planner request failed: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}'
      );
      assert.equal(result.category, "api_error");
      assert.ok(result.userMessage.includes("AI service"));
    });

    it("classifies rate limit error", () => {
      const result = classifyFailure(
        'Planner request failed: 429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your rate limit."}}'
      );
      assert.equal(result.category, "api_error");
    });
  });

  describe("content_policy", () => {
    it("classifies content refusal", () => {
      const result = classifyFailure(
        "I'm sorry, but I can't assist with requests for pornographic or adult sexual content. This falls outside the boundaries of what I'm able to help with."
      );
      assert.equal(result.category, "content_policy");
      assert.ok(result.userMessage.includes("content policy"));
    });
  });

  describe("unknown", () => {
    it("classifies unrecognized failure as unknown", () => {
      const result = classifyFailure("Something completely unexpected happened");
      assert.equal(result.category, "unknown");
      assert.ok(result.userMessage.includes("task failed"));
      assert.ok(result.suggestion.includes("Try again"));
    });
  });

  describe("classification priority", () => {
    it("content_policy takes priority over navigation keywords", () => {
      const result = classifyFailure(
        "I can't assist with this request. Navigation to the site was attempted but outside the boundaries of policy."
      );
      assert.equal(result.category, "content_policy");
    });

    it("session_lost takes priority over navigation keywords", () => {
      const result = classifyFailure(
        "Browser session lost: Session not found after navigation timeout"
      );
      assert.equal(result.category, "session_lost");
    });
  });

  describe("return shape", () => {
    it("always returns category, userMessage, and suggestion", () => {
      for (const input of [
        "ERR_ABORTED",
        "Stuck in cycle",
        "Session not found",
        "Target not found",
        "Planner request failed: 429",
        "can't assist",
        "random error",
      ]) {
        const result = classifyFailure(input);
        assert.ok(typeof result.category === "string");
        assert.ok(typeof result.userMessage === "string");
        assert.ok(typeof result.suggestion === "string");
        assert.ok(result.userMessage.length > 0);
        assert.ok(result.suggestion.length > 0);
      }
    });
  });
});
