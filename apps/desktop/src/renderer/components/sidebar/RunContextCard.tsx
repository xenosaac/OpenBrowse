import React from "react";
import type { TaskRun, WorkflowEvent } from "@openbrowse/contracts";
import { colors, glass, shadows } from "../../styles/tokens";

interface Props {
  run: TaskRun;
  recentActions: WorkflowEvent[];
}

export function RunContextCard({ run, recentActions }: Props) {
  const statusColor = run.status === "running" || run.status === "completed"
    ? colors.statusRunning
    : run.status === "suspended_for_clarification" || run.status === "suspended_for_approval"
    ? colors.statusWaiting
    : colors.statusFailed;
  const statusBg = run.status === "running" || run.status === "completed"
    ? colors.statusRunningTint
    : run.status === "suspended_for_clarification" || run.status === "suspended_for_approval"
    ? colors.statusWaitingTint
    : colors.statusFailedTint;

  const isRunning = run.status === "running";

  return (
    <div style={{
      ...styles.card,
      ...(isRunning ? {
        ...glass.emerald,
        backdropFilter: "blur(16px) saturate(180%)",
        WebkitBackdropFilter: "blur(16px) saturate(180%)",
        borderRadius: 12,
        padding: "10px 12px",
        marginBottom: 4,
        boxShadow: shadows.glassSubtle
      } as React.CSSProperties : {})
    }}>
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
    ...glass.card,
    border: "1px solid " + colors.borderSubtle,
    borderRadius: 12, padding: "10px 12px", marginBottom: 4
  } as React.CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 },
  badge: {
    fontSize: "0.68rem", fontWeight: 600, borderRadius: 999,
    padding: "2px 8px", textTransform: "capitalize"
  },
  step: { fontSize: "0.68rem", color: colors.textMuted },
  goal: { fontSize: "0.82rem", color: colors.textPrimary, lineHeight: 1.4, marginBottom: 6 },
  actions: { display: "flex", flexDirection: "column", gap: 3 },
  actionItem: {
    fontSize: "0.72rem", color: colors.textSecondary,
    paddingLeft: 8, borderLeft: "2px solid rgba(16,185,129,0.3)"
  }
};
