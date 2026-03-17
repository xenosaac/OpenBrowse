/**
 * Pure formatting helpers for run step timeline display.
 * Extracted for testability (no React/DOM dependencies).
 */

export interface TimelineEntry {
  label: string;
  summary: string;
  color: string;
  time: string;
  url?: string;
  isTerminal: boolean;
}

const EVENT_LABELS: Record<string, string> = {
  run_created: "Run started",
  page_modeled: "Page captured",
  planner_request_started: "Planning",
  planner_decision: "Decision",
  planner_request_failed: "Planner error",
  browser_action_executed: "Action",
  clarification_requested: "Asked user",
  clarification_answered: "User replied",
  approval_requested: "Approval needed",
  approval_answered: "Approval given",
  run_completed: "Completed",
  run_failed: "Failed",
  run_cancelled: "Cancelled",
  run_recovered: "Recovered",
  recovery_failed: "Recovery failed",
  recovery_skipped: "Recovery skipped",
  handoff_written: "Handoff written",
};

const EVENT_COLORS: Record<string, string> = {
  run_created: "#10b981",
  page_modeled: "#3b82f6",
  planner_request_started: "#0f766e",
  planner_decision: "#3b82f6",
  planner_request_failed: "#dc2626",
  browser_action_executed: "#10b981",
  clarification_requested: "#eab308",
  clarification_answered: "#3b82f6",
  approval_requested: "#f97316",
  approval_answered: "#3b82f6",
  run_completed: "#10b981",
  run_failed: "#ef4444",
  run_cancelled: "#6b7280",
  run_recovered: "#10b981",
  recovery_failed: "#ef4444",
  recovery_skipped: "#6b7280",
  handoff_written: "#6b7280",
};

const TERMINAL_TYPES = new Set([
  "run_completed",
  "run_failed",
  "run_cancelled",
]);

export function formatTimelineEvent(
  type: string,
  summary: string,
  createdAt: string,
  payload: Record<string, string>,
): TimelineEntry {
  return {
    label: EVENT_LABELS[type] ?? type.replace(/_/g, " "),
    summary,
    color: EVENT_COLORS[type] ?? "#6b7280",
    time: formatTime(createdAt),
    url: payload.url || payload.targetUrl || undefined,
    isTerminal: TERMINAL_TYPES.has(type),
  };
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}
