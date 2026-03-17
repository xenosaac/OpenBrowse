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
  screenshot_captured: "Screenshot",
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
  screenshot_captured: "#8b5cf6",
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
  let enrichedSummary = summary;

  if (type === "planner_decision" && payload.inputTokens && payload.outputTokens) {
    enrichedSummary += ` (${payload.inputTokens} in / ${payload.outputTokens} out)`;
  }

  if (type === "screenshot_captured" && payload.base64Bytes) {
    const tokens = estimateImageTokens(Number(payload.base64Bytes));
    if (tokens > 0) {
      enrichedSummary += ` (~${tokens} tokens)`;
    }
  }

  return {
    label: EVENT_LABELS[type] ?? type.replace(/_/g, " "),
    summary: enrichedSummary,
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

/**
 * Minimal vision token estimator (same formula as @openbrowse/planner estimateImageTokens).
 * Inlined to avoid pulling the planner package into the renderer bundle.
 */
function estimateImageTokens(base64Length: number): number {
  if (base64Length <= 0) return 0;
  const fileBytes = Math.floor((base64Length * 3) / 4);
  // JPEG quality 60 ~0.4 bytes/pixel
  const estimatedPixels = fileBytes / 0.4;
  // Assume 3:2 aspect ratio
  const height = Math.round(Math.sqrt(estimatedPixels / 1.5));
  const width = Math.round(height * 1.5);
  if (width <= 0 || height <= 0) return 0;
  const maxLongEdge = 1568;
  const scale = Math.min(1, maxLongEdge / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const tilesX = Math.ceil(w / 768);
  const tilesY = Math.ceil(h / 768);
  return 85 + tilesX * tilesY * 170;
}
