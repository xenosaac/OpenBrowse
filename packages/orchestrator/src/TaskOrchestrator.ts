import type {
  BrowserAction,
  BrowserActionResult,
  ClarificationResponse,
  PageModel,
  PlannerDecision,
  TaskIntent,
  TaskRun
} from "@openbrowse/contracts";
import type { ClarificationPolicy } from "./ClarificationPolicy.js";
import { assertTransition } from "./RunStateMachine.js";

export interface TaskOrchestratorDeps {
  clarificationPolicy: ClarificationPolicy;
}

export class TaskOrchestrator {
  constructor(private readonly deps: TaskOrchestratorDeps) {}

  createRun(intent: TaskIntent): TaskRun {
    const now = intent.createdAt ?? new Date().toISOString();

    return {
      id: `run_${intent.id}`,
      taskIntentId: intent.id,
      status: "queued",
      goal: intent.goal,
      source: intent.source,
      constraints: intent.constraints,
      metadata: intent.metadata,
      profileId: intent.preferredProfileId,
      createdAt: now,
      updatedAt: now,
      checkpoint: {
        summary: "Run created from task intent.",
        notes: []
      }
    };
  }

  startRun(run: TaskRun): TaskRun {
    assertTransition(run.status, "running");

    return {
      ...run,
      status: "running",
      updatedAt: new Date().toISOString(),
      checkpoint: {
        ...run.checkpoint,
        summary: "Run started."
      }
    };
  }

  attachSession(run: TaskRun, profileId: string, browserSessionId: string, pageModelId?: string): TaskRun {
    return {
      ...run,
      profileId,
      updatedAt: new Date().toISOString(),
      checkpoint: {
        ...run.checkpoint,
        browserSessionId,
        lastPageModelId: pageModelId
      }
    };
  }

  observePage(run: TaskRun, pageModel: PageModel, browserSessionId?: string): TaskRun {
    return {
      ...run,
      updatedAt: new Date().toISOString(),
      checkpoint: {
        ...run.checkpoint,
        browserSessionId: browserSessionId ?? run.checkpoint.browserSessionId,
        lastPageModelId: pageModel.id,
        lastKnownUrl: pageModel.url
      }
    };
  }

  applyPlannerDecision(run: TaskRun, decision: PlannerDecision<BrowserAction>): TaskRun {
    const updatedAt = new Date().toISOString();

    if (this.deps.clarificationPolicy.shouldSuspend(run, decision)) {
      assertTransition(run.status, "suspended_for_clarification");

      return {
        ...run,
        status: "suspended_for_clarification",
        updatedAt,
        checkpoint: {
          ...run.checkpoint,
          summary: decision.reasoning,
          pendingClarificationId: decision.clarificationRequest?.id,
          pendingApprovalId: undefined,
          pendingBrowserAction: undefined
        },
        suspension: decision.clarificationRequest
          ? {
              type: "clarification",
              requestId: decision.clarificationRequest.id,
              question: decision.clarificationRequest.question,
              createdAt: decision.clarificationRequest.createdAt
            }
          : undefined
      };
    }

    if (decision.type === "approval_request" && decision.approvalRequest) {
      assertTransition(run.status, "suspended_for_approval");

      return {
        ...run,
        status: "suspended_for_approval",
        updatedAt,
        checkpoint: {
          ...run.checkpoint,
          summary: decision.reasoning,
          pendingApprovalId: decision.approvalRequest.id,
          pendingClarificationId: undefined,
          pendingBrowserAction: decision.action
        },
        suspension: {
          type: "approval",
          requestId: decision.approvalRequest.id,
          question: decision.approvalRequest.question,
          createdAt: decision.approvalRequest.createdAt
        }
      };
    }

    if (decision.type === "task_complete") {
      assertTransition(run.status, "completed");

      return {
        ...run,
        status: "completed",
        updatedAt,
        checkpoint: {
          ...run.checkpoint,
          summary: decision.completionSummary ?? decision.reasoning,
          pendingApprovalId: undefined,
          pendingClarificationId: undefined,
          pendingBrowserAction: undefined
        },
        outcome: {
          status: "completed",
          summary: decision.completionSummary ?? decision.reasoning,
          finishedAt: updatedAt
        },
        suspension: undefined
      };
    }

    if (decision.type === "task_failed") {
      assertTransition(run.status, "failed");

      return {
        ...run,
        status: "failed",
        updatedAt,
        checkpoint: {
          ...run.checkpoint,
          summary: decision.failureSummary ?? decision.reasoning,
          pendingApprovalId: undefined,
          pendingClarificationId: undefined,
          pendingBrowserAction: undefined
        },
        outcome: {
          status: "failed",
          summary: decision.failureSummary ?? decision.reasoning,
          finishedAt: updatedAt
        },
        suspension: undefined
      };
    }

    if (run.status === "queued") {
      assertTransition(run.status, "running");
    }

    return {
      ...run,
      status: run.status === "queued" ? "running" : run.status,
      updatedAt,
      checkpoint: {
        ...run.checkpoint,
        summary: decision.reasoning,
        pendingApprovalId: undefined
      },
      suspension: undefined
    };
  }

