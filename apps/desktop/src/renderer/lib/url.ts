export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "about:blank";
  if (/^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed)) return trimmed;
  if (/^about:|^data:|^file:/i.test(trimmed)) return trimmed;
  if (!trimmed.includes(" ") && (trimmed.includes(".") || trimmed.startsWith("localhost"))) {
    return `https://${trimmed}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}
