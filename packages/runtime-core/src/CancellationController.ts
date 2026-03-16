import type { TaskRun } from "@openbrowse/contracts";
import type { RuntimeServices } from "./types.js";
import type { SessionManager } from "./SessionManager.js";
import type { HandoffManager } from "./HandoffManager.js";
import { createWorkflowEvent, appendWorkflowEvent } from "./workflowEvents.js";

/**
 * Cooperative cancellation with a synchronous isCancelled() check.
 * The planner loop checks this after each async step to avoid
 * race conditions with checkpoint-based cancellation.
 */
export class CancellationController {
  private readonly pending = new Set<string>();

  constructor(
    private readonly services: RuntimeServices,
    private readonly sessions: SessionManager,
    private readonly handoff: HandoffManager
  ) {}

  async cancel(runId: string, summary = "Run cancelled by user."): Promise<TaskRun | null> {
    const run = await this.services.runCheckpointStore.load(runId);
    if (!run) return null;

    // Mark cancelled so in-flight planner loop can observe it synchronously
    this.pending.add(runId);

    // Destroy session immediately to stop any in-flight browser actions
    if (run.checkpoint.browserSessionId) {
      try {
        await this.services.browserKernel.destroySession(run.checkpoint.browserSessionId);
      } catch { /* already gone */ }
    }
    await this.sessions.cleanupRun(runId);

    // Already terminal — nothing else to do
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
      this.pending.delete(runId);
      return run;
    }

    const cancelledRun = this.services.orchestrator.cancelRun(run, summary);
    await this.services.runCheckpointStore.save(cancelledRun);
    const event = createWorkflowEvent(cancelledRun.id, "run_cancelled", cancelledRun.outcome?.summary ?? "Cancelled", {});
    await appendWorkflowEvent(this.services.workflowLogStore, this.services.eventBus, event);
    await this.handoff.emitHandoffEvent(cancelledRun);
    await this.handoff.notifyTerminalEvent(cancelledRun);
    await this.services.chatBridge.clearRunState?.(cancelledRun.id);

    return cancelledRun;
  }

  /** Sync check — no I/O. Safe to call in hot loop. */
  isCancelled(runId: string): boolean {
    return this.pending.has(runId);
  }

  /** Clear flag after loop has observed it. */
  acknowledge(runId: string): void {
    this.pending.delete(runId);
  }
}
