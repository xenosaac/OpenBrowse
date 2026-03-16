import type { PageModel, RunHandoffArtifact, TaskRun } from "@openbrowse/contracts";

/**
 * Builds a structured RunHandoffArtifact from a TaskRun's persisted checkpoint.
 * The artifact is the canonical handoff surface — consumable by humans and agents.
 */
export function buildHandoffArtifact(run: TaskRun, pageModelSnapshot?: PageModel): RunHandoffArtifact {
  const { checkpoint, suspension } = run;

  return {
    runId: run.id,
    goal: run.goal,
    constraints: run.constraints,
    source: run.source,
    status: run.status,
    startedAt: run.createdAt,
    updatedAt: run.updatedAt,
    stepCount: checkpoint.stepCount ?? 0,
    currentUrl: checkpoint.lastKnownUrl,
    currentPageTitle: checkpoint.lastPageTitle,
    currentPageSummary: checkpoint.lastPageSummary,
    actionHistory: checkpoint.actionHistory ?? [],
    stopReason: checkpoint.stopReason,
    nextSuggestedStep: checkpoint.nextSuggestedStep,
    lastFailureClass: checkpoint.lastFailureClass,
    consecutiveSoftFailures: checkpoint.consecutiveSoftFailures ?? 0,
    suspensionType: suspension?.type,
    suspensionQuestion: suspension?.question,
    notes: checkpoint.notes,
    outcome: run.outcome?.summary,
    extractedData: run.outcome?.extractedData,
    pageModelSnapshot: pageModelSnapshot
  };
}

/**
 * Renders a RunHandoffArtifact as a markdown document suitable for
 * human review or consumption by another AI agent.
 */
export function renderHandoffMarkdown(artifact: RunHandoffArtifact): string {
  const lines: string[] = [];

  const statusEmoji: Record<string, string> = {
    running: "▶",
    suspended_for_clarification: "⏸",
    suspended_for_approval: "🔐",
    completed: "✅",
    failed: "❌",
    cancelled: "🚫",
    queued: "⏳"
  };

  const icon = statusEmoji[artifact.status] ?? "•";

  lines.push(`# Run Handoff: ${artifact.goal}`);
  lines.push("");
  lines.push(`**Run ID**: \`${artifact.runId}\``);
  lines.push(`**Status**: ${icon} ${artifact.status}`);
  lines.push(`**Source**: ${artifact.source}`);
  lines.push(`**Started**: ${artifact.startedAt}`);
  lines.push(`**Last Update**: ${artifact.updatedAt}`);
  lines.push(`**Steps completed**: ${artifact.stepCount}`);
  lines.push("");

  lines.push("## Goal");
  lines.push(artifact.goal);
  lines.push("");

  if (artifact.constraints.length > 0) {
    lines.push("## Constraints");
    for (const c of artifact.constraints) {
      lines.push(`- ${c}`);
    }
    lines.push("");
  }

  const hasPageContext = artifact.currentUrl || artifact.currentPageTitle || artifact.currentPageSummary;
  if (hasPageContext) {
    lines.push("## Current Page");
    if (artifact.currentUrl) lines.push(`**URL**: ${artifact.currentUrl}`);
    if (artifact.currentPageTitle) lines.push(`**Title**: ${artifact.currentPageTitle}`);
    if (artifact.currentPageSummary) lines.push(`**Summary**: ${artifact.currentPageSummary}`);
    lines.push("");
  }

  if (artifact.actionHistory.length > 0) {
    lines.push("## Action History (last 15)");
    lines.push("");
    lines.push("| Step | Action | Description | Target | Result |");
    lines.push("|------|--------|-------------|--------|--------|");
    for (const record of artifact.actionHistory) {
      const result = record.ok
        ? "✓"
        : record.failureClass
          ? `✗ (${record.failureClass})`
          : "✗";
      const desc = record.description.length > 50
        ? record.description.slice(0, 47) + "..."
        : record.description;
      const target = record.targetUrl
        ? record.targetUrl.length > 40 ? record.targetUrl.slice(0, 37) + "..." : record.targetUrl
        : record.typedText
          ? `"${record.typedText.length > 30 ? record.typedText.slice(0, 27) + "..." : record.typedText}"`
          : "—";
      lines.push(`| ${record.step} | ${record.type} | ${desc} | ${target} | ${result} |`);
    }
    lines.push("");
  }

  if (artifact.stopReason) {
    lines.push("## Why Execution Stopped");
    lines.push(artifact.stopReason);
    lines.push("");
  }

  if (artifact.nextSuggestedStep) {
    lines.push("## Next Suggested Step");
    lines.push(artifact.nextSuggestedStep);
    lines.push("");
  }

  if (artifact.suspensionType) {
    lines.push("## Pending Input Required");
    lines.push(`**Type**: ${artifact.suspensionType}`);
    if (artifact.suspensionQuestion) {
      lines.push(`**Question**: ${artifact.suspensionQuestion}`);
    }
    lines.push("");
  }

  if (artifact.lastFailureClass) {
    lines.push("## Last Failure");
    lines.push(`**Class**: ${artifact.lastFailureClass}`);
    if (artifact.consecutiveSoftFailures > 0) {
      lines.push(`**Consecutive soft failures**: ${artifact.consecutiveSoftFailures}`);
    }
    lines.push("");
  }

  if (artifact.notes.length > 0) {
    lines.push("## User Notes / Context");
    artifact.notes.forEach((note, i) => {
      lines.push(`${i + 1}. ${note}`);
    });
    lines.push("");
  }

  if (artifact.outcome) {
    lines.push("## Outcome");
    lines.push(artifact.outcome);
    lines.push("");
  }

  if (artifact.extractedData && artifact.extractedData.length > 0) {
    lines.push("## Extracted Data");
    lines.push("");
    lines.push("| Label | Value |");
    lines.push("|-------|-------|");
    for (const item of artifact.extractedData) {
      const label = item.label.replace(/\|/g, "\\|");
      const value = item.value.replace(/\|/g, "\\|").replace(/\n/g, " ");
      lines.push(`| ${label} | ${value} |`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}
