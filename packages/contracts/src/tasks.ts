export type TaskSource = "desktop" | "telegram" | "scheduler";

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
}

export interface RunCheckpoint {
  summary: string;
  lastPageModelId?: string;
  browserSessionId?: string;
  pendingClarificationId?: string;
  notes: string[];
}

export interface TaskRun {
  id: string;
  taskIntentId: string;
  status: TaskStatus;
  goal: string;
  source: TaskSource;
  profileId?: string;
  createdAt: string;
  updatedAt: string;
  checkpoint: RunCheckpoint;
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

