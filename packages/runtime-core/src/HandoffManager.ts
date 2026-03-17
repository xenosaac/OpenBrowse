import type { PageModel, TaskRun } from "@openbrowse/contracts";
import type { RuntimeServices } from "./types.js";
import { buildHandoffArtifact, renderHandoffMarkdown } from "@openbrowse/observability";
import { createWorkflowEvent, appendWorkflowEvent } from "./workflowEvents.js";

/**
 * Handles terminal-state handoff: captures final page, emits handoff event,
 * sends notifications, and clears chat bridge state.
 */
export class HandoffManager {
  constructor(private readonly services: RuntimeServices) {}

  async writeHandoff(run: TaskRun, pageModelSnapshot?: PageModel): Promise<void> {
    let snapshot = pageModelSnapshot;
    if (!snapshot && run.checkpoint.browserSessionId) {
      try {
        const session = await this.services.browserKernel.getSession(run.checkpoint.browserSessionId);
        if (session && session.state === "attached") {
          snapshot = await this.services.browserKernel.capturePageModel(session);
        }
      } catch {
        // Session may already be destroyed
      }
    }
    await this.emitHandoffEvent(run, snapshot);
    await this.notifyTerminalEvent(run);
    await this.services.chatBridge.clearRunState?.(run.id);
  }

  async emitHandoffEvent(run: TaskRun, pageModelSnapshot?: PageModel): Promise<void> {
    const artifact = buildHandoffArtifact(run, pageModelSnapshot);
    const markdown = renderHandoffMarkdown(artifact);
    const event = createWorkflowEvent(run.id, "handoff_written", `Handoff written: ${run.status}`, {
      status: run.status,
      stepCount: String(artifact.stepCount),
      lastFailureClass: artifact.lastFailureClass ?? "",
      consecutiveSoftFailures: String(artifact.consecutiveSoftFailures),
      handoffMarkdown: markdown.slice(0, 1000)
    });
    await appendWorkflowEvent(this.services.workflowLogStore, this.services.eventBus, event);
  }

  async notifyTerminalEvent(run: TaskRun): Promise<void> {
    // Skip generic notification for scheduler-triggered runs — they get a
    // dedicated watch notification from the scheduler dispatch callback.
    if (run.source === "scheduler") return;

    const artifact = buildHandoffArtifact(run);
    const markdown = renderHandoffMarkdown(artifact);
    const prefix: Record<string, string> = {
      completed: `\u2713 Task completed: "${run.goal.slice(0, 60)}"`,
      failed:    `\u2717 Task failed: "${run.goal.slice(0, 60)}"`,
      cancelled: `\u2298 Task cancelled: "${run.goal.slice(0, 60)}"`
    };
    const statusLine = prefix[run.status] ?? `Run ended (${run.status}): "${run.goal.slice(0, 60)}"`;
    const text = `${statusLine}\n\n${markdown}`;
    await this.services.chatBridge.send({ channel: "telegram", runId: run.id, text })
      .catch((err) => console.error("[runtime] Failed to send terminal notification:", err instanceof Error ? err.message : err));
  }
}
