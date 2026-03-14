import type { TaskRun, WorkflowEvent } from "@openbrowse/contracts";
import type { ReplayStep } from "@openbrowse/observability";

interface Props {
  logs: WorkflowEvent[];
  replaySteps: ReplayStep[];
  selectedRunId: string | null;
  runs: TaskRun[];
  onSelectRun: (runId: string) => void;
}

const eventColors: Record<string, string> = {
  run_created: "#6366f1",
  page_modeled: "#22c55e",
  planner_request_started: "#0f766e",
  planner_decision: "#3b82f6",
  planner_request_failed: "#dc2626",
  browser_action_executed: "#8b5cf6",
  clarification_requested: "#eab308",
  clarification_answered: "#22c55e",
  approval_requested: "#f97316",
  approval_answered: "#22c55e",
  run_completed: "#6366f1",
  run_failed: "#ef4444",
  run_cancelled: "#6b7280"
};

export function WorkflowLog({ logs, replaySteps, selectedRunId, runs, onSelectRun }: Props) {
  return (
    <div>
      <div style={styles.selector}>
        <label style={{ color: "#888", fontSize: "0.85rem" }}>Run: </label>
        <select
          value={selectedRunId ?? ""}
          onChange={(e) => onSelectRun(e.target.value)}
          style={styles.select}
        >
          <option value="">Select a run...</option>
          {runs.map((r) => (
            <option key={r.id} value={r.id}>
              {r.id} - {r.goal.slice(0, 40)}
            </option>
          ))}
        </select>
      </div>

      {logs.length === 0 && (
        <p style={{ color: "#7c735f" }}>
          {selectedRunId ? "No events for this run." : "Select a run to view its log."}
        </p>
      )}

      <div style={styles.grid}>
        <div>
          <h3 style={styles.sectionTitle}>Replay</h3>
          {replaySteps.length === 0 ? (
            <p style={styles.emptyText}>
              {selectedRunId ? "Replay data will appear after the run emits workflow events." : "Select a run to inspect replay steps."}
            </p>
          ) : (
            <div style={styles.replayPanel}>
              {replaySteps.map((step) => (
                <div key={step.event.id} style={styles.replayStep}>
                  <div style={styles.replayElapsed}>+{(step.elapsed / 1000).toFixed(1)}s</div>
                  <div>
                    <div style={styles.eventType}>{step.event.type.replace(/_/g, " ")}</div>
                    <div style={styles.eventSummary}>{step.event.summary}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h3 style={styles.sectionTitle}>Raw Event Timeline</h3>
          <div style={styles.timeline}>
            {logs.map((event) => (
              <div key={event.id} style={styles.event}>
                <span
                  style={{
                    ...styles.dot,
                    background: eventColors[event.type] ?? "#6b7280"
                  }}
                />
                <div>
                  <div style={styles.eventType}>{event.type.replace(/_/g, " ")}</div>
                  <div style={styles.eventSummary}>{event.summary}</div>
                  <div style={styles.eventTime}>
                    {new Date(event.createdAt).toLocaleTimeString()}
                  </div>
                  {Object.keys(event.payload).length > 0 && (
                    <div style={styles.payloadList}>
                      {Object.entries(event.payload).map(([key, value]) => (
                        <span key={`${event.id}_${key}`} style={styles.payloadItem}>
                          {key}: {value}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  selector: {
    marginBottom: 12,
    display: "flex",
    alignItems: "center",
    gap: 8
  },
  select: {
    background: "#fbf6ed",
    color: "#2f2821",
    border: "1px solid #d9c7ac",
    borderRadius: 4,
    padding: "4px 8px",
    fontSize: "0.85rem"
  },
  timeline: {
    borderLeft: "2px solid #d9c7ac",
    paddingLeft: 16,
    marginLeft: 4
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "minmax(260px, 360px) minmax(0, 1fr)",
    gap: 20,
    alignItems: "start"
  },
  sectionTitle: {
    margin: "0 0 10px",
    fontSize: "0.95rem",
    color: "#5f5548"
  },
  emptyText: {
    color: "#7c735f",
    fontSize: "0.9rem"
  },
  replayPanel: {
    background: "#fffaf2",
    border: "1px solid #d9c7ac",
    borderRadius: 8,
    padding: 12
  },
  replayStep: {
    display: "grid",
    gridTemplateColumns: "72px minmax(0, 1fr)",
    gap: 10,
    alignItems: "start",
    padding: "8px 0",
    borderBottom: "1px solid #ecdfcb"
  },
  replayElapsed: {
    color: "#7c735f",
    fontSize: "0.8rem",
    fontVariantNumeric: "tabular-nums"
  },
  event: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 12,
    position: "relative" as const
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    marginTop: 4,
    flexShrink: 0
  },
  eventType: {
    fontSize: "0.8rem",
    color: "#7c735f",
    textTransform: "uppercase" as const
  },
  eventSummary: {
    fontSize: "0.9rem",
    color: "#3f372d"
  },
  eventTime: {
    fontSize: "0.75rem",
    color: "#7c735f"
  },
  payloadList: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6
  },
  payloadItem: {
    background: "#f5ead8",
    color: "#6a5b48",
    borderRadius: 999,
    padding: "2px 8px",
    fontSize: "0.72rem"
  }
};
