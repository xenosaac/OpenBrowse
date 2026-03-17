/**
 * Classifies raw failure summary strings into user-actionable categories
 * with friendly messages and suggestions.
 */

export type FailureCategory =
  | "navigation_failed"
  | "agent_stuck"
  | "session_lost"
  | "element_stale"
  | "api_error"
  | "content_policy"
  | "unknown";

export interface FailureClassification {
  category: FailureCategory;
  userMessage: string;
  suggestion: string;
}

const patterns: Array<{
  test: (s: string) => boolean;
  category: FailureCategory;
  userMessage: string;
  suggestion: string;
}> = [
  {
    test: (s) => /content.policy|can't assist|cannot assist|inappropriate|outside the boundaries/i.test(s),
    category: "content_policy",
    userMessage: "This request was declined due to content policy.",
    suggestion: "Try rephrasing your task.",
  },
  {
    test: (s) => /session.not found|browser session lost|session.*lost/i.test(s),
    category: "session_lost",
    userMessage: "The browser tab was closed during the task.",
    suggestion: "Try again — the agent will open a new tab.",
  },
  {
    test: (s) => /ERR_ABORTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_SSL|navigation.*timed?\s*out|Failed to execute navigate|navigation.failed/i.test(s),
    category: "navigation_failed",
    userMessage: "Navigation failed — the site didn't respond.",
    suggestion: "Check your internet connection, or try again later.",
  },
  {
    test: (s) => /stuck.*(cycle|repeated|alternating|visited.*\d+\s*times)|repeating the same/i.test(s),
    category: "agent_stuck",
    userMessage: "The agent got stuck repeating the same actions.",
    suggestion: "Try rephrasing your task or breaking it into smaller steps.",
  },
  {
    test: (s) => /target not found|element.*not found|element.*stale/i.test(s),
    category: "element_stale",
    userMessage: "A page element disappeared before the agent could interact with it.",
    suggestion: "Try again — the page may have changed during the task.",
  },
  {
    test: (s) => /planner request failed|credit balance|rate.limit|429|api.*error/i.test(s),
    category: "api_error",
    userMessage: "The AI service encountered an error.",
    suggestion: "This is usually temporary — try again in a few minutes.",
  },
];

export function classifyFailure(summary: string): FailureClassification {
  for (const p of patterns) {
    if (p.test(summary)) {
      return {
        category: p.category,
        userMessage: p.userMessage,
        suggestion: p.suggestion,
      };
    }
  }
  return {
    category: "unknown",
    userMessage: "The task failed.",
    suggestion: "Try again, or rephrase your request.",
  };
}
