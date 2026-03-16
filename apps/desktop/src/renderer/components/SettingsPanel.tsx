import { useEffect, useMemo, useRef, useState } from "react";
import type { RiskClass, RiskClassPolicy, RuntimeDescriptor, RuntimeSettings } from "../../shared/runtime";
import { colors, glass, shadows } from "../styles/tokens";
import {
  createDefaultRuntimeSettings,
  DEFAULT_ANTHROPIC_MODEL,
  OPUS_ANTHROPIC_MODEL
} from "../../shared/runtime";

const RISK_CLASSES: { key: RiskClass; label: string; description: string }[] = [
  { key: "financial", label: "Financial", description: "Purchases, payments, transfers, credit card entry" },
  { key: "credential", label: "Credentials", description: "Passwords, 2FA codes, CVVs, SSNs" },
  { key: "destructive", label: "Destructive", description: "Deletes, cancellations, revocations" },
  { key: "submission", label: "Submissions", description: "Form submits, confirmations, account creation" },
  { key: "navigation", label: "Navigation", description: "Page navigations and URL changes" },
  { key: "general", label: "General", description: "All other actions (catch-all)" }
];

interface Props {
  runtime: RuntimeDescriptor | null;
  settings: RuntimeSettings | null;
  onSaved: (settings: RuntimeSettings) => Promise<void> | void;
}

