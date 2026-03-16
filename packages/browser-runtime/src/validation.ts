import type { BrowserActionFailureClass } from "@openbrowse/contracts";

const ELEMENT_TARGET_ID_RE = /^el_(\d+)$/;
const ALLOWED_URL_SCHEMES = new Set(["http:", "https:", "about:"]);

/**
 * Parse an `el_<N>` target ID and return the numeric index.
 * Throws if the format is invalid.
 */
export function validateElementTargetId(targetId: string): number {
  const match = ELEMENT_TARGET_ID_RE.exec(targetId);
  if (!match) {
    throw new Error(`Invalid element target ID: ${targetId}`);
  }
  return Number(match[1]);
}

/**
 * Accept only http:, https:, and about: URLs.
 * Rejects javascript:, data:, file:, etc.
 */
export function validateUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (!ALLOWED_URL_SCHEMES.has(parsed.protocol)) {
    throw new Error(`Disallowed URL scheme: ${parsed.protocol}`);
  }

  return parsed.href;
}

/**
 * Normalize scroll direction to "up" or "down".
 */
export function validateScrollDirection(value: string): "up" | "down" {
  const normalized = value.trim().toLowerCase();
  if (normalized === "up") return "up";
  if (normalized === "down") return "down";
  throw new Error(`Invalid scroll direction: ${value}`);
}

/**
 * Classify an error message into a BrowserActionFailureClass.
 * Used by ElectronBrowserKernel to tag failed browser actions for planner feedback
 * and stuck-detection in RunExecutor.
 */
export function classifyFailure(message: string): BrowserActionFailureClass {
  if (message.includes("Target not found") || message.includes("not found")) return "element_not_found";
  if (message.includes("timed out") || message.includes("timeout")) return "navigation_timeout";
  if (message.includes("Invalid") || message.includes("Disallowed")) return "validation_error";
  if (message.includes("ERR_NAME_NOT_RESOLVED") || message.includes("ERR_CONNECTION_REFUSED")
    || message.includes("ERR_INTERNET_DISCONNECTED") || message.includes("ERR_NETWORK")
    || message.includes("ERR_SSL") || message.includes("ERR_ABORTED")
    || message.includes("ERR_BLOCKED") || message.includes("net::ERR_")) return "network_error";
  return "interaction_failed";
}

/** Parsed result of a keyboard shortcut string like "Ctrl+Shift+A". */
export interface ParsedKeyboardShortcut {
  /** CDP modifier bitmask (Alt=1, Ctrl=2, Shift=4, Meta/Cmd=8). */
  modifiers: number;
  /** The resolved key name (e.g. "Return", "Escape", "a"). */
  key: string;
}

const MODIFIER_BITS: Record<string, number> = { ctrl: 2, shift: 4, alt: 1, meta: 8, cmd: 8 };
const KEY_NAMES: Record<string, string> = {
  enter: "Return", escape: "Escape", tab: "Tab", backspace: "Backspace",
  delete: "Delete", arrowup: "ArrowUp", arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft", arrowright: "ArrowRight", space: " "
};

/**
 * Parse a keyboard shortcut string (e.g. "Ctrl+Shift+A") into a CDP-compatible
 * modifier bitmask and key name.
 */
export function parseKeyboardShortcut(shortcut: string): ParsedKeyboardShortcut {
  const parts = shortcut.split("+").map((p) => p.trim());
  let modifiers = 0;
  let key = "";
  for (const part of parts) {
    const lp = part.toLowerCase();
    if (lp in MODIFIER_BITS) {
      modifiers |= MODIFIER_BITS[lp];
    } else {
      key = KEY_NAMES[lp] ?? part;
    }
  }
  return { modifiers, key };
}
