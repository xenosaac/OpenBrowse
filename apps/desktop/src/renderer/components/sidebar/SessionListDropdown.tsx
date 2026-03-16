import React from "react";
import type { ChatSession } from "../../types/chat";

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
    background: "#12121a", borderBottom: "1px solid #2a2a3e",
    padding: "6px 8px", maxHeight: 220, overflowY: "auto" as const, flexShrink: 0
  },
  sessionListHeader: { padding: "4px 6px 6px", display: "flex", alignItems: "center" },
  sessionListTitle: {
    fontSize: "0.7rem", color: "#9090a8",
    textTransform: "uppercase" as const, letterSpacing: "0.06em", fontWeight: 600
  },
  sessionItem: {
    display: "block", width: "100%", background: "none",
    border: "1px solid transparent", borderRadius: 8,
    padding: "6px 8px", textAlign: "left" as const,
    cursor: "pointer", color: "#e5e7eb", marginBottom: 2
  },
  sessionItemActive: {
    background: "rgba(139,92,246,0.1)", borderColor: "rgba(139,92,246,0.25)"
  },
  sessionItemTitle: {
    fontSize: "0.82rem", fontWeight: 600,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const
  },
  sessionItemMeta: { fontSize: "0.68rem", color: "#6b6b82", marginTop: 2 }
};
