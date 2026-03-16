// Design tokens — single source of truth for all visual constants.
// Every component imports from here instead of hardcoding hex values.

export const colors = {
  // Backgrounds (flat dark base — content behind the glass)
  bgBase: "#0a0a10",
  bgSurface: "#0e0e14",
  bgElevated: "#111118",
  bgInput: "#131320",
  bgOverlay: "rgba(0,0,0,0.58)",

  // Borders
  borderSubtle: "rgba(255,255,255,0.06)",
  borderDefault: "rgba(255,255,255,0.10)",
  borderHover: "rgba(255,255,255,0.12)",
  borderGlass: "rgba(255,255,255,0.18)",
  borderGlassHover: "rgba(255,255,255,0.28)",

  // Text
  textPrimary: "#e8e8f0",
  textSecondary: "#9090a8",
  textMuted: "#6b6b82",
  textWhite: "#ffffff",

  // Emerald accent
  emerald: "#10b981",
  emeraldHover: "#34d399",
  emeraldActive: "#059669",
  emeraldTint: "rgba(16,185,129,0.08)",
  emeraldTintStrong: "rgba(16,185,129,0.12)",
  emeraldBorder: "rgba(16,185,129,0.15)",
  emeraldBorderHover: "rgba(16,185,129,0.25)",
  emeraldGlow: "0 0 16px rgba(16,185,129,0.1)",
  emeraldGlowStrong: "0 0 24px rgba(16,185,129,0.15)",

  // Status
  statusRunning: "#10b981",
  statusWaiting: "#f59e0b",
  statusFailed: "#ef4444",

  // Button rest state
  buttonBg: "rgba(255,255,255,0.04)",
  buttonBorder: "rgba(255,255,255,0.1)",
} as const;

export const radii = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 14,
  pill: 999,
} as const;

export const transitions = {
  fast: "150ms cubic-bezier(0.4, 0, 0.2, 1)",
  default: "200ms cubic-bezier(0.4, 0, 0.2, 1)",
  slow: "300ms cubic-bezier(0.4, 0, 0.2, 1)",
} as const;

// Authentic Liquid Glass presets — tiered by element role.
// Each tier uses backdrop-filter + saturate for vibrancy.
export const glass = {
  // Panels: sidebar, nav bar, tab bar — major structural surfaces
  panel: {
    background: "rgba(14, 14, 20, 0.72)",
    backdropFilter: "blur(20px) saturate(180%)",
    WebkitBackdropFilter: "blur(20px) saturate(180%)",
  },
  // Cards: message bubbles, recent tabs, task cards — content containers
  card: {
    background: "rgba(17, 17, 24, 0.6)",
    backdropFilter: "blur(12px) saturate(150%)",
    WebkitBackdropFilter: "blur(12px) saturate(150%)",
  },
  // Inputs: address bar, chat composer, form fields
  input: {
    background: "rgba(19, 19, 32, 0.55)",
    backdropFilter: "blur(12px) saturate(150%)",
    WebkitBackdropFilter: "blur(12px) saturate(150%)",
  },
  // Emerald-tinted glass: active tabs, user bubbles, primary highlights
  emerald: {
    background: "rgba(16, 185, 129, 0.1)",
    backdropFilter: "blur(16px) saturate(180%)",
    WebkitBackdropFilter: "blur(16px) saturate(180%)",
    border: "1px solid rgba(16, 185, 129, 0.2)",
  },
  // Heavy overlay: management panel backdrop, modals
  overlay: {
    background: "rgba(0, 0, 0, 0.45)",
    backdropFilter: "blur(24px) saturate(180%)",
    WebkitBackdropFilter: "blur(24px) saturate(180%)",
  },
} as const;

// Layered shadows for glass depth — inset highlight + outer shadow.
export const shadows = {
  glass: "0 8px 32px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.08)",
  glassSubtle: "0 4px 16px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)",
  glassElevated: "0 12px 48px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.1)",
} as const;
