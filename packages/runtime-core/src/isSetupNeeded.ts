import type { RuntimeSettings } from "@openbrowse/contracts";

/**
 * Determines whether the first-launch setup wizard should be shown.
 *
 * The wizard appears when:
 * 1. Settings have been loaded (not null)
 * 2. No Anthropic API key is configured
 * 3. The user hasn't previously dismissed the wizard
 */
export function isSetupNeeded(
  settings: RuntimeSettings | null,
  setupDismissed: boolean | null
): boolean {
  // Still loading — don't show yet
  if (settings === null || setupDismissed === null) return false;
  // User previously dismissed — don't show
  if (setupDismissed) return false;
  // API key already configured — don't show
  if (settings.anthropicApiKey.trim().length > 0) return false;
  return true;
}