export function SettingsPanel({ runtime, settings, onSaved }: Props) {
  const [form, setForm] = useState<RuntimeSettings>(createDefaultRuntimeSettings());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const lastHydratedRef = useRef<string | null>(null);
  const serializedSettings = useMemo(() => (settings ? JSON.stringify(settings) : null), [settings]);

  useEffect(() => {
    // Only hydrate the form from the settings prop when:
    // 1. Settings have arrived and the user hasn't started editing (isDirty=false), AND
    // 2. The incoming settings value is actually different from the last value we hydrated.
    // This prevents a stale settings prop (not yet refreshed after a save) from overwriting
    // the form with the old value immediately after handleSave runs setIsDirty(false).
    if (settings && !isDirty && serializedSettings !== lastHydratedRef.current) {
      setForm(settings);
      lastHydratedRef.current = serializedSettings;
    }
  }, [isDirty, serializedSettings, settings]);

  const updateForm = (updater: (current: RuntimeSettings) => RuntimeSettings): void => {
    setForm((current) => {
      const next = updater(current);
      if (JSON.stringify(next) !== JSON.stringify(current)) {
        setIsDirty(true);
      }
      return next;
    });
  };

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const payload: RuntimeSettings = {
        ...form,
        plannerModel: form.plannerModel.trim() || DEFAULT_ANTHROPIC_MODEL
      };
      const result = await window.openbrowse.saveSettings(payload);
      // Update the form to the canonical saved values returned by the main process.
      // Do NOT update lastHydratedRef here: the settings prop hasn't refreshed yet, so
      // if we wrote the new value to lastHydratedRef now the useEffect (which fires when
      // isDirty becomes false) would see settings-prop != lastHydratedRef and would
      // overwrite the form with the stale pre-save settings prop value.
      // Instead we let the useEffect pick up the update once the prop refreshes via onSaved().
      setForm(result.settings);
      setIsDirty(false);
      setNotice("Settings saved. Runtime configuration has been refreshed.");
      await onSaved(result.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={styles.panel}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Settings</h2>
          <p style={styles.subtitle}>
            Configure Anthropic planner access, model selection, and Telegram bridge settings.
          </p>
        </div>
        <div style={styles.runtimeBadge}>
          planner: {runtime?.planner.mode ?? "loading"} / chat: {runtime?.chatBridge.mode ?? "loading"}
        </div>
      </div>

      <div style={styles.grid}>
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Anthropic Planner</h3>
          <label style={styles.label}>
            API Key
            <input
              type="password"
              value={form.anthropicApiKey}
              onChange={(e) => updateForm((current) => ({ ...current, anthropicApiKey: e.target.value }))}
              placeholder="sk-ant-..."
              style={styles.input}
            />
          </label>

          <label style={styles.label}>
            Quick Presets
            <div style={styles.presetRow}>
              <button
                type="button"
                onClick={() => updateForm((current) => ({ ...current, plannerModel: DEFAULT_ANTHROPIC_MODEL }))}
                style={styles.presetButton}
              >
                Sonnet
              </button>
              <button
                type="button"
                onClick={() => updateForm((current) => ({ ...current, plannerModel: OPUS_ANTHROPIC_MODEL }))}
                style={styles.presetButton}
              >
                Opus
              </button>
            </div>
          </label>

          <label style={styles.label}>
            Anthropic Model
            <input
              type="text"
              value={form.plannerModel}
              onChange={(e) => updateForm((current) => ({ ...current, plannerModel: e.target.value }))}
              placeholder={DEFAULT_ANTHROPIC_MODEL}
              style={styles.input}
            />
          </label>

          <p style={styles.helpText}>
            If you leave the model field blank, OpenBrowse falls back to the built-in Sonnet default.
          </p>
        </div>

        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Telegram Bridge</h3>
          <label style={styles.label}>
            Bot Token
            <input
              type="password"
              value={form.telegramBotToken}
              onChange={(e) => updateForm((current) => ({ ...current, telegramBotToken: e.target.value }))}
              placeholder="123456:ABC-DEF..."
              style={styles.input}
            />
          </label>
          <p style={styles.helpText}>
            Create a bot via @BotFather on Telegram. Paste the token here.
          </p>

          <label style={styles.label}>
            Your Telegram User ID
            <input
              type="text"
              value={form.telegramChatId}
              onChange={(e) => updateForm((current) => ({ ...current, telegramChatId: e.target.value }))}
              placeholder="e.g. 123456789"
              style={styles.input}
            />
          </label>

          <p style={styles.helpText}>
            <strong>Security:</strong> Setting your Telegram user ID locks the bot so only you can control it.
            Get your ID by messaging @userinfobot on Telegram.
            If left blank, the bot pairs with the first person who messages it (one-time auto-bind).
            Either way, only the bound user can send commands or receive clarification questions.
          </p>
        </div>

        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Approval Policies</h3>
          <p style={styles.helpText}>
            Configure how OpenBrowse handles approval for different risk categories.
            &ldquo;Default&rdquo; uses the standard risk-level logic. &ldquo;Always Ask&rdquo; always requires
            approval. &ldquo;Auto-Approve&rdquo; skips approval (unless the run is in strict mode).
          </p>
          {RISK_CLASSES.map(({ key, label, description }) => (
            <label key={key} style={styles.label}>
              {label}
              <select
                value={form.riskClassPolicies[key] ?? "default"}
                onChange={(e) => updateForm((current) => ({
                  ...current,
                  riskClassPolicies: {
                    ...current.riskClassPolicies,
                    [key]: e.target.value as RiskClassPolicy
                  }
                }))}
                style={styles.input}
              >
                <option value="default">Default</option>
                <option value="always_ask">Always Ask</option>
                <option value="auto_approve">Auto-Approve</option>
              </select>
              <span style={styles.helpText}>{description}</span>
            </label>
          ))}
        </div>
      </div>

      <div style={styles.actions}>
        <button onClick={handleSave} disabled={busy} style={styles.button} className="ob-btn-primary">
          {busy ? "Saving..." : "Save Settings"}
        </button>
        {isDirty && !busy && <span style={styles.dirtyHint}>Unsaved changes</span>}
      </div>

      {notice && <div style={styles.notice}>{notice}</div>}
      {error && <div style={styles.error}>{error}</div>}
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: 16
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16
  },
  title: {
    margin: 0,
    fontSize: "1.35rem"
  },
  subtitle: {
    margin: "6px 0 0",
    color: "#8f90a6",
    fontSize: "0.9rem"
  },
  runtimeBadge: {
    background: colors.bgInput,
    color: "#cbd5e1",
    border: "1px solid " + colors.borderDefault,
    borderRadius: 999,
    padding: "6px 12px",
    fontSize: "0.75rem",
    textTransform: "uppercase"
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 16
  },
  card: {
    ...glass.card,
    border: "1px solid " + colors.borderGlass,
    borderRadius: 18,
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 12
  } as React.CSSProperties,
  cardTitle: {
    margin: 0,
    fontSize: "1rem"
  },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: "0.85rem",
    color: "#cbd5e1"
  },
  input: {
    ...glass.input,
    border: "1px solid " + colors.borderGlass,
    borderRadius: 12,
    padding: "10px 12px",
    color: "#f5f5ff",
    fontSize: "0.9rem"
  } as React.CSSProperties,
  helpText: {
    margin: 0,
    fontSize: "0.8rem",
    color: "#8f90a6",
    lineHeight: 1.5
  },
  presetRow: {
    display: "flex",
    gap: 8
  },
  presetButton: {
    background: colors.bgInput,
    color: colors.textPrimary,
    border: "1px solid " + colors.borderDefault,
    borderRadius: 10,
    padding: "8px 12px",
    cursor: "pointer",
    fontSize: "0.82rem"
  },
  actions: {
    display: "flex",
    justifyContent: "flex-start",
    alignItems: "center",
    gap: 12
  },
  button: {
    background: colors.emerald,
    color: "#fffdf9",
    border: "1px solid " + colors.emeraldBorderHover,
    borderRadius: 12,
    padding: "10px 16px",
    cursor: "pointer",
    fontSize: "0.9rem",
    fontWeight: 700
  },
  notice: {
    padding: "10px 12px",
    borderRadius: 8,
    background: "rgba(34,197,94,0.12)",
    border: "1px solid rgba(34,197,94,0.28)",
    color: "#bbf7d0",
    fontSize: "0.9rem"
  },
  error: {
    padding: "10px 12px",
    borderRadius: 8,
    background: "rgba(239,68,68,0.12)",
    border: "1px solid rgba(239,68,68,0.28)",
    color: "#fecaca",
    fontSize: "0.9rem"
  },
  dirtyHint: {
    color: "#8f90a6",
    fontSize: "0.85rem"
  }
};
