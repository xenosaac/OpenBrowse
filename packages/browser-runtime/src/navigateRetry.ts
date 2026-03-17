import type { BrowserActionFailureClass } from "@openbrowse/contracts";

const RETRYABLE_FAILURE_CLASSES: ReadonlySet<BrowserActionFailureClass> = new Set([
  "network_error",
  "navigation_timeout"
]);

const DEFAULT_BASE_DELAY_MS = 2_000;
const DEFAULT_MAX_RETRIES = 2;

/**
 * Wrap a navigation attempt with automatic retries for transient failures.
 *
 * If an attempt fails with a retryable failure class (network_error,
 * navigation_timeout), waits with exponential backoff and retries.
 * Backoff schedule: baseDelayMs * 2^(attempt-1), e.g. 2s, 4s for defaults.
 * Non-retryable failures are re-thrown immediately without retry.
 *
 * @param loadFn        Async function that performs the navigation (may throw).
 * @param classifyFn    Classifies an error message into a BrowserActionFailureClass.
 * @param baseDelayMs   Base delay in ms before the first retry (default 2000).
 * @param maxRetries    Maximum number of retries after the initial attempt (default 2).
 * @returns             Resolves when the navigation succeeds.
 */
export async function navigateWithRetry(
  loadFn: () => Promise<void>,
  classifyFn: (message: string) => BrowserActionFailureClass,
  baseDelayMs: number = DEFAULT_BASE_DELAY_MS,
  maxRetries: number = DEFAULT_MAX_RETRIES
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await loadFn();
      return; // success
    } catch (err) {
      lastError = err;

      // Don't retry if we've exhausted all retries
      if (attempt === maxRetries) break;

      const message = err instanceof Error ? err.message : String(err);
      const failureClass = classifyFn(message);

      if (!RETRYABLE_FAILURE_CLASSES.has(failureClass)) {
        throw err;
      }

      // Exponential backoff: baseDelay * 2^attempt (attempt 0 = baseDelay, attempt 1 = baseDelay*2)
      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError;
}
