import { useEffect, useState } from "react";
import type { TaskRun } from "@openbrowse/contracts";
import { colors, glass } from "../styles/tokens";
import { computeRunAnalytics, type RunAnalytics } from "../lib/runAnalytics";

const statusColors: Record<string, string> = {
  completed: colors.emerald,
  failed: colors.statusFailed,
  cancelled: colors.textMuted,
  running: colors.statusRunning,
};

const statusLabels: Record<string, string> = {
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  running: "Running",
  suspended_for_clarification: "Waiting",
  suspended_for_approval: "Approval",
  queued: "Queued",
};

export function AnalyticsPanel() {
  const [analytics, setAnalytics] = useState<RunAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    window.openbrowse.listRecentRuns(200).then((runs: TaskRun[]) => {
      if (!cancelled) {
        setAnalytics(computeRunAnalytics(runs));
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <p style={{ color: colors.textSecondary }}>Loading analytics...</p>;
  }

  if (!analytics || analytics.totalRuns === 0) {
    return <p style={{ color: colors.textSecondary }}>No task runs yet. Start a task to see analytics.</p>;
  }

  const a = analytics;

  return (
    <div style={styles.container}>
      {/* Summary cards */}
      <div style={styles.cardGrid}>
        <StatCard label="Total Runs" value={String(a.totalRuns)} />
        <StatCard label="Completion Rate" value={`${a.completionRate}%`} color={colors.emerald} />
        <StatCard label="Failure Rate" value={`${a.failureRate}%`} color={a.failureRate > 50 ? colors.statusFailed : colors.textPrimary} />
        <StatCard label="Avg Steps (Completed)" value={a.avgStepsCompleted > 0 ? String(a.avgStepsCompleted) : "—"} />
      </div>

      {/* Status breakdown */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Status Breakdown</h3>
        <div style={styles.breakdownGrid}>
          <BreakdownRow label="Completed" count={a.completed} total={a.totalRuns} color={colors.emerald} />
          <BreakdownRow label="Failed" count={a.failed} total={a.totalRuns} color={colors.statusFailed} />
          <BreakdownRow label="Cancelled" count={a.cancelled} total={a.totalRuns} color={colors.textMuted} />
          {a.running > 0 && (
            <BreakdownRow label="In Progress" count={a.running} total={a.totalRuns} color={colors.statusRunning} />
          )}
        </div>
      </div>

      {/* Recent runs */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Last 10 Runs</h3>
        <div style={styles.recentList}>
          {a.recentRuns.map((run) => (
            <div key={run.id} style={styles.recentRow}>
              <span style={{
                ...styles.recentDot,
                background: statusColors[run.status] ?? colors.textMuted,
              }} />
              <span style={styles.recentStatus}>
                {statusLabels[run.status] ?? run.status}
              </span>
              <span style={styles.recentGoal}>{run.goal}</span>
              <span style={styles.recentMeta}>
                {run.stepCount > 0 ? `${run.stepCount} steps` : "—"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statLabel}>{label}</div>
      <div style={{ ...styles.statValue, ...(color ? { color } : {}) }}>{value}</div>
    </div>
  );
}

function BreakdownRow({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div style={styles.breakdownRow}>
      <span style={styles.breakdownLabel}>{label}</span>
      <div style={styles.barContainer}>
        <div style={{ ...styles.bar, width: `${pct}%`, background: color }} />
      </div>
      <span style={styles.breakdownCount}>{count}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
  },
  cardGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: 10,
  },
  statCard: {
    ...glass.card,
    borderRadius: 12,
    padding: "14px 16px",
    border: `1px solid ${colors.borderSubtle}`,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } as React.CSSProperties,
  statLabel: {
    fontSize: "0.74rem",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: colors.textSecondary,
  },
  statValue: {
    fontSize: "1.4rem",
    fontWeight: 700,
    color: colors.textPrimary,
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  sectionTitle: {
    fontSize: "0.82rem",
    fontWeight: 600,
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    margin: 0,
  },
  breakdownGrid: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  breakdownRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  breakdownLabel: {
    fontSize: "0.82rem",
    color: colors.textPrimary,
    width: 80,
    flexShrink: 0,
  },
  barContainer: {
    flex: 1,
    height: 6,
    background: colors.borderSubtle,
    borderRadius: 3,
    overflow: "hidden",
  },
  bar: {
    height: "100%",
    borderRadius: 3,
    transition: "width 0.3s ease",
  },
  breakdownCount: {
    fontSize: "0.82rem",
    color: colors.textSecondary,
    width: 30,
    textAlign: "right",
    flexShrink: 0,
  },
  recentList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  recentRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 8,
    background: colors.borderSubtle,
  },
  recentDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    flexShrink: 0,
  },
  recentStatus: {
    fontSize: "0.74rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    width: 70,
    flexShrink: 0,
    color: colors.textSecondary,
  },
  recentGoal: {
    fontSize: "0.82rem",
    color: colors.textPrimary,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  },
  recentMeta: {
    fontSize: "0.74rem",
    color: colors.textMuted,
    flexShrink: 0,
  },
};
