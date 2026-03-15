import type { PageModel, TaskRun } from "@openbrowse/contracts";

export interface PlannerPrompt {
  system: string;
  user: string;
}

const MAX_STEPS = 20;

export function buildPlannerPrompt(run: TaskRun, pageModel: PageModel): PlannerPrompt {
  // --- Harness context ---
  const stepCount = run.checkpoint.stepCount ?? 0;
  const actionHistory = run.checkpoint.actionHistory ?? [];
  const softFailures = run.checkpoint.consecutiveSoftFailures ?? 0;

  const actionHistorySection = actionHistory.length > 0
    ? `\nActions already taken (${actionHistory.length}, most recent last):\n${actionHistory.map((r) => {
        const status = r.ok ? "OK" : `FAILED (${r.failureClass ?? "failed"})`;
        return `  Step ${r.step}: ${r.type} — "${r.description}" ${status}`;
      }).join("\n")}`
    : "";

  const softFailureWarning = softFailures > 0
    ? `\n** WARNING: The last ${softFailures} action(s) failed with "element not found". The target may have moved, not loaded yet, or not exist on this page. Try a different approach: scroll to reveal it, navigate directly via its href, or reassess what page you are on.`
    : "";

  // --- Elements (up to 80, prioritize actionable + visible) ---
  const sortedElements = [...pageModel.elements].sort((a, b) => {
    // Prioritize: actionable + visible > actionable > visible > others
    const scoreA = (a.isActionable ? 2 : 0) + (a.boundingVisible ? 1 : 0);
    const scoreB = (b.isActionable ? 2 : 0) + (b.boundingVisible ? 1 : 0);
    return scoreB - scoreA;
  });

  const elementsSummary = sortedElements
    .slice(0, 80)
    .map((el) => {
      let line = `[${el.id}] ${el.role} "${el.label}"`;
      if (el.href) line += ` href="${el.href}"`;
      if (el.inputType && el.inputType !== "text") line += ` type="${el.inputType}"`;
      if (el.value) line += ` value="${el.value}"`;
      if (el.disabled) line += " (disabled)";
      if (el.readonly) line += " (readonly)";
      if (!el.boundingVisible && el.isActionable) line += " (off-screen)";
      if (el.isActionable) line += " *";
      return line;
    })
    .join("\n");

  // --- Page type context ---
  const pageTypeStr = pageModel.pageType && pageModel.pageType !== "unknown"
    ? `Page type: ${pageModel.pageType}`
    : "";

  // --- Alerts ---
  const alertsSection = pageModel.alerts && pageModel.alerts.length > 0
    ? `\nPage alerts:\n${pageModel.alerts.map((a) => `  - ${a}`).join("\n")}`
    : "";

  // --- CAPTCHA ---
  const captchaHint = pageModel.captchaDetected
    ? "\n** CAPTCHA DETECTED: This page has a CAPTCHA. You cannot solve CAPTCHAs. Use ask_user to request the user to solve it."
    : "";

  // --- Forms ---
  const formsSection = pageModel.forms && pageModel.forms.length > 0
    ? `\nForms on page:\n${pageModel.forms.map((f) => `  - ${f.method} ${f.action || "(no action)"} (${f.fieldCount} fields)`).join("\n")}`
    : "";

  // --- System prompt ---
  const system = `You are OpenBrowse, an agentic browser assistant. You help users accomplish web-based tasks by calling browser tools.

You MUST call exactly one tool per turn. Reason briefly in text, then call the appropriate tool.

Behavioral guidelines:
- For links with an href: prefer browser_navigate with the href over browser_click when the destination URL is clear
- After filling form fields: use browser_press_key with "Enter" to submit, or click the submit button
- If an element is off-screen: scroll first to reveal it, then interact
- For cookie consent banners: dismiss them first before proceeding with the task
- For CAPTCHAs: call ask_user — you cannot solve them yourself
- Prefer elements marked with * (actionable) — skip elements marked (disabled)
- If the last action failed with element_not_found: try scrolling, using a different selector, or navigating directly
- Ask for clarification only when genuinely ambiguous
- Complete the task when the goal is achieved
- Fail the task only when truly impossible after trying alternatives

Step budget: You are on step ${stepCount + 1} of ${MAX_STEPS}. Plan efficiently — do not waste steps.`;

  // --- User prompt ---
  const notesSection = run.checkpoint.notes.length > 0
    ? `\nUser answers so far:\n${run.checkpoint.notes.map((n, i) => `${i + 1}. ${n}`).join("\n")}`
    : "";

  const user = `Goal: ${run.goal}
Constraints: ${run.constraints.join(", ") || "none"}
Steps taken: ${stepCount}/${MAX_STEPS}${actionHistorySection}${softFailureWarning}${notesSection}

Current page:
URL: ${pageModel.url}
Title: ${pageModel.title}
${pageTypeStr}${captchaHint}${alertsSection}${formsSection}

Visible text (excerpt):
${(pageModel.visibleText ?? "").slice(0, 1500)}

Interactive elements (* = actionable):
${elementsSummary || "(no interactive elements found)"}

What should I do next?`;

  return { system, user };
}
