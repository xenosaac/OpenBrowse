import React from "react";
import type { ChatSession } from "../../types/chat";
import { colors, glass, shadows } from "../../styles/tokens";

interface Props {
  sessions: ChatSession[];
  activeSessionId: string;
  onSwitch: (id: string) => void;
}

export function SessionListDropdown({ sessions, activeSessionId, onSwitch }: Props) {
  return (
    <div style={styles.sessionList}>
      <div style={styles.sessionListHeader}>
        <span style={styles.sessionListTitle}>Sessions</span>
      </div>
      {sessions.map(session => (
        <button key={session.id}
          onClick={() => onSwitch(session.id)}
          className="ob-card"
          style={{
            ...styles.sessionItem,
            ...(session.id === activeSessionId ? styles.sessionItemActive : {})
          }}>
          <div style={styles.sessionItemTitle}>{session.title}</div>
          <div style={styles.sessionItemMeta}>
            {new Date(session.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            {session.runIds.length > 0 && ` · ${session.runIds.length} tasks`}
          </div>
        </button>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  sessionList: {
    ...glass.panel,
    border: `1px solid ${colors.borderGlass}`,
    boxShadow: shadows.glassElevated,
    borderBottom: "1px solid " + colors.borderGlass,
    padding: "6px 8px", maxHeight: 220, overflowY: "auto" as const, flexShrink: 0
  } as React.CSSProperties,
  sessionListHeader: { padding: "4px 6px 6px", display: "flex", alignItems: "center" },
  sessionListTitle: {
    fontSize: "0.7rem", color: "#9090a8",
    textTransform: "uppercase" as const, letterSpacing: "0.06em", fontWeight: 600
  },
  sessionItem: {
    display: "block", width: "100%", background: "none",
    border: `1px solid ${colors.borderGlass}`, borderRadius: 8,
    padding: "6px 8px", textAlign: "left" as const,
    cursor: "pointer", color: "#e5e7eb", marginBottom: 2
  },
  sessionItemActive: {
    ...glass.emerald
  } as React.CSSProperties,
  sessionItemTitle: {
    fontSize: "0.82rem", fontWeight: 600,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const
  },
  sessionItemMeta: { fontSize: "0.68rem", color: "#6b6b82", marginTop: 2 }
};
