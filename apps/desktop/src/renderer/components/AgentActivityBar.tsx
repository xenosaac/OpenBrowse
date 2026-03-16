import type { TaskRun, WorkflowEvent } from "@openbrowse/contracts";
import { colors, glass, shadows } from "../styles/tokens";

interface AgentActivityBarProps {
  run: TaskRun | null;
  recentAction: WorkflowEvent | null;
  onCancel: (runId: string) => void;
}

export function AgentActivityBar({ run, recentAction, onCancel }: AgentActivityBarProps) {
  if (!run || run.status !== "running") return null;

  return (
    <div style={barStyles.bar}>
      <span style={barStyles.dot} />
      <span style={barStyles.label}>Agent active</span>
      {recentAction && (
        <span style={barStyles.action}>{recentAction.summary}</span>
      )}
      {run.checkpoint.stepCount != null && run.checkpoint.stepCount > 0 && (
        <span style={barStyles.step}>Step {run.checkpoint.stepCount}</span>
      )}
      <div style={barStyles.spacer} />
      <button
        style={barStyles.stopButton}
        className="ob-btn"
        onClick={() => onCancel(run.id)}
      >
        Stop
      </button>
    </div>
  );
}

const barStyles: Record<string, React.CSSProperties> = {
  bar: {
    ...glass.panel,
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 32,
    padding: "0 12px",
    border: "1px solid " + colors.borderGlass,
    boxShadow: shadows.glassSubtle,
    flexShrink: 0,
    fontSize: "0.78rem",
    color: colors.textSecondary
  } as React.CSSProperties,
  dot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: colors.statusRunning,
    flexShrink: 0,
    animation: "ob-pulse 1.5s ease-in-out infinite"
  },
  label: {
    color: colors.statusRunning,
    fontWeight: 600,
    flexShrink: 0
  },
  action: {
    color: colors.textPrimary,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0
  },
  step: {
    color: colors.textMuted,
    flexShrink: 0
  },
  spacer: {
    flex: 1
  },
  stopButton: {
    background: colors.statusFailedTint,
    border: "1px solid " + colors.statusFailedBorder,
    borderRadius: 6,
    color: colors.statusFailed,
    cursor: "pointer",
    fontSize: "0.72rem",
    fontWeight: 600,
    padding: "3px 10px",
    flexShrink: 0
  }
};
