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
