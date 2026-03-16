import type { TaskRun } from "@openbrowse/contracts";
import { colors, glass, shadows } from "../styles/tokens";

interface Props {
  runs: TaskRun[];
  onSelectRun: (runId: string) => void;
  onCancelRun?: (runId: string) => void;
}

const statusColors: Record<string, string> = {
  running: colors.statusRunning,
  suspended_for_clarification: "#eab308",
  suspended_for_approval: "#f97316",
  completed: colors.emerald,
  failed: colors.statusFailed,
  cancelled: "#6b7280",
  queued: "#94a3b8"
};

const NON_TERMINAL = new Set(["running", "queued", "suspended_for_clarification", "suspended_for_approval"]);

export function LiveTasks({ runs, onSelectRun, onCancelRun }: Props) {
  if (runs.length === 0) {
    return <p style={{ color: "#9090a8" }}>No active runs. Start a task to begin.</p>;
  }

  return (
    <div>
      {runs.map((run) => (
        <div
          key={run.id}
          onClick={() => onSelectRun(run.id)}
          style={styles.card}
          className="ob-card"
        >
          <div style={styles.row}>
            <div style={styles.goalGroup}>
              <span
                style={{
                  ...styles.status,
                  background: statusColors[run.status] ?? "#6b7280"
                }}
              />
              <strong>{run.goal}</strong>
            </div>
            {onCancelRun && NON_TERMINAL.has(run.status) && (
              <button
                style={styles.cancelBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  onCancelRun(run.id);
                }}
              >
                Cancel
              </button>
            )}
          </div>
          <div style={styles.meta}>
            <span>{run.status.replace(/_/g, " ")}</span>
            <span>{run.id}</span>
            <span>{new Date(run.updatedAt).toLocaleTimeString()}</span>
          </div>
          {run.checkpoint.summary && (
            <p style={styles.summary}>{run.checkpoint.summary}</p>
          )}
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    ...glass.card,
    borderRadius: 14,
    padding: "12px 14px",
    marginBottom: 8,
    cursor: "pointer",
    border: "1px solid " + colors.borderGlass
  } as React.CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8
  },
  goalGroup: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0
  },
  cancelBtn: {
    background: "rgba(239,68,68,0.12)",
    border: "1px solid rgba(239,68,68,0.3)",
    color: "#f87171",
    borderRadius: 6,
    fontSize: "0.72rem",
    fontWeight: 600,
    padding: "3px 10px",
    cursor: "pointer",
    flexShrink: 0
  },
  status: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    display: "inline-block"
  },
  meta: {
    display: "flex",
    gap: 16,
    fontSize: "0.8rem",
    color: "#8f90a6",
    marginTop: 4
  },
  summary: {
    fontSize: "0.85rem",
    color: "#d7d7e4",
    marginTop: 6,
    marginBottom: 0
  }
};
