import React, { useState } from "react";
import type { RuntimeSettings } from "../../shared/runtime";
import { createDefaultRuntimeSettings } from "../../shared/runtime";
import { colors, glass, shadows } from "../styles/tokens";

interface Props {
  onComplete: (settings: RuntimeSettings) => void;
  onSkip: () => void;
}

export function SetupWizard({ onComplete, onSkip }: Props) {
  const [apiKey, setApiKey] = useState("");
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasApiKey = apiKey.trim().length > 0;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const settings: RuntimeSettings = {
        ...createDefaultRuntimeSettings(),
        anthropicApiKey: apiKey.trim(),
        telegramBotToken: botToken.trim(),
        telegramChatId: chatId.trim()
      };
      onComplete(settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.dialog}>
        <div style={styles.header}>
          <h1 style={styles.title}>Welcome to OpenBrowse</h1>
          <p style={styles.subtitle}>
            Set up your agent browser in a few seconds.
          </p>
        </div>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Anthropic API Key</h2>
          <p style={styles.helpText}>
            Required for the AI agent to operate. Get a key from{" "}
            <span style={styles.link}>console.anthropic.com</span>.
          </p>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-ant-..."
            style={styles.input}
            autoFocus
          />
        </div>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Telegram Bot <span style={styles.optional}>(optional)</span></h2>
          <p style={styles.helpText}>
            For remote task control. Create a bot via @BotFather on Telegram.
          </p>
          <input
            type="password"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder="Bot token (123456:ABC-DEF...)"
            style={styles.input}
          />
          <input
            type="text"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            placeholder="Your Telegram user ID (optional)"
            style={{ ...styles.input, marginTop: 8 }}
          />
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.actions}>
          <button
            onClick={handleSave}
            disabled={saving || !hasApiKey}
            style={{
              ...styles.primaryButton,
              ...(saving || !hasApiKey ? { opacity: 0.5, cursor: "not-allowed" } : {})
            }}
            className="ob-btn-primary"
          >
            {saving ? "Saving..." : "Get Started"}
          </button>
          <button
            onClick={onSkip}
            style={styles.skipButton}
            className="ob-btn"
          >
            Skip for now
          </button>
        </div>

        <p style={styles.footnote}>
          You can change these anytime in Settings (hamburger menu).
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    ...glass.overlay,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10000
  } as React.CSSProperties,
  dialog: {
    ...glass.card,
    border: `1px solid ${colors.borderGlass}`,
    borderRadius: 20,
    padding: "32px 36px",
    maxWidth: 480,
    width: "90%",
    boxShadow: shadows.glassElevated,
    display: "flex",
    flexDirection: "column",
    gap: 20
  } as React.CSSProperties,
  header: {
    textAlign: "center" as const
  },
  title: {
    margin: 0,
    fontSize: "1.5rem",
    color: colors.textBright,
    fontWeight: 700
  },
  subtitle: {
    margin: "8px 0 0",
    color: colors.textSecondary,
    fontSize: "0.92rem"
  },
  section: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6
  },
  sectionTitle: {
    margin: 0,
    fontSize: "1rem",
    color: colors.textPrimary,
    fontWeight: 600
  },
  optional: {
    fontWeight: 400,
    color: colors.textMuted,
    fontSize: "0.85rem"
  },
  helpText: {
    margin: 0,
    fontSize: "0.82rem",
    color: colors.textSecondary,
    lineHeight: 1.5
  },
  link: {
    color: colors.emerald,
    fontWeight: 500
  },
  input: {
    ...glass.input,
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: 12,
    padding: "10px 12px",
    color: colors.textBright,
    fontSize: "0.9rem",
    outline: "none",
    width: "100%",
    boxSizing: "border-box" as const
  } as React.CSSProperties,
  actions: {
    display: "flex",
    gap: 12,
    justifyContent: "center",
    marginTop: 4
  },
  primaryButton: {
    background: colors.emerald,
    color: colors.textWarm,
    border: `1px solid ${colors.emeraldBorderHover}`,
    borderRadius: 12,
    padding: "10px 24px",
    cursor: "pointer",
    fontSize: "0.92rem",
    fontWeight: 700
  },
  skipButton: {
    background: colors.buttonBg,
    color: colors.textSecondary,
    border: `1px solid ${colors.buttonBorder}`,
    borderRadius: 12,
    padding: "10px 20px",
    cursor: "pointer",
    fontSize: "0.88rem"
  },
  error: {
    padding: "10px 12px",
    borderRadius: 8,
    background: "rgba(239,68,68,0.12)",
    border: "1px solid rgba(239,68,68,0.28)",
    color: "#fecaca",
    fontSize: "0.9rem"
  },
  footnote: {
    margin: 0,
    fontSize: "0.78rem",
    color: colors.textMuted,
    textAlign: "center" as const
  }
};
