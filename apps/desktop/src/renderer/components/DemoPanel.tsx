import { useState, useEffect } from "react";
import type { TaskRun } from "@openbrowse/contracts";
import { colors, glass, shadows } from "../styles/tokens";

interface DemoDescriptor {
  id: string;
  label: string;
  category: string;
  description: string;
  supportsWatch: boolean;
}

interface TaskPackDescriptor {
  id: string;
  label: string;
  category: string;
  description: string;
  requiresLivePlanner: boolean;
  available: boolean;
  unavailableReason?: string;
}

interface Props {
  onStarted: (run?: TaskRun | null) => void | Promise<void>;
}

const categoryColors: Record<string, string> = {
  research: "#3b82f6",
  booking: colors.emerald,
  monitor: colors.statusRunning,
  travel: "#0ea5e9",
  shopping: "#f59e0b",
  productivity: colors.emerald
};

export function DemoPanel({ onStarted }: Props) {
  const [demos, setDemos] = useState<DemoDescriptor[]>([]);
  const [packs, setPacks] = useState<TaskPackDescriptor[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [watchInterval, setWatchInterval] = useState(30);

  useEffect(() => {
    window.openbrowse.listDemos().then(setDemos).catch(() => {});
    window.openbrowse.listTaskPacks().then(setPacks).catch(() => {});
  }, []);

  const handleRunDemo = async (demoId: string) => {
    setBusy(demoId);
    try {
      const run = (await window.openbrowse.runDemo(demoId)) as TaskRun;
      await onStarted(run);
    } finally {
      setBusy(null);
    }
  };

  const handleWatch = async (demoId: string) => {
    setBusy(`watch_${demoId}`);
    try {
      await window.openbrowse.watchDemo(demoId, watchInterval);
      await onStarted(null);
    } finally {
      setBusy(null);
    }
  };

  const [error, setError] = useState<string | null>(null);

  const handleRunPack = async (packId: string) => {
    setError(null);
    setBusy(`pack_${packId}`);
    try {
      const run = (await window.openbrowse.runTaskPack(packId)) as TaskRun;
      await onStarted(run);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      {packs.length > 0 && (
        <>
          <h3 style={styles.sectionTitle}>Live Task Packs</h3>
          <p style={styles.sectionHint}>
            These use the real Claude planner and browser runtime to operate on live websites.
          </p>
          {error && <div style={styles.errorBanner}>{error}</div>}
          {packs.map((pack) => (
            <div key={pack.id} style={{ ...styles.card, ...(pack.available ? {} : styles.cardDisabled) }}>
              <div style={styles.row}>
                <span style={{ ...styles.badge, background: categoryColors[pack.category] ?? "#6b7280" }}>
                  {pack.category}
                </span>
                <strong>{pack.label}</strong>
                {pack.available
                  ? <span style={styles.liveBadge}>live</span>
                  : <span style={styles.unavailableBadge}>unavailable</span>
                }
              </div>
              <p style={styles.description}>{pack.description}</p>
              {pack.unavailableReason && (
                <p style={styles.unavailableReason}>{pack.unavailableReason}</p>
              )}
              <div style={styles.actions}>
                <button
                  onClick={() => handleRunPack(pack.id)}
                  disabled={!pack.available || busy === `pack_${pack.id}`}
                  style={pack.available ? styles.button : styles.buttonDisabled}
                  className={pack.available ? "ob-btn-primary" : undefined}
                >
                  {busy === `pack_${pack.id}` ? "Starting..." : "Run"}
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {demos.length > 0 && (
        <>
          <h3 style={{ ...styles.sectionTitle, marginTop: packs.length > 0 ? 24 : 0 }}>Scripted Demos</h3>
          <p style={styles.sectionHint}>
            These run against stub planners to demonstrate orchestrator flows without live browser access.
          </p>
          {demos.map((demo) => (
            <div key={demo.id} style={styles.card}>
              <div style={styles.row}>
                <span style={{ ...styles.badge, background: categoryColors[demo.category] ?? "#6b7280" }}>
                  {demo.category}
                </span>
                <strong>{demo.label}</strong>
              </div>
              <p style={styles.description}>{demo.description}</p>
              <div style={styles.actions}>
                <button
                  onClick={() => handleRunDemo(demo.id)}
                  disabled={busy === demo.id}
                  style={styles.button}
                  className="ob-btn-primary"
                >
                  {busy === demo.id ? "Starting..." : "Run Demo"}
                </button>
                {demo.supportsWatch && (
                  <>
                    <input
                      type="number"
                      min={1}
                      value={watchInterval}
                      onChange={(e) => setWatchInterval(Number(e.target.value) || 30)}
                      style={styles.intervalInput}
                    />
                    <span style={styles.intervalLabel}>min</span>
                    <button
                      onClick={() => handleWatch(demo.id)}
                      disabled={busy === `watch_${demo.id}`}
                      style={{ ...styles.button, ...styles.watchButton }}
                    >
                      {busy === `watch_${demo.id}` ? "Registering..." : "Watch"}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </>
      )}

      {demos.length === 0 && packs.length === 0 && (
        <p style={{ color: "#9090a8" }}>No demo flows or task packs registered.</p>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  sectionTitle: {
    fontSize: "1rem",
    color: "#e5e7eb",
    margin: "0 0 4px"
  },
  sectionHint: {
    fontSize: "0.82rem",
    color: "#9090a8",
    margin: "0 0 12px"
  },
  card: {
    ...glass.card,
    borderRadius: 12,
    padding: "12px 16px",
    marginBottom: 8,
    border: "1px solid " + colors.borderSubtle,
    boxShadow: shadows.glassSubtle
  } as React.CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8
  },
  badge: {
    color: "#ffffff",
    fontSize: "0.7rem",
    padding: "2px 6px",
    borderRadius: 4,
    textTransform: "uppercase" as const
  },
  liveBadge: {
    background: "rgba(34,197,94,0.18)",
    color: "#86efac",
    border: "1px solid rgba(34,197,94,0.28)",
    fontSize: "0.65rem",
    padding: "1px 6px",
    borderRadius: 3,
    textTransform: "uppercase" as const,
    marginLeft: "auto"
  },
  unavailableBadge: {
    background: "rgba(107,114,128,0.18)",
    color: "#9ca3af",
    border: "1px solid rgba(107,114,128,0.28)",
    fontSize: "0.65rem",
    padding: "1px 6px",
    borderRadius: 3,
    textTransform: "uppercase" as const,
    marginLeft: "auto"
  },
  cardDisabled: {
    opacity: 0.5
  },
  unavailableReason: {
    fontSize: "0.8rem",
    color: "#fbbf24",
    margin: "4px 0 0",
    fontStyle: "italic" as const
  },
  errorBanner: {
    background: "rgba(239,68,68,0.12)",
    border: "1px solid rgba(239,68,68,0.28)",
    color: "#fecaca",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: "0.85rem",
    marginBottom: 12
  },
  buttonDisabled: {
    background: colors.bgInput,
    color: colors.textMuted,
    border: "1px solid " + colors.borderDefault,
    borderRadius: 8,
    padding: "6px 16px",
    cursor: "not-allowed",
    fontSize: "0.9rem"
  },
  description: {
    fontSize: "0.85rem",
    color: "#9090a8",
    margin: "6px 0"
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 8
  },
  button: {
    background: colors.emerald,
    color: "#ffffff",
    border: "1px solid " + colors.emeraldBorderHover,
    borderRadius: 8,
    padding: "6px 16px",
    cursor: "pointer",
    fontSize: "0.9rem"
  },
  watchButton: {
    background: "#0e7490",
    borderColor: "#06b6d4"
  },
  intervalInput: {
    ...glass.input,
    width: 56,
    border: "1px solid " + colors.borderDefault,
    borderRadius: 8,
    padding: "4px 6px",
    color: "#f5f5ff",
    fontSize: "0.85rem",
    textAlign: "center" as const
  } as React.CSSProperties,
  intervalLabel: {
    fontSize: "0.8rem",
    color: "#9090a8"
  }
};
