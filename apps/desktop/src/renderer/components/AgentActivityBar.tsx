import type { TaskRun, WorkflowEvent } from "@openbrowse/contracts";

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
        onClick={() => onCancel(run.id)}
      >
        Stop
      </button>
    </div>
  );
}

const barStyles: Record<string, React.CSSProperties> = {
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 32,
    padding: "0 12px",
    background: "#12121a",
    borderBottom: "1px solid #2a2a3e",
    flexShrink: 0,
    fontSize: "0.78rem",
    color: "#9090a8"
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#22c55e",
    flexShrink: 0,
    animation: "ob-pulse 1.5s ease-in-out infinite"
  },
  label: {
    color: "#22c55e",
    fontWeight: 600,
    flexShrink: 0
  },
  action: {
    color: "#cbd5e1",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0
  },
  step: {
    color: "#6b6b82",
    flexShrink: 0
  },
  spacer: {
    flex: 1
  },
  stopButton: {
    background: "rgba(239,68,68,0.12)",
    border: "1px solid rgba(239,68,68,0.3)",
    borderRadius: 6,
    color: "#f87171",
    cursor: "pointer",
    fontSize: "0.72rem",
    fontWeight: 600,
    padding: "3px 10px",
    flexShrink: 0
  }
};
