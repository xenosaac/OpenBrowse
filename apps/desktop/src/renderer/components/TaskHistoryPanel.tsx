import { useEffect, useState } from "react";
import type { TaskRun, TaskStatus } from "@openbrowse/contracts";
import { colors, glass } from "../styles/tokens";

const STATUS_FILTERS: Array<{ key: TaskStatus | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "completed", label: "Completed" },
  { key: "failed", label: "Failed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "running", label: "Running" },
];

const statusColors: Record<string, string> = {
  running: colors.statusRunning,
  suspended_for_clarification: colors.statusWaiting,
  suspended_for_approval: colors.statusWaiting,
  completed: colors.emerald,
  failed: colors.statusFailed,
  cancelled: colors.textMuted,
  queued: colors.textSecondary,
};

const statusLabels: Record<string, string> = {
  running: "Running",
  suspended_for_clarification: "Waiting",
  suspended_for_approval: "Approval",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  queued: "Queued",
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (isToday) return `Today ${time}`;
  if (isYesterday) return `Yesterday ${time}`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ` ${time}`;
}

export function TaskHistoryPanel() {
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TaskStatus | "all">("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    window.openbrowse.listRecentRuns(50).then((result) => {
      if (!cancelled) {
        setRuns(result);
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const filtered = runs.filter((r) => {
    if (filter !== "all" && r.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!r.goal.toLowerCase().includes(q) && !r.id.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  if (loading) {
    return <p style={{ color: colors.textSecondary }}>Loading task history...</p>;
  }

  return (
    <div style={styles.container}>
      <div style={styles.controls}>
        <div style={styles.filterBar}>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                ...styles.filterBtn,
                ...(filter === f.key ? styles.filterBtnActive : {}),
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search goals..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={styles.searchInput}
        />
      </div>

      {filtered.length === 0 ? (
        <p style={{ color: colors.textSecondary, marginTop: 16 }}>
          {runs.length === 0 ? "No task runs yet." : "No runs match the current filter."}
        </p>
      ) : (
        <div style={styles.list}>
          {filtered.map((run) => (
            <div key={run.id} style={styles.card} className="ob-card">
              <div style={styles.row}>
                <div style={styles.goalGroup}>
                  <span
                    style={{
                      ...styles.statusDot,
                      background: statusColors[run.status] ?? colors.textMuted,
                    }}
                  />
                  <span style={styles.statusLabel}>
                    {statusLabels[run.status] ?? run.status}
                  </span>
                </div>
                <span style={styles.timestamp}>{formatTimestamp(run.updatedAt)}</span>
              </div>
              <p style={styles.goal}>{run.goal}</p>
              {run.outcome?.summary && (
                <p style={styles.outcome}>{run.outcome.summary}</p>
              )}
              {!run.outcome?.summary && run.checkpoint.stopReason && (
                <p style={styles.stopReason}>{run.checkpoint.stopReason}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  controls: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  filterBar: {
    display: "flex",
    gap: 4,
  },
  filterBtn: {
    ...glass.control,
    border: `1px solid ${colors.borderControl}`,
    color: colors.textSecondary,
    borderRadius: 8,
    padding: "5px 12px",
    cursor: "pointer",
    fontSize: "0.8rem",
  } as React.CSSProperties,
  filterBtnActive: {
    ...glass.emerald,
    color: colors.textWhite,
  } as React.CSSProperties,
  searchInput: {
    background: colors.bgInput,
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: 8,
    padding: "6px 12px",
    color: colors.textPrimary,
    fontSize: "0.84rem",
    outline: "none",
    flex: 1,
    minWidth: 140,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  card: {
    ...glass.card,
    borderRadius: 12,
    padding: "10px 14px",
    border: `1px solid ${colors.borderSubtle}`,
  } as React.CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  goalGroup: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    display: "inline-block",
    flexShrink: 0,
  },
  statusLabel: {
    fontSize: "0.78rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  timestamp: {
    fontSize: "0.78rem",
    color: colors.textMuted,
    flexShrink: 0,
  },
  goal: {
    fontSize: "0.88rem",
    color: colors.textPrimary,
    margin: "6px 0 0",
    lineHeight: 1.4,
  },
  outcome: {
    fontSize: "0.82rem",
    color: colors.textSecondary,
    margin: "4px 0 0",
    lineHeight: 1.35,
  },
  stopReason: {
    fontSize: "0.82rem",
    color: colors.statusFailed,
    margin: "4px 0 0",
    lineHeight: 1.35,
  },
};
