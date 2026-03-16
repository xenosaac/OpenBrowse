import type { PageModel, TaskRun, WorkflowEvent } from "@openbrowse/contracts";
import { createWorkflowEvent, appendWorkflowEvent } from "./workflowEvents.js";
import type { RuntimeServices } from "./types.js";

export interface RecoveryReport {
  resumed: TaskRun[];
  awaitingInput: TaskRun[];
  failed: TaskRun[];
  skipped: TaskRun[];
}

export interface RecoveryStrategy {
  shouldRetry(run: TaskRun): boolean;
  maxRetries: number;
}

export class DefaultRecoveryStrategy implements RecoveryStrategy {
  maxRetries = 1;

  shouldRetry(run: TaskRun): boolean {
    return run.status === "running";
  }
}

/** Function that attempts to recover/resume a single run. */
export type RecoverRunFn = (services: RuntimeServices, run: TaskRun) => Promise<TaskRun>;

/** Function that emits a handoff event for a terminal run. */
export type EmitHandoffFn = (services: RuntimeServices, run: TaskRun, pageModelSnapshot?: PageModel) => Promise<void>;

export interface RecoveryManagerOptions {
  strategy?: RecoveryStrategy;
  recoverRunFn: RecoverRunFn;
  emitHandoffFn: EmitHandoffFn;
}

export class RecoveryManager {
  private readonly strategy: RecoveryStrategy;
  private readonly recoverRunFn: RecoverRunFn;
  private readonly emitHandoffFn: EmitHandoffFn;

  constructor(
    private readonly services: RuntimeServices,
    options: RecoveryManagerOptions
  ) {
    this.strategy = options.strategy ?? new DefaultRecoveryStrategy();
    this.recoverRunFn = options.recoverRunFn;
    this.emitHandoffFn = options.emitHandoffFn;
  }

  async recoverInterruptedRuns(): Promise<RecoveryReport> {
    const store = this.services.runCheckpointStore;
    const report: RecoveryReport = {
      resumed: [],
      awaitingInput: [],
      failed: [],
      skipped: []
    };

    const runningRuns = await store.listByStatus("running");
    const clarificationRuns = await store.listByStatus("suspended_for_clarification");
    const approvalRuns = await store.listByStatus("suspended_for_approval");

    report.awaitingInput.push(...clarificationRuns, ...approvalRuns);
    for (const awaitingRun of report.awaitingInput) {
      await this.logRecoveryEvent(
        awaitingRun,
        "recovery_skipped",
        `Run ${awaitingRun.id} is awaiting user input (${awaitingRun.status}), skipping recovery`
      );
    }

    for (const run of runningRuns) {
      if (!this.strategy.shouldRetry(run)) {
        report.skipped.push(run);
        await this.logRecoveryEvent(run, "recovery_skipped", `Recovery strategy chose to skip run ${run.id}`);
        continue;
      }

      try {
        const result = await this.recoverRunFn(this.services, run);
        report.resumed.push(result);
        await this.logRecoveryEvent(result, "run_recovered", `Successfully recovered run ${run.id}: ${result.status}`, extractRecoveryMetadata(run));
      } catch (err) {
        const failedRun = this.services.orchestrator.failRun(
          run,
          `Recovery failed: ${err instanceof Error ? err.message : String(err)}`
        );
        await store.save(failedRun);
        report.failed.push(failedRun);
        await this.logRecoveryEvent(
          failedRun,
          "recovery_failed",
          `Failed to recover run ${run.id}: ${err instanceof Error ? err.message : String(err)}`
        );
        await this.emitHandoffFn(this.services, failedRun);
      }
    }

    return report;
  }

  private async logRecoveryEvent(
    run: TaskRun,
    type: "run_recovered" | "recovery_failed" | "recovery_skipped",
    summary: string,
    payload: Record<string, string> = {}
  ): Promise<void> {
    const event: WorkflowEvent = {
      ...createWorkflowEvent(run.id, type, summary, payload)
    };
    await appendWorkflowEvent(this.services.workflowLogStore, this.services.eventBus, event);
  }
}

/** Extract recovery-relevant metadata from a run checkpoint. Pure function. */
export function extractRecoveryMetadata(run: TaskRun): Record<string, string> {
  const meta: Record<string, string> = {};
  if (run.checkpoint.lastPageModelId) meta.lastPageModelId = run.checkpoint.lastPageModelId;
  if (run.checkpoint.browserSessionId) meta.browserSessionId = run.checkpoint.browserSessionId;
  if (run.checkpoint.summary) meta.checkpointSummary = run.checkpoint.summary;
  meta.lastUpdated = run.updatedAt;
  meta.stepCount = String(run.checkpoint.stepCount ?? 0);
  return meta;
}
