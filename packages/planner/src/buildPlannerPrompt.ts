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
        let detail = `  Step ${r.step}: ${r.type} — "${r.description}" ${status}`;
        if (r.targetUrl) detail += `\n    → URL: ${r.targetUrl}`;
        if (r.typedText) detail += `\n    → Typed: "${r.typedText}"`;
        return detail;
      }).join("\n")}`
    : "";

  const failedUrls = actionHistory
    .filter(r => !r.ok && r.targetUrl)
    .map(r => r.targetUrl!);
  const uniqueFailedUrls = [...new Set(failedUrls)];
  const failedUrlsSection = uniqueFailedUrls.length > 0
    ? `\n** FAILED URLs — do NOT revisit: ${uniqueFailedUrls.join(", ")}`
    : "";

  const usedSearchQueries = actionHistory
    .filter(r => r.type === "type" && r.typedText)
    .map(r => r.typedText!);
  const uniqueQueries = [...new Set(usedSearchQueries)];
  const usedQueriesSection = uniqueQueries.length > 0
    ? `\n** Search queries already used — use DIFFERENT terms next time: ${uniqueQueries.join("; ")}`
    : "";

  const softFailureWarning = softFailures > 0
    ? `\n** WARNING: The last ${softFailures} action(s) failed. Review the action history above and try a COMPLETELY DIFFERENT approach: different URL, different search terms, or a different strategy entirely.`
    : "";

  const lastActions = actionHistory.slice(-3);
  const repeatedNavs = lastActions.length >= 2
    && lastActions.every(a => a.type === "navigate" && a.ok)
    && new Set(lastActions.map(a => a.url)).size === 1;
  const repeatedNavWarning = repeatedNavs
    ? `\n** WARNING: You have navigated to the same URL ${lastActions.length} times in a row. The page may be redirecting. Try a completely different approach: use a search engine, try a different URL, or consider that this specific page may not be accessible.`
    : "";

  const recoveryContext = run.checkpoint.recoveryContext;
  const recoverySection = recoveryContext
    ? `\n** RECOVERY MODE: This run was interrupted and has been automatically resumed.
- The browser session was recreated. The page was reloaded from the last known URL.
- Any form data you previously entered is LOST and must be re-entered.
- JavaScript state, scroll position, and modal dialogs from before are gone.
- Before interruption, page was: "${recoveryContext.preInterruptionPageTitle ?? "unknown"}"
- Pre-interruption summary: ${recoveryContext.preInterruptionPageSummary ?? "unavailable"}${
        recoveryContext.preInterruptionFormValues
          ? `\n- Form fields that were filled (now lost, re-enter them): ${Object.entries(recoveryContext.preInterruptionFormValues).map(([id, v]) => `${id}="${v}"`).join(", ")}`
          : ""
      }${
        recoveryContext.preInterruptionScrollY && recoveryContext.preInterruptionScrollY > 200
          ? `\n- Page was scrolled to Y=${recoveryContext.preInterruptionScrollY}px — you may need to scroll down`
          : ""
      }
- Compare the current page state below with the pre-interruption context above to decide what needs to be redone.\n`
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
  const system = `You are OpenBrowse, an agentic browser assistant that uses the ReAct (Reasoning + Acting) framework.

## MANDATORY: Think Before You Act
Before calling any tool, you MUST write your reasoning as a text block. Address:
1. SITUATION: What page am I on? What does it show?
2. PROGRESS: What have I accomplished so far? What sub-goals remain?
3. PLAN: What should I do next and WHY this specific action?
4. AVOID: What have I already tried that failed? (Check action history below.)

Then call exactly one tool. Every response = reasoning text + one tool call.

## Task Decomposition
- Break complex goals into specific sub-tasks before acting
- Do NOT paste the user's raw sentence as a search query — reformulate into targeted search terms (3-5 keywords)
  Bad: "look up hyrax price in california and operational cost"
  Good: "hyrax exotic pet purchase price USD" then separately "hyrax annual care cost food vet"
- Address sub-tasks one at a time with focused searches

## Anti-Loop Rules
- NEVER navigate to a URL that already FAILED in the action history — it will fail again
- NEVER type the same search query twice — reformulate with different keywords
- If a website failed to provide needed info after 2 visits, switch to a different source
- If you find yourself back on a page you already visited, do something DIFFERENT
- If the page shows "Not Found", "404", or an error, do NOT retry that URL

## Browser Guidelines
- For links with href: prefer browser_navigate with the href over browser_click
- After filling form fields: press Enter or click the submit button
- If an element is off-screen: scroll first to reveal it
- For cookie consent banners: dismiss them first
- For CAPTCHAs: call ask_user — you cannot solve them
- Prefer elements marked with * (actionable)
- If the current page is about:blank or empty: navigate to a relevant URL immediately
- Ask for clarification only when genuinely ambiguous
- Complete the task when the goal is achieved
- Fail the task only when truly impossible after trying alternatives

Step budget: You are on step ${stepCount + 1} of ${MAX_STEPS}. Plan efficiently.`;

  // --- User prompt ---
  const notesSection = run.checkpoint.notes.length > 0
    ? `\nUser answers so far:\n${run.checkpoint.notes.map((n, i) => `${i + 1}. ${n}`).join("\n")}`
    : "";

  // When this is the first step and the page is not blank, the agent is observing the user's
  // currently open page. Tell the planner so it can decide whether the page is relevant.
  const activePageHint = stepCount === 0 && pageModel.url && pageModel.url !== "about:blank"
    ? `\n** CONTEXT: This is the page the user currently has open. Evaluate whether it is relevant to the goal before deciding to navigate elsewhere. If the page is relevant, continue working on it directly.`
    : "";

  const user = `Goal: ${run.goal}
Constraints: ${run.constraints.join(", ") || "none"}
Steps taken: ${stepCount}/${MAX_STEPS}${actionHistorySection}${failedUrlsSection}${usedQueriesSection}${softFailureWarning}${repeatedNavWarning}${recoverySection}${notesSection}${activePageHint}

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
