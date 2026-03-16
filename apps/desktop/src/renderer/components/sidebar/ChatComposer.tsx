import React from "react";
import { colors, glass, shadows } from "../../styles/tokens";

interface Props {
  value: string;
  busy: boolean;
  plannerMode: string | undefined;
  runtimeReady: boolean;
  onChange: (val: string) => void;
  onSubmit: () => void;
}

export function ChatComposer({ value, busy, plannerMode, runtimeReady, onChange, onSubmit }: Props) {
  return (
    <div style={styles.composer}>
      <div style={styles.composerRow}>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder="Ask the agent to do something..."
          style={styles.composerInput}
        />
        <button onClick={onSubmit} style={styles.composerButton} className="ob-btn-primary" disabled={busy}>
          {busy ? "..." : "\u2192"}
        </button>
      </div>
      <div style={styles.composerHint}>
        {plannerMode === "live"
          ? "Live agent ready"
          : runtimeReady
          ? "No API key \u2014 settings needed"
          : "Runtime loading\u2026"}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  composer: {
    padding: "10px 14px 12px", borderTop: "1px solid " + colors.borderGlass,
    ...glass.panel,
    border: `1px solid ${colors.borderGlass}`,
    flexShrink: 0
  } as React.CSSProperties,
  composerRow: { display: "flex", gap: 8 },
  composerInput: {
    flex: 1, color: colors.textPrimary,
    ...glass.input,
    border: "1px solid " + colors.borderGlass, borderRadius: 12,
    padding: "10px 12px", fontSize: "0.88rem"
  } as React.CSSProperties,
  composerButton: {
    width: 40, borderRadius: 12, border: "1px solid " + colors.emeraldActive,
    background: colors.emerald,
    color: "#ffffff", cursor: "pointer", fontWeight: 700, fontSize: "1rem",
    boxShadow: "0 0 16px rgba(16,185,129,0.2)"
  },
  composerHint: { marginTop: 6, fontSize: "0.7rem", color: "#6b6b82" }
};
