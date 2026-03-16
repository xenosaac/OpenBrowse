import React from "react";
import type { TaskRun, WorkflowEvent } from "@openbrowse/contracts";

interface Props {
  run: TaskRun;
  recentActions: WorkflowEvent[];
}

export function RunContextCard({ run, recentActions }: Props) {
  const statusColor = run.status === "running" || run.status === "completed"
    ? "#22c55e"
    : run.status === "suspended_for_clarification" || run.status === "suspended_for_approval"
    ? "#f59e0b"
    : "#ef4444";
  const statusBg = run.status === "running" || run.status === "completed"
    ? "rgba(34,197,94,0.15)"
    : run.status === "suspended_for_clarification" || run.status === "suspended_for_approval"
    ? "rgba(245,158,11,0.15)"
    : "rgba(239,68,68,0.15)";

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <span style={{ ...styles.badge, background: statusBg, color: statusColor }}>
          {run.status.replace(/_/g, " ")}
        </span>
        {run.checkpoint.stepCount != null && run.checkpoint.stepCount > 0 && (
          <span style={styles.step}>Step {run.checkpoint.stepCount}</span>
        )}
      </div>
      <div style={styles.goal}>
        {run.goal.length > 120 ? run.goal.slice(0, 120) + "..." : run.goal}
      </div>
      {recentActions.length > 0 && (
        <div style={styles.actions}>
          {recentActions.slice(-5).map((evt) => (
            <div key={evt.id} style={styles.actionItem}>{evt.summary}</div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: "#171726", border: "1px solid #2a2a3e",
    borderRadius: 12, padding: "10px 12px", marginBottom: 4
  },
  header: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 },
  badge: {
    fontSize: "0.68rem", fontWeight: 600, borderRadius: 999,
    padding: "2px 8px", textTransform: "capitalize"
  },
  step: { fontSize: "0.68rem", color: "#6b6b82" },
  goal: { fontSize: "0.82rem", color: "#e5e7eb", lineHeight: 1.4, marginBottom: 6 },
  actions: { display: "flex", flexDirection: "column", gap: 3 },
  actionItem: {
    fontSize: "0.72rem", color: "#9090a8",
    paddingLeft: 8, borderLeft: "2px solid rgba(139,92,246,0.3)"
  }
};
