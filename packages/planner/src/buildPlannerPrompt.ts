import type { PageModel, TaskRun } from "@openbrowse/contracts";

export interface PlannerPrompt {
  system: string;
  user: string;
}

export function buildPlannerPrompt(run: TaskRun, pageModel: PageModel): PlannerPrompt {
  const elementsSummary = pageModel.elements
    .slice(0, 50)
    .map((el) => `[${el.id}] ${el.role} "${el.label}"${el.value ? ` value="${el.value}"` : ""}${el.isActionable ? " (actionable)" : ""}`)
    .join("\n");

  const system = `You are an agentic browser assistant called OpenBrowse. You help users accomplish web-based tasks by navigating pages, clicking elements, typing text, and extracting information.

You MUST respond with a single JSON object (no markdown, no explanation) matching one of these schemas:

1. Browser action:
{"type":"browser_action","reasoning":"...","action":{"type":"navigate|click|type|scroll|select|wait|extract","targetId":"el_N","value":"...","description":"..."}}

2. Clarification request (when you need more info from the user):
{"type":"clarification_request","reasoning":"...","clarificationRequest":{"id":"clarify_<runId>_<timestamp>","runId":"<runId>","question":"...","contextSummary":"...","options":[{"id":"opt_1","label":"...","summary":"..."}],"createdAt":"<iso>"}}

3. Task complete:
{"type":"task_complete","reasoning":"...","completionSummary":"..."}

4. Task failed:
{"type":"task_failed","reasoning":"...","failureSummary":"..."}

Guidelines:
- Navigate to relevant websites to accomplish the user's goal
- Use element IDs from the page model to target clicks and typing
- Ask for clarification when you genuinely need user input (preferences, ambiguous choices)
- Complete the task when the goal is achieved
- Fail the task only when it's truly impossible`;

  const notesSection = run.checkpoint.notes.length > 0
    ? `\nUser answers so far:\n${run.checkpoint.notes.map((n, i) => `${i + 1}. ${n}`).join("\n")}`
    : "";

  const user = `Goal: ${run.goal}
Constraints: ${run.constraints.join(", ") || "none"}
Current status: ${run.status}
${notesSection}

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
