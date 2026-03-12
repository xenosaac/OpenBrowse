export type WorkflowEventType =
  | "run_created"
  | "page_modeled"
  | "planner_decision"
  | "browser_action_executed"
  | "clarification_requested"
  | "clarification_answered"
  | "approval_requested"
  | "run_completed"
  | "run_failed";

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

