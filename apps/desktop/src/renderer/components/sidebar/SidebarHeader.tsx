import React from "react";

interface Props {
  runningCount: number;
  waitingCount: number;
  onToggleSessionList: () => void;
  onNewSession: () => void;
}

export function SidebarHeader({ runningCount, waitingCount, onToggleSessionList, onNewSession }: Props) {
  return (
    <div style={styles.sidebarHeader}>
      <div style={styles.brandMark}>✦</div>
      <div style={styles.brandInfo}>
        <div style={styles.brandName}>Agent Workspace</div>
        {(runningCount > 0 || waitingCount > 0) && (
          <div style={styles.statusRow}>
            {runningCount > 0 && (
              <span style={{ ...styles.statusPip, color: "#22c55e" }}>
                ● {runningCount} running
              </span>
            )}
            {waitingCount > 0 && (
              <span style={{ ...styles.statusPip, color: "#f59e0b" }}>
                ◉ {waitingCount} waiting
              </span>
            )}
          </div>
        )}
      </div>
      <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
        <button onClick={onToggleSessionList} style={styles.sessionListToggle} title="Session history">☰</button>
        <button onClick={onNewSession} style={styles.newSessionButton} title="New session">+</button>
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
    borderBottom: "1px solid #2a2a3e",
    flexShrink: 0
  },
  brandMark: {
    width: 32, height: 32, borderRadius: 10,
    display: "grid", placeItems: "center",
    background: "rgba(139,92,246,0.16)", color: "#c4b5fd",
    fontSize: 16, flexShrink: 0, marginTop: 2
  },
  brandInfo: { minWidth: 0 },
  brandName: { fontSize: "0.9rem", fontWeight: 700, color: "#ffffff" },
  statusRow: { display: "flex", gap: 10, marginTop: 4 },
  statusPip: { fontSize: "0.72rem" },
  newSessionButton: {
    width: 26, height: 26, borderRadius: 7,
    background: "rgba(139,92,246,0.14)", border: "1px solid rgba(139,92,246,0.3)",
    color: "#c4b5fd", cursor: "pointer", fontSize: "1rem",
    display: "grid", placeItems: "center", flexShrink: 0
  },
  sessionListToggle: {
    width: 26, height: 26, borderRadius: 7,
    background: "rgba(255,255,255,0.06)", border: "1px solid #2a2a3e",
    color: "#9090a8", cursor: "pointer", fontSize: "0.72rem",
    display: "grid", placeItems: "center", flexShrink: 0
  }
};
