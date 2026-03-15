export type WorkflowEventType =
  | "run_created"
  | "page_modeled"
  | "planner_request_started"
  | "planner_decision"
  | "planner_request_failed"
  | "browser_action_executed"
  | "clarification_requested"
  | "clarification_answered"
  | "approval_requested"
  | "approval_answered"
  | "run_completed"
  | "run_failed"
  | "run_cancelled"
  | "run_recovered"
  | "recovery_failed"
  | "recovery_skipped"
  | "handoff_written";

export interface WorkflowEvent {
  id: string;
  runId: string;
  type: WorkflowEventType;
  summary: string;
  createdAt: string;
  payload: Record<string, string>;
}

export interface UserPreference {
  id: string;
  namespace: string;
  key: string;
  value: string;
  capturedAt: string;
}
