import type { PageModel, TaskRun } from "@openbrowse/contracts";

export interface PlannerPrompt {
  system: string;
  user: string;
}

export function buildPlannerPrompt(run: TaskRun, pageModel: PageModel): PlannerPrompt {
  // --- Harness context ---
  const stepCount = run.checkpoint.stepCount ?? 0;
  const actionHistory = run.checkpoint.actionHistory ?? [];
  const softFailures = run.checkpoint.consecutiveSoftFailures ?? 0;

  const actionHistorySection = actionHistory.length > 0
    ? `\nActions already taken (${actionHistory.length}, most recent last):\n${actionHistory.map((r) => {
        const status = r.ok ? "✓" : `✗ (${r.failureClass ?? "failed"})`;
        return `  Step ${r.step}: ${r.type} — "${r.description}" ${status}`;
      }).join("\n")}`
    : "";

  const softFailureWarning = softFailures > 0
    ? `\n⚠ The last ${softFailures} action(s) failed with "element not found". The target may have moved, not loaded yet, or not exist on this page. Try a different approach: scroll to reveal it, navigate directly via its href, or reassess what page you are on.`
    : "";

  // --- Elements ---
  const elementsSummary = pageModel.elements
    .slice(0, 50)
    .map((el) => {
      let line = `[${el.id}] ${el.role} "${el.label}"`;
      if (el.href) line += ` href="${el.href}"`;
      if (el.inputType && el.inputType !== "text") line += ` type="${el.inputType}"`;
      if (el.value) line += ` value="${el.value}"`;
      if (el.disabled) line += " (disabled)";
      if (el.readonly) line += " (readonly)";
      if (!el.boundingVisible && el.isActionable) line += " (off-screen)";
      if (el.isActionable) line += " (actionable)";
      return line;
    })
    .join("\n");

  const system = `You are an agentic browser assistant called OpenBrowse. You help users accomplish web-based tasks by navigating pages, clicking elements, typing text, and extracting information.

You MUST respond with a single JSON object (no markdown, no explanation) matching one of these schemas:

1. Browser action:
{"type":"browser_action","reasoning":"...","action":{"type":"navigate|click|type|scroll|select|focus|hover|keyboard_shortcut|wait|extract","targetId":"el_N","value":"...","description":"..."}}

2. Clarification request (when you need more info from the user):
{"type":"clarification_request","reasoning":"...","clarificationRequest":{"id":"clarify_<runId>_<timestamp>","runId":"<runId>","question":"...","contextSummary":"...","options":[{"id":"opt_1","label":"...","summary":"..."}],"createdAt":"<iso>"}}

3. Task complete:
{"type":"task_complete","reasoning":"...","completionSummary":"..."}

4. Task failed:
{"type":"task_failed","reasoning":"...","failureSummary":"..."}

Interaction guidelines:
- For links with an href: prefer "navigate" with the href value over "click" when the destination is clear
- For text inputs: use "type" with the targetId — it focuses, clears, and types natively
- For dropdowns (<select>): use "select" with the option value
- For off-screen elements: the engine scrolls them into view automatically before interacting
- For form submission: use "keyboard_shortcut" with value "Enter" after filling fields, or click the submit button
- Use "focus" to move keyboard focus without triggering a click
- Use "hover" to reveal tooltip menus or dropdown triggers
- Prefer elements marked (actionable) and (boundingVisible) — skip elements marked (disabled) or (off-screen) unless necessary
- Ask for clarification when you genuinely need user input (preferences, ambiguous choices)
- Complete the task when the goal is achieved
- Fail the task only when it's truly impossible`;

  const notesSection = run.checkpoint.notes.length > 0
    ? `\nUser answers so far:\n${run.checkpoint.notes.map((n, i) => `${i + 1}. ${n}`).join("\n")}`
    : "";

  const user = `Goal: ${run.goal}
Constraints: ${run.constraints.join(", ") || "none"}
Current status: ${run.status}
Steps taken: ${stepCount}${actionHistorySection}${softFailureWarning}${notesSection}

Current page:
URL: ${pageModel.url}
Title: ${pageModel.title}
Summary: ${pageModel.summary}

Visible text (excerpt):
${(pageModel.visibleText ?? "").slice(0, 1500)}

Interactive elements:
${elementsSummary || "(no interactive elements found)"}

What should I do next?`;

  return { system, user };
}
