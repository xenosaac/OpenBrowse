import type { ApprovalRequest, BrowserAction, RiskClass, RiskClassPolicies, TaskRun } from "@openbrowse/contracts";

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type ApprovalMode = "strict" | "auto" | "default";
export type ApprovalOutcome = "approved" | "denied" | "denied_continue";

export interface ApprovalPolicy {
  requiresApproval(run: TaskRun, action: BrowserAction): boolean;
  buildApprovalRequest(run: TaskRun, action: BrowserAction): ApprovalRequest;
  classifyRisk(run: TaskRun, action: BrowserAction): RiskLevel;
  classifyRiskClass(run: TaskRun, action: BrowserAction): RiskClass;
  resolveDenial(run: TaskRun, action: BrowserAction): ApprovalOutcome;
}

export interface ApprovalPolicyConfig {
  riskClassPolicies?: RiskClassPolicies;
}

// ---------------------------------------------------------------------------
// Keyword sets — used by classifyRisk() (risk LEVEL: low/medium/high/critical)
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
// Risk CLASS keyword sets — used by classifyRiskClass() (orthogonal to level)
// ---------------------------------------------------------------------------

const RISK_CLASS_KEYWORDS: Record<Exclude<RiskClass, "navigation" | "general">, string[]> = {
  financial: ["purchase", "pay", "checkout", "buy", "place order", "transfer", "credit card", "card number", "bank account", "routing number"],
  credential: ["password", "passcode", "verification code", "2fa", "otp", "cvv", "security code", "ssn"],
  destructive: ["delete", "remove", "cancel order", "unsubscribe", "revoke", "disconnect"],
  submission: ["submit", "confirm", "book now", "authorize", "subscribe", "create account", "sign up", "send"]
};

/** Priority order: highest-risk class wins when multiple match. */
const RISK_CLASS_PRIORITY: RiskClass[] = ["financial", "credential", "destructive", "submission", "navigation", "general"];

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

function detectRiskClasses(action: BrowserAction): RiskClass[] {
  const text = normalizeActionText(action);
  const matched: RiskClass[] = [];

  if (action.type === "navigate") {
    matched.push("navigation");
  }

  for (const [cls, keywords] of Object.entries(RISK_CLASS_KEYWORDS) as [RiskClass, string[]][]) {
    if (keywords.some((kw) => text.includes(kw))) {
      matched.push(cls);
    }
  }

  return matched.length > 0 ? matched : ["general"];
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
  private readonly classPolicies: RiskClassPolicies;

  constructor(config?: ApprovalPolicyConfig) {
    this.classPolicies = config?.riskClassPolicies ?? {};
  }

  classifyRiskClass(_run: TaskRun, action: BrowserAction): RiskClass {
    const classes = detectRiskClasses(action);
    for (const cls of RISK_CLASS_PRIORITY) {
      if (classes.includes(cls)) return cls;
    }
    return "general";
  }

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
    const riskClass = this.classifyRiskClass(run, action);
    const classPolicy = this.classPolicies[riskClass] ?? "default";

    // Per-class "always_ask" overrides everything
    if (classPolicy === "always_ask") {
      return true;
    }

    // Per-class "auto_approve" takes effect unless per-run mode is "strict"
    if (classPolicy === "auto_approve") {
      return mode === "strict";
    }

    // "default" falls through to existing risk-level + run-mode logic
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
    const riskClass = this.classifyRiskClass(run, action);
    const riskLabel = risk.toUpperCase();
    const classLabel = riskClass.toUpperCase();
    const reasonSummary =
      reasons.length > 0
        ? reasons.map((reason) => reason[0].toUpperCase() + reason.slice(1)).join("; ")
        : "This action may be irreversible.";
    const targetSummary = action.targetId ? ` on ${action.targetId}` : "";

    return {
      id: `approval_${run.id}_${Date.now()}`,
      runId: run.id,
      question: `[${riskLabel}:${classLabel}] OpenBrowse is ready to ${action.description}${targetSummary} for "${run.goal}". Approve this step?`,
      irreversibleActionSummary: `${action.type}: ${action.description}. ${reasonSummary}`,
      riskClass,
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
