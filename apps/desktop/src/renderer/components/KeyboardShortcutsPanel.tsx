import { useCallback, useEffect, useRef, useState } from "react";
import { colors, glass } from "../styles/tokens";
import {
  DEFAULT_KEYBINDINGS,
  deserialiseOverrides,
  eventToCombo,
  formatCombo,
  serialiseOverrides,
  type KeyBindingOverrides,
  type KeyCombo
} from "../lib/keybindings";

interface Props {
  overrides: KeyBindingOverrides;
  onOverridesChanged: (overrides: KeyBindingOverrides) => void;
}

const CATEGORIES = [
  { key: "tabs", label: "Tabs" },
  { key: "navigation", label: "Navigation" },
  { key: "view", label: "View" },
  { key: "tools", label: "Tools" },
] as const;

export function KeyboardShortcutsPanel({ overrides, onOverridesChanged }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const captureRef = useRef<HTMLDivElement | null>(null);

  const effectiveCombo = (id: string, defaultCombo: KeyCombo): KeyCombo =>
    overrides[id] ?? defaultCombo;

  const isCustom = (id: string): boolean => id in overrides;

  const handleCapture = useCallback((e: KeyboardEvent) => {
    if (!editingId) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Escape") {
      setEditingId(null);
      return;
    }

    const combo = eventToCombo(e);
    if (!combo) return;

    // Find the default to check if this matches it
    const def = DEFAULT_KEYBINDINGS.find((b) => b.id === editingId);
    if (!def) return;

    const matchesDefault =
      combo.key === def.defaultCombo.key &&
      !!combo.meta === !!def.defaultCombo.meta &&
      !!combo.ctrl === !!def.defaultCombo.ctrl &&
      !!combo.shift === !!def.defaultCombo.shift &&
      !!combo.alt === !!def.defaultCombo.alt;

    const next = { ...overrides };
    if (matchesDefault) {
      delete next[editingId];
    } else {
      next[editingId] = combo;
    }

    onOverridesChanged(next);
    setEditingId(null);
  }, [editingId, overrides, onOverridesChanged]);

  useEffect(() => {
    if (!editingId) return;
    window.addEventListener("keydown", handleCapture, true);
    return () => window.removeEventListener("keydown", handleCapture, true);
  }, [editingId, handleCapture]);

  // Focus the capture element when editing starts
  useEffect(() => {
    if (editingId && captureRef.current) {
      captureRef.current.focus();
    }
  }, [editingId]);

  const handleReset = (id: string) => {
    const next = { ...overrides };
    delete next[id];
    onOverridesChanged(next);
  };

  const handleResetAll = () => {
    onOverridesChanged({});
  };

  const handleSave = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const entries = serialiseOverrides(overrides);
      // Also include a "__clear" signal: save empty values for any defaults NOT in overrides
      // so previous overrides get deleted. Actually, saveNamespaceSettings handles this:
      // we send ALL action IDs — overridden ones with JSON, default ones with empty string to delete.
      const allEntries = DEFAULT_KEYBINDINGS.map((def) => {
        const ov = overrides[def.id];
        return { key: def.id, value: ov ? JSON.stringify(ov) : "" };
      });
      await window.openbrowse.saveKeybindings(allEntries);
      setNotice("Shortcuts saved.");
      setTimeout(() => setNotice(null), 2000);
    } catch {
      setNotice("Failed to save shortcuts.");
    } finally {
      setSaving(false);
    }
  };

  const hasAnyOverrides = Object.keys(overrides).length > 0;

  return (
    <section style={styles.panel}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Keyboard Shortcuts</h2>
          <p style={styles.subtitle}>
            Click a binding to reassign it. Press Escape to cancel. Custom bindings persist across restarts.
          </p>
        </div>
        <div style={styles.headerActions}>
          {hasAnyOverrides && (
            <button onClick={handleResetAll} style={styles.resetAllBtn} className="ob-btn">
              Reset All
            </button>
          )}
          <button onClick={handleSave} disabled={saving} style={styles.saveBtn} className="ob-btn-primary">
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {notice && <div style={styles.notice}>{notice}</div>}

      {CATEGORIES.map(({ key: cat, label }) => {
        const bindings = DEFAULT_KEYBINDINGS.filter((b) => b.category === cat);
        if (bindings.length === 0) return null;
        return (
          <div key={cat} style={styles.categorySection}>
            <h3 style={styles.categoryTitle}>{label}</h3>
            <div style={styles.bindingList}>
              {bindings.map((def) => {
                const combo = effectiveCombo(def.id, def.defaultCombo);
                const custom = isCustom(def.id);
                const isEditing = editingId === def.id;

                return (
                  <div key={def.id} style={styles.bindingRow}>
                    <span style={styles.bindingLabel}>{def.label}</span>
                    <div style={styles.bindingRight}>
                      {isEditing ? (
                        <div
                          ref={captureRef}
                          tabIndex={0}
                          style={styles.captureBox}
                        >
                          Press a key combo...
                        </div>
                      ) : (
                        <button
                          onClick={() => setEditingId(def.id)}
                          style={{
                            ...styles.comboBtn,
                            ...(custom ? styles.comboBtnCustom : {})
                          }}
                        >
                          {formatCombo(combo)}
                        </button>
                      )}
                      {custom && !isEditing && (
                        <button
                          onClick={() => handleReset(def.id)}
                          style={styles.resetBtn}
                          title="Reset to default"
                        >
                          ↺
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** Load keybinding overrides from the main process on mount. */
export async function loadKeybindingOverrides(): Promise<KeyBindingOverrides> {
  try {
    const entries = await window.openbrowse.getKeybindings();
    return deserialiseOverrides(entries);
  } catch {
    return {};
  }
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
  },
  title: {
    margin: 0,
    fontSize: "1.35rem",
  },
  subtitle: {
    margin: "6px 0 0",
    color: colors.textSecondary,
    fontSize: "0.9rem",
  },
  headerActions: {
    display: "flex",
    gap: 8,
    flexShrink: 0,
  },
  saveBtn: {
    background: colors.emerald,
    color: colors.textWarm,
    border: "1px solid " + colors.emeraldBorderHover,
    borderRadius: 12,
    padding: "8px 14px",
    cursor: "pointer",
    fontSize: "0.85rem",
    fontWeight: 700,
  },
  resetAllBtn: {
    background: "transparent",
    color: colors.textSecondary,
    border: "1px solid " + colors.borderDefault,
    borderRadius: 12,
    padding: "8px 14px",
    cursor: "pointer",
    fontSize: "0.85rem",
  },
  notice: {
    padding: "8px 12px",
    borderRadius: 8,
    background: "rgba(34,197,94,0.12)",
    border: "1px solid rgba(34,197,94,0.28)",
    color: "#bbf7d0",
    fontSize: "0.85rem",
  },
  categorySection: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  categoryTitle: {
    margin: 0,
    fontSize: "0.82rem",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: colors.textSecondary,
  },
  bindingList: {
    ...glass.card,
    border: "1px solid " + colors.borderSubtle,
    borderRadius: 14,
    padding: "4px 0",
    display: "flex",
    flexDirection: "column",
  } as React.CSSProperties,
  bindingRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 16px",
    borderBottom: "1px solid " + colors.borderSubtle,
  },
  bindingLabel: {
    fontSize: "0.9rem",
    color: colors.textPrimary,
  },
  bindingRight: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  comboBtn: {
    ...glass.control,
    border: "1px solid " + colors.borderDefault,
    borderRadius: 8,
    padding: "5px 12px",
    color: colors.textBright,
    fontSize: "0.85rem",
    fontFamily: "system-ui, sans-serif",
    cursor: "pointer",
    minWidth: 60,
    textAlign: "center" as const,
  } as React.CSSProperties,
  comboBtnCustom: {
    borderColor: colors.emerald,
    color: colors.emerald,
  },
  captureBox: {
    ...glass.input,
    border: "2px solid " + colors.emerald,
    borderRadius: 8,
    padding: "5px 12px",
    color: colors.emerald,
    fontSize: "0.82rem",
    minWidth: 140,
    textAlign: "center" as const,
    outline: "none",
  } as React.CSSProperties,
  resetBtn: {
    background: "transparent",
    border: "none",
    color: colors.textSecondary,
    cursor: "pointer",
    fontSize: "1rem",
    padding: "2px 4px",
    borderRadius: 4,
  },
};
