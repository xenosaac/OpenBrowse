import type { BrowserAction, PlannerDecision } from "@openbrowse/contracts";

const VALID_DECISION_TYPES = new Set([
  "browser_action",
  "clarification_request",
  "approval_request",
  "task_complete",
  "task_failed"
]);

/**
 * Extract a JSON object from a response that may contain prose before/after it.
 * Tries, in order:
 *   1. Markdown code blocks (```json ... ```)
 *   2. Raw JSON.parse on the whole string
 *   3. First { ... } block using brace-depth counting
 */
function extractJson(raw: string): unknown {
  const trimmed = raw.trim();

  // 1. Try markdown code blocks
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // Fall through
    }
  }

  // 2. Try raw JSON.parse
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through
  }

  // 3. Extract first { ... } block using brace-depth counting
  const startIndex = trimmed.indexOf("{");
  if (startIndex === -1) {
    throw new Error(`No JSON object found in planner response: ${trimmed.slice(0, 120)}...`);
  }

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIndex; i < trimmed.length; i++) {
    const ch = trimmed[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        const jsonCandidate = trimmed.slice(startIndex, i + 1);
        return JSON.parse(jsonCandidate);
      }
    }
  }

  throw new Error(`Incomplete JSON object in planner response: ${trimmed.slice(0, 120)}...`);
}

export function parsePlannerResponse(raw: string): PlannerDecision<BrowserAction> {
  const parsed = extractJson(raw) as Record<string, unknown>;

  if (!parsed.type || !parsed.reasoning) {
    throw new Error("Invalid planner response: missing type or reasoning");
  }

  if (!VALID_DECISION_TYPES.has(parsed.type as string)) {
    throw new Error(`Invalid planner response: unsupported type "${parsed.type}"`);
  }

  const decision: PlannerDecision<BrowserAction> = {
    type: parsed.type as PlannerDecision<BrowserAction>["type"],
    reasoning: parsed.reasoning as string
  };

  if (parsed.type === "browser_action" && parsed.action) {
    const action = parsed.action as Record<string, string>;
    decision.action = {
      type: action.type as BrowserAction["type"],
      targetId: action.targetId,
      value: action.value,
      description: action.description ?? (parsed.reasoning as string)
    };
  }

  if (parsed.type === "clarification_request" && parsed.clarificationRequest) {
    const cr = parsed.clarificationRequest as Record<string, unknown>;
    decision.clarificationRequest = {
      id: (cr.id as string) ?? `clarify_${Date.now()}`,
      runId: (cr.runId as string) ?? "",
      question: cr.question as string,
      contextSummary: (cr.contextSummary as string) ?? "",
      options: ((cr.options as Array<{ id?: string; label: string; summary?: string }>) ?? []).map(
        (o, i) => ({
          id: o.id ?? `opt_${i}`,
          label: o.label,
          summary: o.summary ?? o.label
        })
      ),
      createdAt: (cr.createdAt as string) ?? new Date().toISOString()
    };
  }

  if (parsed.type === "task_complete") {
    decision.completionSummary = (parsed.completionSummary as string) ?? (parsed.reasoning as string);
  }

  if (parsed.type === "approval_request" && parsed.approvalRequest) {
    const ar = parsed.approvalRequest as Record<string, unknown>;
    decision.approvalRequest = {
      id: (ar.id as string) ?? `approval_${Date.now()}`,
      runId: (ar.runId as string) ?? "",
      question: ar.question as string,
      irreversibleActionSummary:
        (ar.irreversibleActionSummary as string) ?? (parsed.reasoning as string),
      createdAt: (ar.createdAt as string) ?? new Date().toISOString()
    };
  }

  if (parsed.type === "task_failed") {
    decision.failureSummary = (parsed.failureSummary as string) ?? (parsed.reasoning as string);
  }

  return decision;
}

