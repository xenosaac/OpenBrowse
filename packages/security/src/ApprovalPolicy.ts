import type { ApprovalRequest, BrowserAction, TaskRun } from "@openbrowse/contracts";

export interface ApprovalPolicy {
  requiresApproval(run: TaskRun, action: BrowserAction): boolean;
  buildApprovalRequest(run: TaskRun, action: BrowserAction): ApprovalRequest;
}

export class DefaultApprovalPolicy implements ApprovalPolicy {
  requiresApproval(_run: TaskRun, action: BrowserAction): boolean {
    return action.type === "click" && action.description.toLowerCase().includes("submit");
  }

  buildApprovalRequest(run: TaskRun, action: BrowserAction): ApprovalRequest {
    return {
      id: `approval_${run.id}`,
      runId: run.id,
      question: "Should the agent continue with this irreversible action?",
      irreversibleActionSummary: action.description,
      createdAt: new Date().toISOString()
    };
  }
}