  recordBrowserResult(run: TaskRun, result: BrowserActionResult): TaskRun {
    if (run.status !== "running") {
      assertTransition(run.status, "running");
    }

    return {
      ...run,
      status: "running",
      updatedAt: new Date().toISOString(),
      checkpoint: {
        ...run.checkpoint,
        summary: result.summary,
        lastPageModelId: result.pageModelId,
        pendingBrowserAction: undefined
      }
    };
  }

  resumeFromClarification(run: TaskRun, response: ClarificationResponse): TaskRun {
    assertTransition(run.status, "running");

    return {
      ...run,
      status: "running",
      updatedAt: response.respondedAt,
      checkpoint: {
        ...run.checkpoint,
        summary: `Clarification answered: ${response.answer}`,
        pendingClarificationId: undefined,
        pendingApprovalId: undefined,
        notes: [...run.checkpoint.notes, response.answer]
      },
      suspension: undefined
    };
  }

  resumeFromApproval(run: TaskRun, approved: boolean, respondedAt = new Date().toISOString()): TaskRun {
    assertTransition(run.status, "running");

    const summary = approved
      ? "Approval granted. Resuming action."
      : "Approval denied. Action cancelled.";

    return {
      ...run,
      status: "running",
      updatedAt: respondedAt,
      checkpoint: {
        ...run.checkpoint,
        summary,
        pendingApprovalId: undefined,
        notes: [
          ...run.checkpoint.notes,
          approved ? "User approved action" : "User denied approval"
        ]
      },
      suspension: undefined
    };
  }

  failRun(run: TaskRun, summary: string, finishedAt = new Date().toISOString()): TaskRun {
    assertTransition(run.status, "failed");

    return {
      ...run,
      status: "failed",
      updatedAt: finishedAt,
      checkpoint: {
        ...run.checkpoint,
        summary,
        pendingApprovalId: undefined,
        pendingClarificationId: undefined,
        pendingBrowserAction: undefined
      },
      outcome: {
        status: "failed",
        summary,
        finishedAt
      },
      suspension: undefined
    };
  }

  cancelRun(run: TaskRun, summary: string, finishedAt = new Date().toISOString()): TaskRun {
    assertTransition(run.status, "cancelled");

    return {
      ...run,
      status: "cancelled",
      updatedAt: finishedAt,
      checkpoint: {
        ...run.checkpoint,
        summary,
        pendingApprovalId: undefined,
        pendingClarificationId: undefined,
        pendingBrowserAction: undefined
      },
      outcome: {
        status: "cancelled",
        summary,
        finishedAt
      },
      suspension: undefined
    };
  }
}
