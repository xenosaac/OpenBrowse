import React, { useState, useCallback } from "react";
import type { ChatMessage } from "../../types/chat";
import { renderMarkdownHtml } from "../../lib/markdown";
import { colors, glass } from "../../styles/tokens";

interface Props {
  message: ChatMessage;
  onRetry?: (goal: string) => void;
}

function extractedDataToTsv(data: Array<{ label: string; value: string }>): string {
  return data.map((item) => `${item.label}\t${item.value}`).join("\n");
}

export function ChatMessageItem({ message, onRetry }: Props) {
  const [copied, setCopied] = useState(false);
  const isAction = message.tone === "action" || message.tone === "action-error";
  const hasExtracted = message.extractedData && message.extractedData.length > 0;
  const canRetry = message.tone === "error" && !!message.goalText && !!onRetry;

  const handleCopy = useCallback(() => {
    if (!message.extractedData || copied) return;
    const tsv = extractedDataToTsv(message.extractedData);
    navigator.clipboard.writeText(tsv).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [message.extractedData, copied]);

  const handleRetry = useCallback(() => {
    if (message.goalText && onRetry) onRetry(message.goalText);
  }, [message.goalText, onRetry]);

  return (
    <div style={{
      ...styles.chatRow,
      ...(message.role === "user" ? styles.chatRowUser : {}),
      ...(isAction ? styles.chatRowAction : {})
    }}>
      {message.role === "agent" && !isAction && (
        <div style={styles.chatAvatar}>✦</div>
      )}
      {message.tone === "action" && <div style={styles.chatActionIcon}>⚡</div>}
      {message.tone === "action-error" && <div style={styles.chatActionErrorIcon}>✗</div>}
      <div style={{
        ...styles.chatBubble,
        ...(message.role === "user" ? styles.chatBubbleUser : {}),
        ...(message.tone === "success" ? styles.chatBubbleSuccess : {}),
        ...(message.tone === "warning" ? styles.chatBubbleWarning : {}),
        ...(message.tone === "error" ? styles.chatBubbleError : {}),
        ...(message.tone === "action" ? styles.chatBubbleAction : {}),
        ...(message.tone === "action-error" ? styles.chatBubbleActionError : {})
      }}>
        {message.id.startsWith("outcome:") ? (
          <div dangerouslySetInnerHTML={{ __html: renderMarkdownHtml(message.content) }} />
        ) : (
          <div>{message.content}</div>
        )}
        {hasExtracted && (
          <button
            onClick={handleCopy}
            style={copied ? { ...styles.copyButton, ...styles.copyButtonCopied } : styles.copyButton}
          >
            {copied ? "Copied \u2713" : "Copy"}
          </button>
        )}
        {canRetry && (
          <button onClick={handleRetry} style={styles.retryButton}>
            Retry
          </button>
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
    background: colors.controlHoverBg, color: colors.textPrimary,
    flexShrink: 0, fontSize: "0.7rem"
  },
  chatActionIcon: {
    width: 18, height: 18, display: "grid", placeItems: "center",
    color: colors.emerald, flexShrink: 0, fontSize: "0.65rem"
  },
  chatActionErrorIcon: {
    width: 18, height: 18, display: "grid", placeItems: "center",
    color: colors.statusFailed, flexShrink: 0, fontSize: "0.65rem"
  },
  chatBubble: {
    maxWidth: "82%",
    ...glass.card,
    border: "1px solid " + colors.borderSubtle,
    color: colors.textPrimary, borderRadius: 14, padding: "9px 12px",
    fontSize: "0.88rem", lineHeight: 1.45
  } as React.CSSProperties,
  chatBubbleUser: {
    ...glass.emerald,
    color: colors.textWhite
  } as React.CSSProperties,
  chatBubbleSuccess: { borderColor: colors.statusRunningBorder },
  chatBubbleWarning: { borderColor: colors.statusWaitingBorder },
  chatBubbleError: { borderColor: colors.statusFailedBorder },
  chatBubbleAction: {
    background: "transparent", border: "none",
    borderLeft: "2px solid " + colors.emerald, borderRadius: 6,
    padding: "4px 10px", fontSize: "0.78rem", color: colors.textSecondary
  } as React.CSSProperties,
  chatBubbleActionError: {
    background: "transparent", border: "none",
    borderLeft: "2px solid " + colors.statusFailed, borderRadius: 6,
    padding: "4px 10px", fontSize: "0.78rem", color: colors.textSecondary
  } as React.CSSProperties,
  chatTime: { marginTop: 6, color: "rgba(255,255,255,0.42)", fontSize: "0.68rem" },
  copyButton: {
    ...glass.control,
    border: "1px solid " + colors.borderControl,
    borderRadius: 6,
    padding: "3px 10px",
    marginTop: 6,
    fontSize: "0.72rem",
    color: colors.textSecondary,
    cursor: "pointer",
    transition: "all 150ms ease",
  } as React.CSSProperties,
  copyButtonCopied: {
    color: colors.emerald,
    borderColor: colors.emeraldBorder,
  },
  retryButton: {
    ...glass.control,
    border: "1px solid " + colors.borderControl,
    borderRadius: 6,
    padding: "3px 10px",
    marginTop: 6,
    fontSize: "0.72rem",
    color: colors.textSecondary,
    cursor: "pointer",
    transition: "all 150ms ease",
  } as React.CSSProperties,
};
