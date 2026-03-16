/**
 * Parses a user's free-text response to an approval request.
 *
 * Returns:
 * - `true` for affirmative answers (approve, yes, ok, etc.)
 * - `false` for negative answers (deny, no, cancel, etc.)
 * - `null` when the answer is ambiguous or unrecognized
 */
export function parseApprovalAnswer(answer: string): boolean | null {
  const normalized = answer.trim().toLowerCase();
  if (["approve", "approved", "yes", "y", "ok", "allow", "go"].includes(normalized)) return true;
  if (["deny", "denied", "no", "n", "block", "cancel", "stop"].includes(normalized)) return false;
  return null;
}
