import type {
  BrowserAction,
  BrowserActionResult,
  ClarificationResponse,
  PageModel,
  PlannerDecision,
  RunActionRecord,
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
        notes: [],
        stepCount: 0,
        actionHistory: [],
        consecutiveSoftFailures: 0
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
    // Extract form field values from input elements for recovery snapshots
    const formValues: Record<string, string> = {};
    let formCount = 0;
    for (const el of pageModel.elements) {
      if (el.value && formCount < 20 && (el.inputType || el.role === "textbox" || el.role === "combobox")) {
        formValues[el.id] = el.value;
        formCount++;
      }
    }

    return {
      ...run,
      updatedAt: new Date().toISOString(),
      checkpoint: {
        ...run.checkpoint,
        browserSessionId: browserSessionId ?? run.checkpoint.browserSessionId,
        lastPageModelId: pageModel.id,
        lastKnownUrl: pageModel.url,
        lastPageTitle: pageModel.title || undefined,
        lastPageSummary: pageModel.summary || undefined,
        stepCount: (run.checkpoint.stepCount ?? 0) + 1,
        lastPageModelSnapshot: {
          title: pageModel.title,
          summary: pageModel.summary,
          visibleText: pageModel.visibleText?.slice(0, 500),
          formValues: Object.keys(formValues).length > 0 ? formValues : undefined,
          scrollY: pageModel.scrollY,
        },
      }
    };
  }

  applyPlannerDecision(run: TaskRun, decision: PlannerDecision<BrowserAction>): TaskRun {
    const updatedAt = new Date().toISOString();

    if (this.deps.clarificationPolicy.shouldSuspend(run, decision)) {
      assertTransition(run.status, "suspended_for_clarification");
      const question = decision.clarificationRequest?.question ?? "Clarification needed.";

      return {
        ...run,
        status: "suspended_for_clarification",
        updatedAt,
        checkpoint: {
          ...run.checkpoint,
          summary: decision.reasoning,
          pendingClarificationId: decision.clarificationRequest?.id,
          pendingApprovalId: undefined,
          pendingBrowserAction: undefined,
          stopReason: `Waiting for clarification: ${question}`,
          nextSuggestedStep: undefined
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
      const actionDesc = decision.action?.description ?? decision.approvalRequest.irreversibleActionSummary;

      return {
        ...run,
        status: "suspended_for_approval",
        updatedAt,
        checkpoint: {
          ...run.checkpoint,
          summary: decision.reasoning,
          pendingApprovalId: decision.approvalRequest.id,
          pendingClarificationId: undefined,
          pendingBrowserAction: decision.action,
          stopReason: `Waiting for approval: ${actionDesc}`,
          nextSuggestedStep: `Approve or deny: "${actionDesc}"`
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
      const completionSummary = decision.completionSummary ?? decision.reasoning;

      return {
        ...run,
        status: "completed",
        updatedAt,
        checkpoint: {
          ...run.checkpoint,
          summary: completionSummary,
          pendingApprovalId: undefined,
          pendingClarificationId: undefined,
          pendingBrowserAction: undefined,
          stopReason: `Completed: ${completionSummary}`,
          nextSuggestedStep: undefined
        },
        outcome: {
          status: "completed",
          summary: completionSummary,
          finishedAt: updatedAt
        },
        suspension: undefined
      };
    }

    if (decision.type === "task_failed") {
      assertTransition(run.status, "failed");
      const failureSummary = decision.failureSummary ?? decision.reasoning;

      return {
        ...run,
        status: "failed",
        updatedAt,
        checkpoint: {
          ...run.checkpoint,
          summary: failureSummary,
          pendingApprovalId: undefined,
          pendingClarificationId: undefined,
          pendingBrowserAction: undefined,
          stopReason: `Failed: ${failureSummary}`,
          nextSuggestedStep: undefined
        },
        outcome: {
          status: "failed",
          summary: failureSummary,
          finishedAt: updatedAt
        },
        suspension: undefined
      };
    }

    if (run.status === "queued") {
      assertTransition(run.status, "running");
    }

    // browser_action or other continuation — record next planned step
    const nextStep = decision.action?.description ?? decision.reasoning;

    return {
      ...run,
      status: run.status === "queued" ? "running" : run.status,
      updatedAt,
      checkpoint: {
        ...run.checkpoint,
        summary: decision.reasoning,
        pendingApprovalId: undefined,
        nextSuggestedStep: nextStep
      },
      suspension: undefined
    };
  }

  recordBrowserResult(run: TaskRun, result: BrowserActionResult): TaskRun {
    if (run.status !== "running") {
      assertTransition(run.status, "running");
    }

    const record: RunActionRecord = {
      step: run.checkpoint.stepCount ?? 0,
      type: result.action.type,
      description: result.action.description,
      ok: result.ok,
      failureClass: result.failureClass,
      url: run.checkpoint.lastKnownUrl,
      createdAt: new Date().toISOString()
    };

    const existingHistory = run.checkpoint.actionHistory ?? [];
    const actionHistory = [...existingHistory, record].slice(-10);

    const isSoftFailure = !result.ok && result.failureClass === "element_not_found";
    const consecutiveSoftFailures = isSoftFailure
      ? (run.checkpoint.consecutiveSoftFailures ?? 0) + 1
      : 0;

    return {
      ...run,
      status: "running",
      updatedAt: new Date().toISOString(),
      checkpoint: {
        ...run.checkpoint,
        summary: result.summary,
        lastPageModelId: result.pageModelId,
        pendingBrowserAction: undefined,
        actionHistory,
        lastFailureClass: result.failureClass ?? (result.ok ? undefined : run.checkpoint.lastFailureClass),
        consecutiveSoftFailures
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
        pendingBrowserAction: undefined,
        stopReason: `Failed: ${summary}`,
        nextSuggestedStep: undefined
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
        pendingBrowserAction: undefined,
        stopReason: `Cancelled: ${summary}`,
        nextSuggestedStep: undefined
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
