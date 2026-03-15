import type { BrowserAction, PageModel } from "./browser.js";

export type TaskSource = "desktop" | "telegram" | "scheduler";
export type RunSuspensionType = "clarification" | "approval";

/** Named risk class — describes *why* an action is risky (shown in approval UI). */
export type RiskClass = "financial" | "credential" | "destructive" | "submission" | "navigation" | "general";

/** Per-class approval policy — controls whether to ask, auto-approve, or use default risk-level logic. */
export type RiskClassPolicy = "always_ask" | "auto_approve" | "default";

/** Map of risk class → approval policy. Missing keys default to "default". */
export type RiskClassPolicies = Partial<Record<RiskClass, RiskClassPolicy>>;

/** A compact record of a single browser action taken during a run. Stored in RunCheckpoint.actionHistory. */
export interface RunActionRecord {
  step: number;
  type: string;
  description: string;
  ok: boolean;
  failureClass?: string;
  url?: string;
  createdAt: string;
}

/** Structured handoff artifact for a run — consumable by humans and agents alike. */
export interface RunHandoffArtifact {
  runId: string;
  goal: string;
  constraints: string[];
  source: TaskSource;
  status: TaskStatus;
  startedAt: string;
  updatedAt: string;
  stepCount: number;
  currentUrl?: string;
  currentPageTitle?: string;
  currentPageSummary?: string;
  actionHistory: RunActionRecord[];
  stopReason?: string;
  nextSuggestedStep?: string;
  lastFailureClass?: string;
  consecutiveSoftFailures: number;
  suspensionType?: RunSuspensionType;
  suspensionQuestion?: string;
  notes: string[];
  outcome?: string;
  pageModelSnapshot?: PageModel;
  screenshotBase64?: string;
}

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
  /** Page title from the last captured page model. */
  lastPageTitle?: string;
  /** Page summary from the last captured page model. */
  lastPageSummary?: string;
  pendingClarificationId?: string;
  pendingApprovalId?: string;
  pendingBrowserAction?: BrowserAction;
  notes: string[];
  /** Number of planner steps taken so far. */
  stepCount?: number;
  /** Last N browser actions taken (most recent last). Max 10. */
  actionHistory?: RunActionRecord[];
  /** Human-readable reason why the run stopped, paused, or failed. */
  stopReason?: string;
  /** Description of the last planned next action. */
  nextSuggestedStep?: string;
  /** Failure class from the most recent failed browser action. */
  lastFailureClass?: string;
  /** Number of consecutive element_not_found soft failures. */
  consecutiveSoftFailures?: number;
  /** Lightweight snapshot of the last captured page model for recovery context. */
  lastPageModelSnapshot?: {
    title: string;
    summary: string;
    visibleText?: string;
    formValues?: Record<string, string>;
    scrollY?: number;
  };
  /** Injected when a run resumes after crash/restart. Cleared after the first planner step post-recovery. */
  recoveryContext?: {
    recoveredAt: string;
    preInterruptionPageTitle?: string;
    preInterruptionPageSummary?: string;
    preInterruptionVisibleText?: string;
    preInterruptionScrollY?: number;
    preInterruptionFormValues?: Record<string, string>;
  };
}

export interface RunSuspension {
  type: RunSuspensionType;
  requestId: string;
  question: string;
  riskClass?: RiskClass;
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
  riskClass?: RiskClass;
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
