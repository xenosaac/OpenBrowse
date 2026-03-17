import type { PageModel, TaskRun } from "@openbrowse/contracts";

export interface PlannerPrompt {
  system: string;
  user: string;
}

export const MAX_PLANNER_STEPS = 50;

export function buildPlannerPrompt(run: TaskRun, pageModel: PageModel): PlannerPrompt {
  // --- Harness context ---
  const stepCount = run.checkpoint.stepCount ?? 0;
  const actionHistory = run.checkpoint.actionHistory ?? [];
  const softFailures = run.checkpoint.consecutiveSoftFailures ?? 0;

  const actionHistorySection = actionHistory.length > 0
    ? `\nActions already taken (${actionHistory.length}, most recent last):\n${actionHistory.map((r) => {
        const status = r.ok ? "OK" : `FAILED (${r.failureClass ?? "failed"})`;
        let detail = `  Step ${r.step}: ${r.type} — "${r.description}" ${status}`;
        if (r.targetId) detail += `\n    → Element: [${r.targetId}]`;
        if (r.targetUrl) detail += `\n    → URL: ${r.targetUrl}`;
        if (r.typedText) detail += `\n    → Typed: "${r.typedText}"`;
        if (r.extractedText) detail += `\n    → Text: "${r.extractedText}"`;
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

  const totalSoftFailures = run.checkpoint.totalSoftFailures ?? 0;
  const totalSoftWarning = totalSoftFailures >= 5
    ? `\n** CRITICAL: ${totalSoftFailures} total soft failures across this run (limit: 8). The run will be terminated if failures continue. Switch to a completely different approach NOW — different website, different strategy, or consider that this task may not be achievable.`
    : "";

  const lastActions = actionHistory.slice(-3);
  const repeatedNavs = lastActions.length >= 2
    && lastActions.every(a => a.type === "navigate" && a.ok)
    && new Set(lastActions.map(a => a.url)).size === 1;
  const repeatedNavWarning = repeatedNavs
    ? `\n** WARNING: You have navigated to the same URL ${lastActions.length} times in a row. The page may be redirecting. Try a completely different approach: use a search engine, try a different URL, or consider that this specific page may not be accessible.`
    : "";

  // --- Planner scratchpad notes ---
  const plannerNotes = run.checkpoint.plannerNotes ?? [];
  const plannerNotesSection = plannerNotes.length > 0
    ? `\nYour saved notes (${plannerNotes.length}/20 — same key overwrites, oldest evicted if full):\n${plannerNotes.map((n) => `  "${n.key}": ${n.value}`).join("\n")}`
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

  // --- Elements (up to 150, prioritize actionable + visible) ---
  const sortedElements = [...pageModel.elements].sort((a, b) => {
    const scoreA = (a.isActionable ? 2 : 0) + (a.boundingVisible ? 1 : 0);
    const scoreB = (b.isActionable ? 2 : 0) + (b.boundingVisible ? 1 : 0);
    return scoreB - scoreA;
  });

  const elementsSummary = sortedElements
    .slice(0, 150)
    .map((el) => {
      let line = `[${el.id}] ${el.role} "${el.label}"`;
      if (el.landmark) line += ` in=${el.landmark}`;
      if (el.level) line += ` level=${el.level}`;
      if (el.current) line += ` (current${el.current !== "true" ? `=${el.current}` : ""})`;
      if (el.sort) line += ` (sort=${el.sort})`;
      if (el.roleDescription) line += ` roleDesc="${el.roleDescription}"`;
      if (el.valueText) {
        line += ` valueText="${el.valueText}"`;
      } else if (el.valueNow !== undefined) {
        let range = `${el.valueNow}`;
        if (el.valueMin !== undefined || el.valueMax !== undefined) {
          range += `/${el.valueMin ?? "?"}–${el.valueMax ?? "?"}`;
        }
        line += ` range=${range}`;
      }
      if (el.text) line += ` text="${el.text}"`;
      if (el.description) line += ` desc="${el.description}"`;
      if (el.keyShortcuts) line += ` keys="${el.keyShortcuts}"`;
      if (el.href) line += ` href="${el.href}"`;
      if (el.inputType && el.inputType !== "text") line += ` type="${el.inputType}"`;
      if (el.value) line += ` value="${el.value}"`;
      if (el.checked) line += " (checked)";
      if (el.selected) line += " (selected)";
      if (el.expanded === true) line += " (expanded)";
      if (el.expanded === false) line += " (collapsed)";
      if (el.pressed === true) line += " (pressed)";
      if (el.pressed === false) line += " (not pressed)";
      if (el.pressed === "mixed") line += " (partially pressed)";
      if (el.orientation) line += ` (${el.orientation})`;
      if (el.autocomplete) line += ` (autocomplete=${el.autocomplete})`;
      if (el.multiselectable) line += " (multiselectable)";
      if (el.required) line += " (required)";
      if (el.hasPopup) line += ` (haspopup=${el.hasPopup})`;
      if (el.busy) line += " (busy)";
      if (el.live) line += ` (live=${el.live})`;
      if (el.invalid) line += " (invalid)";
      if (el.disabled) line += " (disabled)";
      if (el.readonly) line += " (readonly)";
      if (el.options && el.options.length > 0) {
        line += ` options=[${el.options.map(o => `"${o.value}"${o.label !== o.value ? ` (${o.label})` : ""}`).join(", ")}]`;
      }
      if (el.inShadowDom) line += " (shadow)";
      if (el.iframeIndex !== undefined) line += ` (iframe[${el.iframeIndex}])`;
      if (!el.boundingVisible && el.isActionable) line += " (off-screen)";
      if (el.isActionable) line += " *";
      return line;
    })
    .join("\n");

  // --- Page type context with strategy hints (T29) ---
  const pageTypeHints: Record<string, string> = {
    search_results: "Page type: search_results — You are on a search results page. Scan results for relevant information. Use `browser_read_text` to extract details. Only click through to a result if you need deeper content not visible in the snippet.",
    form: "Page type: form — You are on a form page. Fill fields systematically top-to-bottom. Check for required fields before submitting. Use the Forms section below for field refs and current values.",
    login: "Page type: login — You are on a login page. See Authentication Flows guidance above. NEVER guess credentials — use `ask_user`.",
    checkout: "Page type: checkout — You are on a checkout/payment page. This is a HIGH-RISK page. Double-check all entries before submitting. Use `ask_user` to confirm before any final purchase/submit action.",
    article: "Page type: article — You are on a content/article page. Use `browser_read_text` for extraction. Avoid clicking elements unless navigating to a linked section or page.",
  };
  const pageTypeStr = pageModel.pageType && pageModel.pageType !== "unknown"
    ? (pageTypeHints[pageModel.pageType] ?? `Page type: ${pageModel.pageType}`)
    : "";

  // --- Alerts ---
  const alertsSection = pageModel.alerts && pageModel.alerts.length > 0
    ? `\nPage alerts:\n${pageModel.alerts.map((a) => `  - ${a}`).join("\n")}`
    : "";

  // --- CAPTCHA ---
  const captchaHint = pageModel.captchaDetected
    ? "\n** CAPTCHA DETECTED: This page has a CAPTCHA. You cannot solve CAPTCHAs. Use ask_user to request the user to solve it."
    : "";

  // --- Cookie banner ---
  const cookieBannerHint = pageModel.cookieBannerDetected
    ? "\n** COOKIE BANNER DETECTED: A cookie consent banner is covering part of the page. Dismiss it first (look for \"Accept\", \"Accept All\", \"Agree\", or \"Reject\" buttons) before interacting with other page elements."
    : "";

  // --- Iframes ---
  const hasIframeElements = pageModel.elements.some(el => el.iframeIndex !== undefined);
  const iframeHint = pageModel.iframeCount && pageModel.iframeCount > 0
    ? `\n** IFRAMES DETECTED: ${pageModel.iframeCount} iframe(s) on this page.${hasIframeElements ? " Same-origin iframe elements are included below — their IDs start with \"frame0_\", \"frame1_\", etc. You can interact with them normally (click, type, read_text)." : ""}${pageModel.iframeSources && pageModel.iframeSources.length > 0 ? ` Cross-origin iframe sources: ${pageModel.iframeSources.join(", ")}.` : ""}${!hasIframeElements ? " Content inside iframes is NOT visible in the element list. If the information you need is not visible, try navigating directly to the iframe source URL." : " For cross-origin iframe content not listed below, navigate directly to the iframe source URL."}`
    : "";

  // --- Active dialog ---
  const dialogHint = pageModel.activeDialog
    ? `\n** DIALOG OPEN: "${pageModel.activeDialog.label}" — A dialog/modal is currently open. You MUST address it (dismiss, fill, or interact with it) before attempting to interact with background page elements.`
    : "";

  // --- Forms (enriched with field details) ---
  const formsSection = pageModel.forms && pageModel.forms.length > 0
    ? `\nForms on page:\n${pageModel.forms.map((f) => {
        let formLine = `  FORM: ${f.method} ${f.action || "(no action)"} (${f.fieldCount} fields)`;
        if (f.fields && f.fields.length > 0) {
          formLine += "\n" + f.fields.map((field) => {
            let fl = `    [${field.ref}] "${field.label}" type=${field.type}`;
            if (field.required) fl += " REQUIRED";
            if (field.currentValue) fl += ` value="${field.currentValue}"`;
            if (field.validationMessage) fl += ` INVALID: "${field.validationMessage}"`;
            return fl;
          }).join("\n");
          if (f.submitRef) formLine += `\n    Submit button: [${f.submitRef}]`;
        }
        return formLine;
      }).join("\n")}`
    : "";

  // --- Table structure ---
  const tablesSection = pageModel.tables && pageModel.tables.length > 0
    ? `\nData tables on page:\n${pageModel.tables.map((t, i) => {
        let tLine = `  TABLE${t.caption ? ` "${t.caption}"` : ""}: ${t.headers.length > 0 ? t.headers.join(" | ") : "(no headers)"} (${t.rowCount} row${t.rowCount !== 1 ? "s" : ""})`;
        if (t.sampleRows && t.sampleRows.length > 0) {
          tLine += "\n" + t.sampleRows.map(row => `    ${row.join(" | ")}`).join("\n");
        }
        return tLine;
      }).join("\n")}`
    : "";

  // --- Landmark regions ---
  const landmarksSection = pageModel.landmarks && pageModel.landmarks.length > 0
    ? `\nPage regions:\n${pageModel.landmarks.map((l) => `  ${l.role}${l.label ? ` "${l.label}"` : ""}`).join("\n")}`
    : "";

  // --- Scroll position context ---
  const scrollSection = pageModel.scrollY !== undefined
    ? `\nScroll position: Y=${pageModel.scrollY}px`
    : "";

  // --- Focused element context ---
  const focusedSection = pageModel.focusedElementId
    ? `\nFocused element: [${pageModel.focusedElementId}] — this element currently has keyboard focus`
    : "";

  // --- Last action result (explicit feedback to planner) ---
  const lastAction = actionHistory.length > 0 ? actionHistory[actionHistory.length - 1] : null;
  const lastActionSection = lastAction
    ? `\nLast action result: ${lastAction.ok ? "SUCCESS" : `FAILED (${lastAction.failureClass ?? "unknown"})`} — ${lastAction.type} "${lastAction.description}"`
    : "";

  // --- URL visit warnings ---
  const urlCounts = run.checkpoint.urlVisitCounts ?? {};
  const frequentUrls = Object.entries(urlCounts).filter(([, count]) => count >= 4);
  let urlWarning = "";
  if (frequentUrls.length > 0) {
    const recentActions = actionHistory.slice(-5);
    const recentActionsSummary = recentActions.length > 0
      ? `\n  Your last ${recentActions.length} actions (what you already tried):\n${recentActions.map(a => `    Step ${a.step}: ${a.type} — "${a.description}" ${a.ok ? "OK" : "FAILED"}`).join("\n")}`
      : "";
    urlWarning = `\n** WARNING: You have visited these URLs too many times — you MUST try a completely different approach NOW:\n${frequentUrls.map(([url, count]) => `  ${url}: ${count} visits`).join("\n")}${recentActionsSummary}\n  REQUIRED: Do NOT repeat any of the above actions. Choose a different URL, different search terms, or use task_complete with partial results.`;
  }

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

## Sub-goal Progress Tracking
For any task with more than 2 steps, track your progress using save_note:
- After completing each sub-goal: browser_save_note(key: "progress", value: "Step 2/4: Found flight options, comparing prices")
- Before choosing your next action: check your saved notes for a "progress" entry to remind yourself where you are
- Update the progress note after each sub-goal is complete — this prevents you from repeating work or losing track
- If you collected partial data (prices, names, URLs), save it with a descriptive key: browser_save_note(key: "prices_found", value: "Site A: $500, Site B: $450")

## Anti-Loop Rules
- NEVER navigate to a URL that already FAILED in the action history — it will fail again
- NEVER type the same search query twice — reformulate with different keywords
- If a website failed to provide needed info after 2 visits, switch to a different source
- If you find yourself back on a page you already visited, do something DIFFERENT
- If the page shows "Not Found", "404", or an error, do NOT retry that URL

## Browser Guidelines

**Navigation:**
- For links with href: prefer browser_navigate over browser_click
- Use browser_go_back to return to previous pages instead of re-navigating
- If the page is about:blank or empty: navigate to a relevant URL immediately
- If an element is off-screen: scroll first to reveal it
- Prefer elements marked with * (actionable)

**Forms:**
- After filling fields: press Enter or click the submit button
- To replace pre-filled content: set clear_first to true on browser_type
- For cookie consent banners: dismiss them first
- For CAPTCHAs: call ask_user — you cannot solve them
- For file upload inputs (type="file"): use browser_upload_file with the element ref — this will ask the user which file to attach

**Waiting for results:**
- After dynamic content loading (search query, SPA navigation): use browser_wait_for_text instead of browser_wait with a fixed duration
- After form submission or any redirect action: use browser_wait_for_navigation to wait for the URL to change

**Data capture:**
- Use browser_read_text for detailed element text (up to 2000 chars vs 40-char truncation in the element list)
- For multi-page tasks, use browser_save_note to record findings before navigating — notes persist across pages
- Include results as extracted_data in task_complete ({label, value} pairs) for structured output

**Completion:**
- Complete the task when the goal is achieved
- Fail only when truly impossible after trying alternatives

## Authentication Flows
- Recognize login/signin pages by password inputs, "Sign in" / "Log in" buttons, or URLs containing /login, /signin, /auth.
- NEVER guess, auto-fill, or fabricate credentials. ALWAYS use ask_user to request username and password from the user.
- After submitting login credentials, use browser_wait_for_navigation — most login forms redirect after success.
- If the page shows a 2FA/MFA code entry, use ask_user to request the code from the user.
- If an OAuth popup or redirect occurs (e.g., "Sign in with Google"), follow the redirect and continue — the session will carry the auth state.
- If login fails (wrong password message), use ask_user to inform the user and request corrected credentials. Do not retry the same credentials.

## Error Recovery
When an action fails:
- **Element not found:** Page may still be loading. Use browser_wait_for_text, then retry.
- **Click intercepted or obscured:** An overlay may be blocking. Check for DIALOG OPEN or COOKIE BANNER hints. Dismiss it first, then retry.
- **Navigation timeout:** Server may be slow. Use browser_wait, retry once. If it fails again, use ask_user.
- **Type action failed:** Input may not be focused. Use browser_click on the field first, then browser_type.
- **After 2 consecutive failures on the same action:** Stop retrying. Try a completely different approach or use ask_user for guidance.

## Breaking Out of Loops (CRITICAL)
If you notice you are repeating similar actions without making progress:
- **Stuck on a page:** Use browser_read_text to examine what is actually on the page before clicking anything else. The visible text excerpt above is truncated — read_text gives you the full content.
- **Same element fails repeatedly:** The page may have changed since the element list was captured. Use browser_read_text to re-examine the page content, then pick a DIFFERENT element or approach.
- **Navigation keeps returning to the same page:** Stop navigating to that URL. Try a completely different URL — for example, search Google for the information instead of navigating directly to the site.
- **Cannot make progress after 3 attempts at the same approach:** Use task_complete with a partial result explaining what you found and where you got stuck. A partial result is ALWAYS better than looping until the run is killed.
- **If you are on an interactive page (game, form wizard, dynamic app):** These pages often require precise sequences. If your approach is not working after 2-3 tries, describe the situation to the user via ask_user rather than guessing repeatedly.

## Partial Results
If you have collected useful intermediate data (via save_note or read_text) and the task cannot be fully completed, prefer task_complete with partial extractedData over task_failed. Partial results are more valuable than failure.

Step budget: You are on step ${stepCount + 1} of ${MAX_PLANNER_STEPS}. Plan efficiently.`;

  // --- User prompt ---
  const notesSection = run.checkpoint.notes.length > 0
    ? `\nUser answers so far:\n${run.checkpoint.notes.map((n, i) => `${i + 1}. ${n}`).join("\n")}`
    : "";

  // When this is the first step and the page is not blank, the agent is observing the user's
  // currently open page. Tell the planner so it can decide whether the page is relevant.
  const activePageHint = stepCount === 0 && pageModel.url && pageModel.url !== "about:blank"
    ? `\n** CONTEXT: This is the page the user currently has open. Evaluate whether it is relevant to the goal before deciding to navigate elsewhere. If the page is relevant, continue working on it directly.`
    : "";

  // --- Self-assessment injection ---
  const shouldInjectSelfAssessment = (() => {
    // Trigger 1: 3+ of the last 5 actions share the same type
    const last5 = actionHistory.slice(-5);
    if (last5.length >= 3) {
      const typeCounts: Record<string, number> = {};
      for (const a of last5) {
        typeCounts[a.type] = (typeCounts[a.type] ?? 0) + 1;
      }
      if (Object.values(typeCounts).some(c => c >= 3)) return true;
    }
    // Trigger 2: Step count >= 15 (halfway progress check)
    if (stepCount >= 25) return true;
    // Trigger 3: Any URL visited 4+ times
    const urlCounts = run.checkpoint.urlVisitCounts ?? {};
    if (Object.values(urlCounts).some(c => c >= 4)) return true;
    return false;
  })();

  const selfAssessmentSection = shouldInjectSelfAssessment
    ? `\n** PROGRESS CHECK — Before choosing your next action, assess:
1. Am I making real progress toward the goal? What has changed on the page?
2. If I've performed similar actions recently (e.g., multiple clicks), am I clicking DIFFERENT elements for a reason, or the SAME element repeatedly without effect?
3. Do I need something from the user to proceed (login credentials, CAPTCHA, a decision)?
If you are genuinely stuck and cannot make progress, call task_failed with a clear explanation.
If you need user input, call ask_user. Otherwise, continue with your next action.`
    : "";

  const remaining = MAX_PLANNER_STEPS - (stepCount + 1);
  const lowBudgetWarning = remaining <= 10
    ? `\n** BUDGET LOW: ${remaining} step${remaining !== 1 ? "s" : ""} remaining. Complete the task now using task_complete — include any partial results in extractedData. Do not start new multi-step sequences.`
    : "";

  const user = `Goal: ${run.goal}
Constraints: ${run.constraints.join(", ") || "none"}
Steps taken: ${stepCount}/${MAX_PLANNER_STEPS}${lastActionSection}${actionHistorySection}${failedUrlsSection}${usedQueriesSection}${softFailureWarning}${totalSoftWarning}${repeatedNavWarning}${urlWarning}${recoverySection}${notesSection}${plannerNotesSection}${activePageHint}${selfAssessmentSection}${lowBudgetWarning}

Current page:
URL: ${pageModel.url}
Title: ${pageModel.title}
${pageTypeStr}${scrollSection}${focusedSection}${captchaHint}${cookieBannerHint}${iframeHint}${dialogHint}${alertsSection}${formsSection}${tablesSection}${landmarksSection}

Visible text (excerpt):
${(pageModel.visibleText ?? "").slice(0, 3000)}

Interactive elements (* = actionable)${pageModel.elements.length > 150 ? ` — showing 150 of ${pageModel.elements.length} (scroll to reveal more)` : ""}:
${elementsSummary || "(no interactive elements found)"}

What should I do next?`;

  return { system, user };
}
