import type {
  BrowserAction,
  BrowserActionResult,
  ClarificationResponse,
  PlannerDecision,
  TaskIntent,
  TaskRun
} from "@openbrowse/contracts";
import type { ClarificationPolicy } from "./ClarificationPolicy";

export interface TaskOrchestratorDeps {
  clarificationPolicy: ClarificationPolicy;
}

export class TaskOrchestrator {
  constructor(private readonly deps: TaskOrchestratorDeps) {}

  createRun(intent: TaskIntent): TaskRun {
    const now = new Date().toISOString();

    return {
      id: `run_${intent.id}`,
      taskIntentId: intent.id,
      status: "queued",
      goal: intent.goal,
      source: intent.source,
      profileId: intent.preferredProfileId,
      createdAt: now,
      updatedAt: now,
      checkpoint: {
        summary: "Run created from task intent.",
        notes: []
      }
    };
  }

  applyPlannerDecision(run: TaskRun, decision: PlannerDecision<BrowserAction>): TaskRun {
    const updatedAt = new Date().toISOString();

    if (this.deps.clarificationPolicy.shouldSuspend(run, decision)) {
      return {
        ...run,
        status: "suspended_for_clarification",
        updatedAt,
        checkpoint: {
          ...run.checkpoint,
          summary: decision.reasoning,
          pendingClarificationId: decision.clarificationRequest?.id
        }
      };
    }

    if (decision.type === "task_complete") {
      return {
        ...run,
        status: "completed",
        updatedAt,
        checkpoint: {
          ...run.checkpoint,
          summary: decision.completionSummary ?? decision.reasoning
        }
      };
    }

    if (decision.type === "task_failed") {
      return {
        ...run,
        status: "failed",
        updatedAt,
        checkpoint: {
          ...run.checkpoint,
          summary: decision.failureSummary ?? decision.reasoning
        }
      };
    }

    return {
      ...run,
      status: run.status === "queued" ? "running" : run.status,
      updatedAt,
      checkpoint: {
        ...run.checkpoint,
        summary: decision.reasoning
      }
    };
  }

  recordBrowserResult(run: TaskRun, result: BrowserActionResult): TaskRun {
    return {
      ...run,
      status: "running",
      updatedAt: new Date().toISOString(),
      checkpoint: {
        ...run.checkpoint,
        summary: result.summary,
        lastPageModelId: result.pageModelId
      }
    };
  }

  resumeFromClarification(run: TaskRun, response: ClarificationResponse): TaskRun {
    return {
      ...run,
      status: "running",
      updatedAt: response.respondedAt,
      checkpoint: {
        ...run.checkpoint,
        summary: `Clarification answered: ${response.answer}`,
        pendingClarificationId: undefined,
        notes: [...run.checkpoint.notes, response.answer]
      }
    };
  }
}

