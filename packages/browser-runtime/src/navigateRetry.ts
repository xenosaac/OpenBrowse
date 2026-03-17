import type { BrowserActionFailureClass } from "@openbrowse/contracts";

const RETRYABLE_FAILURE_CLASSES: ReadonlySet<BrowserActionFailureClass> = new Set([
  "network_error",
  "navigation_timeout"
]);

const DEFAULT_RETRY_DELAY_MS = 2_000;

/**
 * Wrap a navigation attempt with a single automatic retry for transient failures.
 *
 * If the first attempt fails with a retryable failure class (network_error,
 * navigation_timeout), waits `retryDelayMs` then retries once. If the retry
 * also fails, the **retry** error is thrown (preserves the most recent failure
 * message). Non-retryable failures (validation_error, element_not_found, etc.)
 * are re-thrown immediately without retry.
 *
 * @param loadFn        Async function that performs the navigation (may throw).
 * @param classifyFn    Classifies an error message into a BrowserActionFailureClass.
 * @param retryDelayMs  Delay in ms before the retry attempt (default 2000).
 * @returns             Resolves when the navigation succeeds.
 */
export async function navigateWithRetry(
  loadFn: () => Promise<void>,
  classifyFn: (message: string) => BrowserActionFailureClass,
  retryDelayMs: number = DEFAULT_RETRY_DELAY_MS
): Promise<void> {
  try {
    await loadFn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failureClass = classifyFn(message);

    if (!RETRYABLE_FAILURE_CLASSES.has(failureClass)) {
      throw err;
    }

    // Wait before retry
    await new Promise((r) => setTimeout(r, retryDelayMs));

    // Retry once — if this throws, caller handles it
    await loadFn();
  }
}
