import type { BrowserAction } from "./browser.js";

export type TaskSource = "desktop" | "telegram" | "scheduler";
export type RunSuspensionType = "clarification" | "approval";

export type TaskStatus =
  | "queued"
  | "running"
  | "suspended_for_clarification"
  | "suspended_for_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type PlannerDecisionType =
  | "browser_action"
  | "clarification_request"
  | "approval_request"
  | "task_complete"
  | "task_failed";

export interface TaskIntent {
  id: string;
  source: TaskSource;
  goal: string;
  constraints: string[];
  preferredProfileId?: string;
  metadata: Record<string, string>;
  createdAt?: string;
}

export interface RunCheckpoint {
  summary: string;
  lastPageModelId?: string;
  browserSessionId?: string;
  lastKnownUrl?: string;
  pendingClarificationId?: string;
  pendingApprovalId?: string;
  pendingBrowserAction?: BrowserAction;
  notes: string[];
}

export interface RunSuspension {
  type: RunSuspensionType;
  requestId: string;
  question: string;
  createdAt: string;
}

export interface RunOutcome {
  status: Extract<TaskStatus, "completed" | "failed" | "cancelled">;
  summary: string;
  finishedAt: string;
}

export interface TaskRun {
  id: string;
  taskIntentId: string;
  status: TaskStatus;
  goal: string;
  source: TaskSource;
  constraints: string[];
  metadata: Record<string, string>;
  profileId?: string;
  createdAt: string;
  updatedAt: string;
  checkpoint: RunCheckpoint;
  suspension?: RunSuspension;
  outcome?: RunOutcome;
}

export interface ClarificationOption {
  id: string;
  label: string;
  summary: string;
}

export interface ClarificationRequest {
  id: string;
  runId: string;
  question: string;
  contextSummary: string;
  options: ClarificationOption[];
  createdAt: string;
}

export interface ClarificationResponse {
  requestId: string;
  runId: string;
  answer: string;
  respondedAt: string;
}

export interface ApprovalRequest {
  id: string;
  runId: string;
  question: string;
  irreversibleActionSummary: string;
  createdAt: string;
}

export interface PlannerDecision<TAction = unknown> {
  type: PlannerDecisionType;
  reasoning: string;
  action?: TAction;
  clarificationRequest?: ClarificationRequest;
  approvalRequest?: ApprovalRequest;
  completionSummary?: string;
  failureSummary?: string;
}
