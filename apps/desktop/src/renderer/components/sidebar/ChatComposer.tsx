import React from "react";

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
        <button onClick={onSubmit} style={styles.composerButton} disabled={busy}>
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
    padding: "10px 14px 12px", borderTop: "1px solid #232335",
    background: "#0f0f18", flexShrink: 0
  },
  composerRow: { display: "flex", gap: 8 },
  composerInput: {
    flex: 1, background: "#1e1e2e", color: "#f8fafc",
    border: "1px solid #2a2a3e", borderRadius: 12,
    padding: "10px 12px", fontSize: "0.88rem"
  },
  composerButton: {
    width: 40, borderRadius: 12, border: "1px solid #8b5cf6",
    background: "linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)",
    color: "#ffffff", cursor: "pointer", fontWeight: 700, fontSize: "1rem"
  },
  composerHint: { marginTop: 6, fontSize: "0.7rem", color: "#6b6b82" }
};
