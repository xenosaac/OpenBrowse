import type { TaskRun, WorkflowEvent } from "@openbrowse/contracts";
import type { ReplayStep } from "@openbrowse/observability";
import { colors, glass, shadows } from "../styles/tokens";

interface Props {
  logs: WorkflowEvent[];
  replaySteps: ReplayStep[];
  selectedRunId: string | null;
  runs: TaskRun[];
  onSelectRun: (runId: string) => void;
}

const eventColors: Record<string, string> = {
  run_created: colors.emerald,
  page_modeled: colors.statusRunning,
  planner_request_started: "#0f766e",
  planner_decision: "#3b82f6",
  planner_request_failed: "#dc2626",
  browser_action_executed: colors.emerald,
  clarification_requested: "#eab308",
  clarification_answered: colors.statusRunning,
  approval_requested: "#f97316",
  approval_answered: colors.statusRunning,
  run_completed: colors.emerald,
  run_failed: "#ef4444",
  run_cancelled: "#6b7280"
};

export function WorkflowLog({ logs, replaySteps, selectedRunId, runs, onSelectRun }: Props) {
  return (
    <div style={styles.root}>
      <div style={styles.selector}>
        <label style={{ color: "#9090a8", fontSize: "0.85rem" }}>Run: </label>
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
        <p style={{ color: "#9090a8" }}>
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
                <div style={styles.eventContent}>
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
  // minWidth: 0 lets this element properly participate in a parent grid/flex context
  // so it can shrink below its content size and never forces container overflow.
  root: {
    minWidth: 0
  },
  selector: {
    marginBottom: 12,
    display: "flex",
    alignItems: "center",
    gap: 8
  },
  select: {
    ...glass.input,
    color: "#f5f5ff",
    border: "1px solid " + colors.borderGlass,
    borderRadius: 8,
    padding: "4px 8px",
    fontSize: "0.85rem"
  } as React.CSSProperties,
  timeline: {
    borderLeft: "2px solid " + colors.borderDefault,
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
    color: "#e5e7eb"
  },
  emptyText: {
    color: "#9090a8",
    fontSize: "0.9rem"
  },
  replayPanel: {
    ...glass.card,
    border: "1px solid " + colors.borderSubtle,
    borderRadius: 10,
    padding: 12
  } as React.CSSProperties,
  replayStep: {
    display: "grid",
    gridTemplateColumns: "72px minmax(0, 1fr)",
    gap: 10,
    alignItems: "start",
    padding: "8px 0",
    borderBottom: "1px solid " + colors.borderSubtle
  },
  replayElapsed: {
    color: "#9090a8",
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
  // flex: 1 + minWidth: 0 prevents the text content from expanding the flex row
  // past its container.  Without minWidth: 0, flex children default to
  // min-width: auto (their content width) and unbreakable strings overflow.
  eventContent: {
    flex: 1,
    minWidth: 0
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
    color: "#9090a8",
    textTransform: "uppercase" as const
  },
  eventSummary: {
    fontSize: "0.9rem",
    color: "#e5e7eb",
    overflowWrap: "break-word"
  },
  eventTime: {
    fontSize: "0.75rem",
    color: "#6b6b82"
  },
  payloadList: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6
  },
  payloadItem: {
    background: colors.emeraldTint,
    color: colors.emeraldHover,
    border: "1px solid " + colors.emeraldBorder,
    borderRadius: 999,
    padding: "2px 8px",
    fontSize: "0.72rem",
    overflowWrap: "break-word",
    maxWidth: "100%"
  }
};
