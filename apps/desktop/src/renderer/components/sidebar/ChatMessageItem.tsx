import React from "react";
import type { ChatMessage } from "../../types/chat";
import { renderMarkdownHtml } from "../../lib/markdown";

interface Props {
  message: ChatMessage;
}

export function ChatMessageItem({ message }: Props) {
  return (
    <div style={{
      ...styles.chatRow,
      ...(message.role === "user" ? styles.chatRowUser : {}),
      ...(message.tone === "action" ? styles.chatRowAction : {})
    }}>
      {message.role === "agent" && message.tone !== "action" && (
        <div style={styles.chatAvatar}>✦</div>
      )}
      {message.tone === "action" && <div style={styles.chatActionIcon}>⚡</div>}
      <div style={{
        ...styles.chatBubble,
        ...(message.role === "user" ? styles.chatBubbleUser : {}),
        ...(message.tone === "success" ? styles.chatBubbleSuccess : {}),
        ...(message.tone === "warning" ? styles.chatBubbleWarning : {}),
        ...(message.tone === "error" ? styles.chatBubbleError : {}),
        ...(message.tone === "action" ? styles.chatBubbleAction : {})
      }}>
        {message.id.startsWith("outcome:") ? (
          <div dangerouslySetInnerHTML={{ __html: renderMarkdownHtml(message.content) }} />
        ) : (
          <div>{message.content}</div>
        )}
        <div style={styles.chatTime}>
          {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
      {message.role === "user" && <div style={styles.chatAvatarUser}>•</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  chatRow: { display: "flex", alignItems: "flex-end", gap: 8 },
  chatRowUser: { justifyContent: "flex-end" },
  chatRowAction: { gap: 6 },
  chatAvatar: {
    width: 26, height: 26, borderRadius: 999,
    display: "grid", placeItems: "center",
    background: "rgba(139,92,246,0.14)", color: "#c4b5fd",
    flexShrink: 0, fontSize: "0.7rem"
  },
  chatAvatarUser: {
    width: 26, height: 26, borderRadius: 999,
    display: "grid", placeItems: "center",
    background: "#334155", color: "#e2e8f0",
    flexShrink: 0, fontSize: "0.7rem"
  },
  chatActionIcon: {
    width: 18, height: 18, display: "grid", placeItems: "center",
    color: "#8b5cf6", flexShrink: 0, fontSize: "0.65rem"
  },
  chatBubble: {
    maxWidth: "82%", background: "#171726", border: "1px solid #2a2a3e",
    color: "#e5e7eb", borderRadius: 14, padding: "9px 12px",
    fontSize: "0.88rem", lineHeight: 1.45
  },
  chatBubbleUser: {
    background: "linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)",
    borderColor: "#8b5cf6", color: "#ffffff"
  },
  chatBubbleSuccess: { borderColor: "rgba(34,197,94,0.3)" },
  chatBubbleWarning: { borderColor: "rgba(245,158,11,0.3)" },
  chatBubbleError: { borderColor: "rgba(239,68,68,0.3)" },
  chatBubbleAction: {
    background: "transparent", border: "none",
    borderLeft: "2px solid #8b5cf6", borderRadius: 0,
    padding: "4px 10px", fontSize: "0.78rem", color: "#9090a8"
  },
  chatTime: { marginTop: 6, color: "rgba(255,255,255,0.42)", fontSize: "0.68rem" }
};
