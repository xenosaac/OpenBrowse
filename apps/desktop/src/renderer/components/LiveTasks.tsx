import type { TaskRun } from "@openbrowse/contracts";

interface Props {
  runs: TaskRun[];
  onSelectRun: (runId: string) => void;
}

const statusColors: Record<string, string> = {
  running: "#22c55e",
  suspended_for_clarification: "#eab308",
  suspended_for_approval: "#f97316",
  completed: "#6366f1",
  failed: "#ef4444",
  cancelled: "#6b7280",
  queued: "#94a3b8"
};

export function LiveTasks({ runs, onSelectRun }: Props) {
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
        >
          <div style={styles.row}>
            <span
              style={{
                ...styles.status,
                background: statusColors[run.status] ?? "#6b7280"
              }}
            />
            <strong>{run.goal}</strong>
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
    background: "#151522",
    borderRadius: 14,
    padding: "12px 14px",
    marginBottom: 8,
    cursor: "pointer",
    border: "1px solid #2a2a3e"
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8
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
