import React, { useState } from "react";
import type { BrowserShellTabDescriptor } from "../../../shared/runtime";
import { colors, radii, glass, shadows } from "../../styles/tokens";

interface Props {
  shellTabs: BrowserShellTabDescriptor[];
  tabFavicons: Record<string, string>;
  onOpenTab: (tab: BrowserShellTabDescriptor) => void;
  onStartTask: (goal: string) => void;
}

export function HomePage({ shellTabs, tabFavicons, onOpenTab, onStartTask }: Props) {
  const [taskInput, setTaskInput] = useState("");

  const recentTabs = shellTabs
    .filter((tab) => tab.url && tab.url !== "about:blank")
    .filter((tab, i, arr) => arr.findIndex((t) => t.url === tab.url) === i);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const goal = taskInput.trim();
    if (!goal) return;
    onStartTask(goal);
    setTaskInput("");
  };

  return (
    <div style={styles.page}>
      {/* Centered agent prompt surface */}
      <div style={styles.promptArea}>
        <div style={styles.brandMark}>
          <span style={styles.brandIcon}>◎</span>
          <span style={styles.brandName}>OpenBrowse</span>
        </div>
        <div style={styles.greeting}>What would you like to do?</div>
        <form onSubmit={handleSubmit} style={styles.promptCard} className="ob-glass-panel">
          <input
            type="text"
            value={taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
            placeholder="Search the web, fill a form, extract data…"
            style={styles.promptInput}
            className="ob-address"
          />
          <button
            type="submit"
            style={{
              ...styles.promptSubmit,
              ...(taskInput.trim() ? {} : { opacity: 0.3, pointerEvents: "none" as const })
            }}
            className="ob-btn-primary"
          >
            Go
          </button>
        </form>
      </div>

      {/* Secondary recent-tabs grid */}
      {recentTabs.length > 0 && (
        <div style={styles.recentSection}>
          <div style={styles.eyebrow}>Recent</div>
          <div style={styles.recentGrid}>
            {recentTabs.map((tab) => (
              <button key={tab.groupId} onClick={() => onOpenTab(tab)} style={styles.recentCard} className="ob-card">
                <div style={styles.recentFavicon}>
                  {tabFavicons[tab.id] ? (
                    <img
                      src={tabFavicons[tab.id]}
                      alt=""
                      width={16}
                      height={16}
                      style={{ borderRadius: 3 }}
                      onError={(e) => { (e.target as HTMLImageElement).replaceWith(document.createTextNode("\u2299")); }}
                    />
                  ) : "\u2299"}
                </div>
                <div style={styles.recentInfo}>
                  <div style={styles.recentTitle}>{tab.title || "Untitled"}</div>
                  <div style={styles.recentUrl}>{tab.url}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {recentTabs.length === 0 && (
        <div style={styles.emptyHint}>
          No recent tabs. Type a task above or press <kbd style={styles.kbd}>+</kbd> to open a new tab.
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    height: "100%",
    overflow: "auto",
    padding: "0 32px 32px",
    background: colors.bgBase,
    backgroundImage: [
      'radial-gradient(ellipse 90% 60% at 50% 0%, rgba(16,185,129,0.06) 0%, transparent 65%)',
      'radial-gradient(ellipse 70% 50% at 80% 100%, rgba(99,102,241,0.04) 0%, transparent 55%)',
      'radial-gradient(ellipse 50% 40% at 20% 80%, rgba(16,185,129,0.025) 0%, transparent 50%)'
    ].join(', '),
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },

  /* --- Prompt area (hero) --- */
  promptArea: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingTop: 80,
    paddingBottom: 48,
    width: "100%",
    maxWidth: 560,
  },
  brandMark: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
  },
  brandIcon: {
    fontSize: "1.6rem",
    color: colors.emerald,
    lineHeight: 1,
  },
  brandName: {
    fontSize: "1.1rem",
    fontWeight: 700,
    color: colors.textWhite,
    letterSpacing: "0.02em",
  },
  greeting: {
    fontSize: "1.5rem",
    fontWeight: 600,
    color: colors.textPrimary,
    marginBottom: 28,
    textAlign: "center",
  },
  promptCard: {
    ...glass.card,
    border: `1px solid ${colors.borderSubtle}`,
    borderRadius: 18,
    boxShadow: shadows.glass,
    padding: "8px 8px 8px 18px",
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
  } as React.CSSProperties,
  promptInput: {
    flex: 1,
    background: "transparent",
    border: "none",
    outline: "none",
    color: colors.textPrimary,
    fontSize: "0.95rem",
    fontFamily: "'SF Pro Display', 'Avenir Next', sans-serif",
    padding: "10px 0",
    lineHeight: 1.4,
  },
  promptSubmit: {
    background: colors.emerald,
    color: colors.textWhite,
    border: "none",
    borderRadius: 12,
    padding: "10px 22px",
    fontSize: "0.88rem",
    fontWeight: 600,
    cursor: "pointer",
    flexShrink: 0,
    fontFamily: "'SF Pro Display', 'Avenir Next', sans-serif",
  },

  /* --- Recent tabs (secondary) --- */
  recentSection: {
    width: "100%",
    maxWidth: 680,
    paddingBottom: 32,
  },
  eyebrow: {
    fontSize: "0.72rem",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    marginBottom: 12,
  },
  recentGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
    gap: 8,
  },
  recentCard: {
    ...glass.card,
    display: "flex",
    alignItems: "center",
    gap: 10,
    border: `1px solid ${colors.borderSubtle}`,
    boxShadow: shadows.glassSubtle,
    borderRadius: 14,
    padding: "10px 14px",
    cursor: "pointer",
    textAlign: "left",
    color: colors.textPrimary,
  } as React.CSSProperties,
  recentFavicon: {
    fontSize: "1rem",
    color: colors.emerald,
    flexShrink: 0,
  },
  recentInfo: { minWidth: 0 },
  recentTitle: {
    fontSize: "0.85rem",
    fontWeight: 600,
    color: colors.textWhite,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  recentUrl: {
    fontSize: "0.72rem",
    color: colors.textMuted,
    marginTop: 2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  /* --- Empty state --- */
  emptyHint: {
    color: colors.textSecondary,
    fontSize: "0.85rem",
    textAlign: "center",
    paddingTop: 8,
    maxWidth: 400,
  },
  kbd: {
    ...glass.input,
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: 4,
    padding: "1px 5px",
    fontSize: "0.82rem",
    color: colors.textPrimary,
  } as React.CSSProperties,
};
