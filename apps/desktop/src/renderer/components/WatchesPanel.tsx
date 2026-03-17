import { useEffect, useState } from "react";
import { colors, glass } from "../styles/tokens";

interface WatchDescriptor {
  id: string;
  intent: { id: string; goal: string; metadata?: Record<string, string> };
  intervalMinutes: number;
  active: boolean;
  createdAt: string;
  nextRunAt: string;
  lastTriggeredAt?: string;
  lastCompletedAt?: string;
  consecutiveFailures: number;
  lastError?: string;
  backoffUntil?: string;
}

const INTERVAL_PRESETS = [
  { label: "5 min", value: 5 },
  { label: "15 min", value: 15 },
  { label: "30 min", value: 30 },
  { label: "1 hour", value: 60 },
  { label: "4 hours", value: 240 },
  { label: "24 hours", value: 1440 },
];

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = d.getTime() - now;
  const absDiff = Math.abs(diffMs);

  if (absDiff < 60_000) return diffMs > 0 ? "in <1 min" : "<1 min ago";
  if (absDiff < 3600_000) {
    const mins = Math.round(absDiff / 60_000);
    return diffMs > 0 ? `in ${mins} min` : `${mins} min ago`;
  }
  const hours = Math.round(absDiff / 3600_000);
  return diffMs > 0 ? `in ${hours}h` : `${hours}h ago`;
}

function formatInterval(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${minutes / 60}h`;
  return `${minutes / 1440}d`;
}

export function WatchesPanel() {
  const [watches, setWatches] = useState<WatchDescriptor[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form state
  const [goal, setGoal] = useState("");
  const [startUrl, setStartUrl] = useState("");
  const [interval, setInterval] = useState(30);
  const [creating, setCreating] = useState(false);

  const refresh = () => {
    window.openbrowse.listWatches().then((result) => {
      setWatches(result);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  const handleCreate = async () => {
    if (!goal.trim()) return;
    setCreating(true);
    try {
      await window.openbrowse.registerWatch({
        goal: goal.trim(),
        startUrl: startUrl.trim() || undefined,
        intervalMinutes: interval,
      });
      setGoal("");
      setStartUrl("");
      refresh();
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (watchId: string) => {
    await window.openbrowse.unregisterWatch(watchId);
    refresh();
  };

  if (loading) {
    return <p style={{ color: colors.textSecondary }}>Loading watches...</p>;
  }

  return (
    <div style={styles.container}>
      {/* Create form */}
      <div style={styles.createSection}>
        <span style={styles.sectionTitle}>New Recurring Task</span>
        <input
          type="text"
          placeholder="Task goal (e.g., Check stock price for AAPL)"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
          style={styles.input}
        />
        <input
          type="text"
          placeholder="Start URL (optional)"
          value={startUrl}
          onChange={(e) => setStartUrl(e.target.value)}
          style={{ ...styles.input, marginTop: 6 }}
        />
        <div style={styles.intervalRow}>
          <span style={styles.intervalLabel}>Interval:</span>
          {INTERVAL_PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => setInterval(p.value)}
              style={{
                ...styles.presetBtn,
                ...(interval === p.value ? styles.presetBtnActive : {}),
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          onClick={handleCreate}
          disabled={!goal.trim() || creating}
          style={{
            ...styles.createBtn,
            opacity: !goal.trim() || creating ? 0.5 : 1,
          }}
        >
          {creating ? "Creating..." : "Create Watch"}
        </button>
      </div>

      {/* Active watches */}
      {watches.length === 0 ? (
        <p style={{ color: colors.textSecondary, marginTop: 16 }}>
          No active watches. Create one above to schedule a recurring task.
        </p>
      ) : (
        <div style={styles.list}>
          <span style={styles.sectionTitle}>Active Watches ({watches.length})</span>
          {watches.map((w) => (
            <div key={w.id} style={styles.card} className="ob-card">
              <div style={styles.row}>
                <div style={styles.goalGroup}>
                  <span style={{
                    ...styles.statusDot,
                    background: w.consecutiveFailures > 0 ? colors.statusFailed : colors.statusRunning,
                  }} />
                  <span style={styles.intervalBadge}>
                    every {formatInterval(w.intervalMinutes)}
                  </span>
                </div>
                <button
                  onClick={() => handleDelete(w.id)}
                  style={styles.deleteBtn}
                  title="Remove watch"
                >
                  Remove
                </button>
              </div>
              <p style={styles.goal}>{w.intent.goal}</p>
              {w.intent.metadata?.startUrl && (
                <p style={styles.url}>{w.intent.metadata.startUrl}</p>
              )}
              <div style={styles.metaRow}>
                <span style={styles.meta}>Next: {formatRelative(w.nextRunAt)}</span>
                {w.lastCompletedAt && (
                  <span style={styles.meta}>Last: {formatRelative(w.lastCompletedAt)}</span>
                )}
                {w.consecutiveFailures > 0 && (
                  <span style={{ ...styles.meta, color: colors.statusFailed }}>
                    {w.consecutiveFailures} failure{w.consecutiveFailures > 1 ? "s" : ""}
                  </span>
                )}
              </div>
              {w.lastError && (
                <p style={styles.error}>{w.lastError}</p>
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
    gap: 16,
  },
  createSection: {
    ...glass.card,
    borderRadius: 12,
    padding: "14px 16px",
    border: `1px solid ${colors.borderSubtle}`,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } as React.CSSProperties,
  sectionTitle: {
    fontSize: "0.82rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: colors.textSecondary,
    marginBottom: 4,
  },
  input: {
    background: colors.bgInput,
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: 8,
    padding: "8px 12px",
    color: colors.textPrimary,
    fontSize: "0.88rem",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  },
  intervalRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    marginTop: 4,
  },
  intervalLabel: {
    fontSize: "0.82rem",
    color: colors.textSecondary,
    marginRight: 4,
  },
  presetBtn: {
    ...glass.control,
    border: `1px solid ${colors.borderControl}`,
    color: colors.textSecondary,
    borderRadius: 8,
    padding: "4px 10px",
    cursor: "pointer",
    fontSize: "0.78rem",
  } as React.CSSProperties,
  presetBtnActive: {
    ...glass.emerald,
    color: colors.textWhite,
  } as React.CSSProperties,
  createBtn: {
    ...glass.emerald,
    color: colors.textWhite,
    border: `1px solid ${colors.emeraldBorder}`,
    borderRadius: 8,
    padding: "8px 16px",
    cursor: "pointer",
    fontSize: "0.86rem",
    fontWeight: 600,
    marginTop: 4,
    alignSelf: "flex-start",
  } as React.CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
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
  intervalBadge: {
    fontSize: "0.76rem",
    fontWeight: 600,
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  },
  deleteBtn: {
    ...glass.control,
    border: `1px solid ${colors.borderControl}`,
    color: colors.statusFailed,
    borderRadius: 6,
    padding: "3px 10px",
    cursor: "pointer",
    fontSize: "0.76rem",
  } as React.CSSProperties,
  goal: {
    fontSize: "0.88rem",
    color: colors.textPrimary,
    margin: "6px 0 0",
    lineHeight: 1.4,
  },
  url: {
    fontSize: "0.8rem",
    color: colors.textMuted,
    margin: "2px 0 0",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  metaRow: {
    display: "flex",
    gap: 12,
    marginTop: 6,
    flexWrap: "wrap",
  },
  meta: {
    fontSize: "0.78rem",
    color: colors.textMuted,
  },
  error: {
    fontSize: "0.78rem",
    color: colors.statusFailed,
    margin: "4px 0 0",
    lineHeight: 1.35,
  },
};
