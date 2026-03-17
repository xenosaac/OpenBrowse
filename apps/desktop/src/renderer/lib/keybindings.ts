/**
 * Keyboard shortcut registry — defines all bindable actions, their default
 * key combos, and helpers for matching KeyboardEvents against bindings.
 *
 * Bindings are persisted in PreferenceStore under the "keybindings" namespace.
 * Each preference key is an action ID, the value is a serialised KeyCombo JSON string.
 */

// --- Types ---

export interface KeyCombo {
  /** The `KeyboardEvent.key` value (lowercased). */
  key: string;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface KeyBindingDef {
  id: string;
  label: string;
  /** Category for grouping in the UI. */
  category: "tabs" | "navigation" | "view" | "tools";
  /** Whether this binding requires an active browser tab to fire. */
  requiresBrowserTab: boolean;
  defaultCombo: KeyCombo;
}

export type KeyBindingOverrides = Record<string, KeyCombo>;

// --- Default Registry ---

export const DEFAULT_KEYBINDINGS: KeyBindingDef[] = [
  // Tabs
  { id: "newTab", label: "New Tab", category: "tabs", requiresBrowserTab: false, defaultCombo: { key: "t", meta: true } },
  { id: "closeTab", label: "Close Tab", category: "tabs", requiresBrowserTab: false, defaultCombo: { key: "w", meta: true } },
  { id: "reopenClosedTab", label: "Reopen Closed Tab", category: "tabs", requiresBrowserTab: false, defaultCombo: { key: "t", meta: true, shift: true } },

  // Navigation (requires browser tab)
  { id: "reload", label: "Reload", category: "navigation", requiresBrowserTab: true, defaultCombo: { key: "r", meta: true } },
  { id: "back", label: "Back", category: "navigation", requiresBrowserTab: true, defaultCombo: { key: "[", meta: true } },
  { id: "forward", label: "Forward", category: "navigation", requiresBrowserTab: true, defaultCombo: { key: "]", meta: true } },

  // View
  { id: "focusAddressBar", label: "Focus Address Bar", category: "tools", requiresBrowserTab: false, defaultCombo: { key: "l", meta: true } },
  { id: "findInPage", label: "Find in Page", category: "tools", requiresBrowserTab: false, defaultCombo: { key: "f", meta: true } },

  // Zoom (requires browser tab)
  { id: "zoomIn", label: "Zoom In", category: "view", requiresBrowserTab: true, defaultCombo: { key: "=", meta: true } },
  { id: "zoomOut", label: "Zoom Out", category: "view", requiresBrowserTab: true, defaultCombo: { key: "-", meta: true } },
  { id: "zoomReset", label: "Reset Zoom", category: "view", requiresBrowserTab: true, defaultCombo: { key: "0", meta: true } },
];

// --- Helpers ---

/** Build an effective binding map by merging defaults with user overrides. */
export function resolveBindings(overrides: KeyBindingOverrides): Map<string, KeyCombo> {
  const map = new Map<string, KeyCombo>();
  for (const def of DEFAULT_KEYBINDINGS) {
    map.set(def.id, overrides[def.id] ?? def.defaultCombo);
  }
  return map;
}

/** Check if a KeyboardEvent matches a KeyCombo. */
export function matchesCombo(e: KeyboardEvent, combo: KeyCombo): boolean {
  if (e.key.toLowerCase() !== combo.key.toLowerCase()) return false;
  if (!!combo.meta !== e.metaKey) return false;
  if (!!combo.ctrl !== e.ctrlKey) return false;
  if (!!combo.shift !== e.shiftKey) return false;
  if (!!combo.alt !== e.altKey) return false;
  return true;
}

/** Human-readable display string for a KeyCombo. */
export function formatCombo(combo: KeyCombo): string {
  const parts: string[] = [];
  if (combo.ctrl) parts.push("Ctrl");
  if (combo.meta) parts.push("\u2318");  // ⌘
  if (combo.alt) parts.push("\u2325");   // ⌥
  if (combo.shift) parts.push("\u21E7"); // ⇧
  // Display-friendly key names
  const keyDisplay = KEY_DISPLAY_MAP[combo.key.toLowerCase()] ?? combo.key.toUpperCase();
  parts.push(keyDisplay);
  return parts.join("");
}

const KEY_DISPLAY_MAP: Record<string, string> = {
  "=": "+",
  "-": "\u2013", // –
  "[": "[",
  "]": "]",
  " ": "Space",
  "enter": "\u21A9", // ↩
  "escape": "Esc",
  "backspace": "\u232B", // ⌫
  "delete": "\u2326", // ⌦
  "arrowup": "\u2191",
  "arrowdown": "\u2193",
  "arrowleft": "\u2190",
  "arrowright": "\u2192",
  "tab": "\u21E5", // ⇥
};

/** Convert a KeyboardEvent to a KeyCombo (for the capture UI). */
export function eventToCombo(e: KeyboardEvent): KeyCombo | null {
  // Ignore bare modifier presses
  if (["Meta", "Control", "Alt", "Shift"].includes(e.key)) return null;
  // Require at least one modifier
  if (!e.metaKey && !e.ctrlKey && !e.altKey) return null;
  return {
    key: e.key.toLowerCase(),
    ...(e.metaKey ? { meta: true } : {}),
    ...(e.ctrlKey ? { ctrl: true } : {}),
    ...(e.shiftKey ? { shift: true } : {}),
    ...(e.altKey ? { alt: true } : {}),
  };
}

/** Serialise overrides to the format PreferenceStore expects. */
export function serialiseOverrides(overrides: KeyBindingOverrides): Array<{ key: string; value: string }> {
  return Object.entries(overrides).map(([actionId, combo]) => ({
    key: actionId,
    value: JSON.stringify(combo),
  }));
}

/** Deserialise preference entries back to overrides. */
export function deserialiseOverrides(entries: Array<{ key: string; value: string }>): KeyBindingOverrides {
  const overrides: KeyBindingOverrides = {};
  for (const { key, value } of entries) {
    try {
      overrides[key] = JSON.parse(value) as KeyCombo;
    } catch {
      // Skip malformed entries
    }
  }
  return overrides;
}
