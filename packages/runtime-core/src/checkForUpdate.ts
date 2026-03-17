/**
 * Auto-update check — compares the current app version against the latest
 * GitHub release tag. Returns update info if a newer version exists.
 *
 * Pure version comparison is exported separately for testability.
 */

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  releaseName: string;
}

/**
 * Parse a semver-like version string into [major, minor, patch].
 * Strips leading "v" if present. Returns [0, 0, 0] on parse failure.
 */
export function parseSemver(version: string): [number, number, number] {
  const cleaned = version.trim().replace(/^v/, "");
  const parts = cleaned.split(".");
  const major = parseInt(parts[0] ?? "", 10);
  const minor = parseInt(parts[1] ?? "0", 10);
  const patch = parseInt(parts[2] ?? "0", 10);
  if (isNaN(major)) return [0, 0, 0];
  return [major, isNaN(minor) ? 0 : minor, isNaN(patch) ? 0 : patch];
}

/**
 * Returns true if `latest` is strictly newer than `current`.
 */
export function isNewerVersion(current: string, latest: string): boolean {
  const [cMaj, cMin, cPat] = parseSemver(current);
  const [lMaj, lMin, lPat] = parseSemver(latest);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}

/**
 * Check GitHub Releases for a newer version. Returns update info.
 *
 * Uses the GitHub REST API (no auth required for public repos).
 * Fails gracefully — returns `{ available: false }` on any error.
 */
export async function checkForUpdate(
  currentVersion: string,
  owner: string,
  repo: string
): Promise<UpdateInfo> {
  const noUpdate: UpdateInfo = {
    available: false,
    currentVersion,
    latestVersion: currentVersion,
    releaseUrl: "",
    releaseName: "",
  };

  try {
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/latest`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(url, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return noUpdate;

    const data = (await response.json()) as {
      tag_name?: string;
      html_url?: string;
      name?: string;
    };

    const latestTag = data.tag_name ?? "";
    if (!latestTag) return noUpdate;

    const newer = isNewerVersion(currentVersion, latestTag);

    return {
      available: newer,
      currentVersion,
      latestVersion: latestTag.replace(/^v/, ""),
      releaseUrl: data.html_url ?? "",
      releaseName: data.name ?? latestTag,
    };
  } catch {
    // Network error, timeout, aborted, invalid JSON — all graceful.
    return noUpdate;
  }
}
