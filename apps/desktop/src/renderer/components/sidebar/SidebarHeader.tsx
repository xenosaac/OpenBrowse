import React from "react";
import { colors, glass } from "../../styles/tokens";

interface Props {
  runningCount: number;
  waitingCount: number;
  onToggleSessionList: () => void;
  onNewSession: () => void;
  onClearChat: () => void;
}

export function SidebarHeader({ runningCount, waitingCount, onToggleSessionList, onNewSession, onClearChat }: Props) {
  return (
    <div style={styles.sidebarHeader}>
      <div style={styles.brandMark}>✦</div>
      <div style={styles.brandInfo}>
        <div style={styles.brandName}>Agent Workspace</div>
        {(runningCount > 0 || waitingCount > 0) && (
          <div style={styles.statusRow}>
            {runningCount > 0 && (
              <span style={{ ...styles.statusPip, color: colors.statusRunning, boxShadow: "0 0 6px rgba(16,185,129,0.4)" }}>
                ● {runningCount} running
              </span>
            )}
            {waitingCount > 0 && (
              <span style={{ ...styles.statusPip, color: colors.statusWaiting }}>
                ◉ {waitingCount} waiting
              </span>
            )}
          </div>
        )}
      </div>
      <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
        <button onClick={onClearChat} style={styles.sessionListToggle} className="ob-btn" title="Clear chat">&#x1F5D1;</button>
        <button onClick={onToggleSessionList} style={styles.sessionListToggle} className="ob-btn" title="Session history">&#x2630;</button>
        <button onClick={onNewSession} style={styles.newSessionButton} className="ob-btn-primary" title="New session">+</button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  sidebarHeader: {
    padding: "16px 16px 12px",
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    background: "transparent",
    borderBottom: "1px solid " + colors.borderSubtle,
    flexShrink: 0
  },
  brandMark: {
    width: 32, height: 32, borderRadius: 10,
    display: "grid", placeItems: "center",
    background: colors.emeraldTint, color: colors.emerald,
    fontSize: 16, flexShrink: 0, marginTop: 2,
    boxShadow: "0 0 12px rgba(16,185,129,0.2)"
  },
  brandInfo: { minWidth: 0 },
  brandName: { fontSize: "0.9rem", fontWeight: 700, color: colors.textWhite },
  statusRow: { display: "flex", gap: 10, marginTop: 4 },
  statusPip: { fontSize: "0.72rem" },
  newSessionButton: {
    width: 26, height: 26, borderRadius: 7,
    background: colors.emeraldTint, border: `1px solid ${colors.borderControl}`,
    color: colors.emerald, cursor: "pointer", fontSize: "1rem",
    display: "grid", placeItems: "center", flexShrink: 0
  },
  sessionListToggle: {
    ...glass.control, width: 26, height: 26, borderRadius: 7,
    border: `1px solid ${colors.borderControl}`,
    color: colors.textSecondary, cursor: "pointer", fontSize: "0.72rem",
    display: "grid", placeItems: "center", flexShrink: 0
  } as React.CSSProperties
};
