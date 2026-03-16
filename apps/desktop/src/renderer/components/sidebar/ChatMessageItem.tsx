import React from "react";
import type { ChatMessage } from "../../types/chat";
import { renderMarkdownHtml } from "../../lib/markdown";
import { colors, glass } from "../../styles/tokens";

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
    background: colors.emeraldTint, color: colors.emerald,
    flexShrink: 0, fontSize: "0.7rem"
  },
  chatAvatarUser: {
    width: 26, height: 26, borderRadius: 999,
    display: "grid", placeItems: "center",
    background: "rgba(255,255,255,0.08)", color: colors.textPrimary,
    flexShrink: 0, fontSize: "0.7rem"
  },
  chatActionIcon: {
    width: 18, height: 18, display: "grid", placeItems: "center",
    color: colors.emerald, flexShrink: 0, fontSize: "0.65rem"
  },
  chatBubble: {
    maxWidth: "82%",
    ...glass.card,
    border: "1px solid " + colors.borderSubtle,
    color: "#e5e7eb", borderRadius: 14, padding: "9px 12px",
    fontSize: "0.88rem", lineHeight: 1.45
  } as React.CSSProperties,
  chatBubbleUser: {
    ...glass.emerald,
    color: "#ffffff"
  } as React.CSSProperties,
  chatBubbleSuccess: { borderColor: colors.statusRunningBorder },
  chatBubbleWarning: { borderColor: colors.statusWaitingBorder },
  chatBubbleError: { borderColor: colors.statusFailedBorder },
  chatBubbleAction: {
    background: "transparent", border: "none",
    borderLeft: "2px solid " + colors.emerald, borderRadius: 6,
    padding: "4px 10px", fontSize: "0.78rem", color: colors.textSecondary
  } as React.CSSProperties,
  chatTime: { marginTop: 6, color: "rgba(255,255,255,0.42)", fontSize: "0.68rem" }
};
