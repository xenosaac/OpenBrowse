import type { ApprovalRequest, BrowserAction, TaskRun } from "@openbrowse/contracts";

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type ApprovalMode = "strict" | "auto" | "default";
export type ApprovalOutcome = "approved" | "denied" | "denied_continue";

export interface ApprovalPolicy {
  requiresApproval(run: TaskRun, action: BrowserAction): boolean;
  buildApprovalRequest(run: TaskRun, action: BrowserAction): ApprovalRequest;
  classifyRisk(run: TaskRun, action: BrowserAction): RiskLevel;
  resolveDenial(run: TaskRun, action: BrowserAction): ApprovalOutcome;
}

// ---------------------------------------------------------------------------
// Keyword sets
// ---------------------------------------------------------------------------

const FINALIZE_KEYWORDS = [
  "submit",
  "purchase",
  "pay",
  "confirm",
  "checkout",
  "buy",
  "book now",
  "place order",
  "send",
  "transfer",
  "authorize",
  "subscribe",
  "create account",
  "sign up"
];

const DESTRUCTIVE_KEYWORDS = [
  "delete",
  "remove",
  "cancel order",
  "unsubscribe",
  "revoke",
  "disconnect"
];

const SENSITIVE_FIELD_KEYWORDS = [
  "password",
  "passcode",
  "verification code",
  "2fa",
  "otp",
  "credit card",
  "card number",
  "cvv",
  "security code",
  "bank account",
  "routing number",
  "ssn"
];

const CRITICAL_KEYWORDS = [
  "purchase",
  "pay",
  "checkout",
  "buy",
  "place order",
  "transfer",
  "credit card",
  "bank account",
  "ssn"
];

const HIGH_KEYWORDS = [
  "submit",
  "confirm",
  "book now",
  "authorize",
  "subscribe",
  "create account",
  "sign up",
  "send",
  "delete",
  "remove",
  "cancel order",
  "revoke",
  "disconnect",
  "password",
  "passcode",
  "cvv",
  "security code",
  "routing number"
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeActionText(action: BrowserAction): string {
  return [
    action.description,
    action.value
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function collectApprovalReasons(run: TaskRun, action: BrowserAction): string[] {
  const text = normalizeActionText(action);
  const reasons = new Set<string>();

  if (action.type === "click" || action.type === "select") {
    if (FINALIZE_KEYWORDS.some((kw) => text.includes(kw))) {
      reasons.add("this looks like a finalizing action");
    }

    if (DESTRUCTIVE_KEYWORDS.some((kw) => text.includes(kw))) {
      reasons.add("this looks destructive or hard to undo");
    }
  }

  if (action.type === "navigate") {
    if (FINALIZE_KEYWORDS.some((kw) => text.includes(kw))) {
      reasons.add("this navigation may lead directly into a checkout or confirmation step");
    }
  }

  if (action.type === "type") {
    if (SENSITIVE_FIELD_KEYWORDS.some((kw) => text.includes(kw))) {
      reasons.add("this field appears to contain sensitive credentials or payment data");
    }
  }

  if (run.metadata.approval_mode === "strict") {
    reasons.add("this run is configured for strict approval mode");
  }

  return [...reasons];
}

function resolveApprovalMode(run: TaskRun): ApprovalMode {
  const mode = run.metadata.approval_mode;
  if (mode === "strict" || mode === "auto" || mode === "default") {
    return mode;
  }
  return "default";
}

// ---------------------------------------------------------------------------
// Default implementation
// ---------------------------------------------------------------------------

export class DefaultApprovalPolicy implements ApprovalPolicy {
  classifyRisk(run: TaskRun, action: BrowserAction): RiskLevel {
    const text = normalizeActionText(action);

    // Critical: financial transactions, payment data
    if (CRITICAL_KEYWORDS.some((kw) => text.includes(kw))) {
      return "critical";
    }

    // High: irreversible actions, sensitive credentials
    if (HIGH_KEYWORDS.some((kw) => text.includes(kw))) {
      return "high";
    }

    // Medium: any action that triggered at least one approval reason
    const reasons = collectApprovalReasons(run, action);
    if (reasons.length > 0) {
      return "medium";
    }

    return "low";
  }

  requiresApproval(run: TaskRun, action: BrowserAction): boolean {
    const mode = resolveApprovalMode(run);
    const risk = this.classifyRisk(run, action);

    switch (mode) {
      case "strict":
        // Approve everything except purely low-risk reads
        return true;

      case "auto":
        // Only approve critical actions
        return risk === "critical";

      case "default":
      default:
        // Approve medium and above (original behavior)
        return risk !== "low";
    }
  }

  buildApprovalRequest(run: TaskRun, action: BrowserAction): ApprovalRequest {
    const reasons = collectApprovalReasons(run, action);
    const risk = this.classifyRisk(run, action);
    const riskLabel = risk.toUpperCase();
    const reasonSummary =
      reasons.length > 0
        ? reasons.map((reason) => reason[0].toUpperCase() + reason.slice(1)).join("; ")
        : "This action may be irreversible.";
    const targetSummary = action.targetId ? ` on ${action.targetId}` : "";

    return {
      id: `approval_${run.id}_${Date.now()}`,
      runId: run.id,
      question: `[${riskLabel}] OpenBrowse is ready to ${action.description}${targetSummary} for "${run.goal}". Approve this step?`,
      irreversibleActionSummary: `${action.type}: ${action.description}. ${reasonSummary}`,
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Determines what happens when the user denies an approval.
   *
   * - `"denied"`: cancel the run entirely (default for critical/high risk)
   * - `"denied_continue"`: deny the specific action but let the planner
   *    try an alternative (default for medium/low risk with room to adapt)
   */
  resolveDenial(run: TaskRun, action: BrowserAction): ApprovalOutcome {
    const risk = this.classifyRisk(run, action);

    // Critical or high-risk denials always cancel - no recovery possible
    if (risk === "critical" || risk === "high") {
      return "denied";
    }

    // Medium-risk: allow the planner to try something else
    return "denied_continue";
  }
}

