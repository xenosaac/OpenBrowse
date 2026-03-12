import type { ClarificationRequest, PlannerDecision, TaskRun } from "@openbrowse/contracts";

export interface ClarificationPolicy {
  shouldSuspend(run: TaskRun, decision: PlannerDecision): boolean;
}

export class DefaultClarificationPolicy implements ClarificationPolicy {
  shouldSuspend(run: TaskRun, decision: PlannerDecision): boolean {
    return run.status === "running" && decision.type === "clarification_request";
  }
}

export function formatClarificationSummary(request: ClarificationRequest): string {
  const optionSummary =
    request.options.length === 0
      ? "No structured options provided."
      : request.options.map((option) => `${option.label}: ${option.summary}`).join(" | ");

  return `${request.question} ${optionSummary}`.trim();
}

