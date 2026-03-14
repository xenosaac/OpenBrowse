import { StubBrowserKernel } from "@openbrowse/browser-runtime";
import type { BrowserAction, BrowserSession, TaskIntent, TaskMessage, TaskRun, WorkflowEvent } from "@openbrowse/contracts";
import { TelegramChatBridge, StubChatBridge } from "@openbrowse/chat-bridge";
import { createWorkflowEvent, appendWorkflowEvent } from "./workflowEvents.js";
import type { RuntimeServices } from "./types.js";

const MAX_LOOP_STEPS = 20;

function parseApprovalAnswer(answer: string): boolean | null {
  const normalized = answer.trim().toLowerCase();
  if (["approve", "approved", "yes", "y", "ok", "allow", "go"].includes(normalized)) return true;
  if (["deny", "denied", "no", "n", "block", "cancel", "stop"].includes(normalized)) return false;
  return null;
}

async function resolveRuntimeServicesForIntent(
  services: RuntimeServices,
  intent: TaskIntent
): Promise<RuntimeServices> {
  const resolved = await services.executionResolver?.resolveForIntent?.(intent, services);
  return resolved ?? services;
}

async function resolveRuntimeServicesForRun(
  services: RuntimeServices,
  run: TaskRun
): Promise<RuntimeServices> {
  const resolved = await services.executionResolver?.resolveForRun?.(run, services);
  return resolved ?? services;
}

export class OpenBrowseRuntime {
  constructor(private readonly services: RuntimeServices) {}

  async startTask(intent: TaskIntent): Promise<TaskRun> {
    const { run, session } = await this.initializeTask(intent);
    return this.plannerLoop(run, session);
  }

  async startTaskDetached(
    intent: TaskIntent,
    onSettled?: (run: TaskRun) => Promise<void> | void
  ): Promise<TaskRun> {
    const { run, session } = await this.initializeTask(intent);

    void this.plannerLoop(run, session)
      .then(async (finalRun) => {
        await onSettled?.(finalRun);
      })
      .catch(async (error) => {
        const failedRun = await this.failUnexpectedRun(run, error);
        await onSettled?.(failedRun);
      });

    return run;
  }

  async resumeAndContinue(run: TaskRun): Promise<TaskRun> {
    return this.resumeExecution(run);
  }

  async resumeTaskFromMessage(message: TaskMessage): Promise<TaskRun | null> {
    if (!message.runId) return null;
    const run = await this.services.runCheckpointStore.load(message.runId);
    if (!run || !run.suspension) return null;

    if (run.suspension.type === "approval") {
      const approved = parseApprovalAnswer(message.text);
      if (approved === null) {
        await this.services.chatBridge.send({
          channel: message.channel,
          runId: run.id,
          text: `Run "${run.goal}" is waiting for approval. Reply with "approve" or "deny".`
        });
        return run;
      }

      if (!approved) {
        const cancelledRun = this.services.orchestrator.cancelRun(
          run,
          "User denied approval request.",
          message.createdAt
        );
        await this.services.runCheckpointStore.save(cancelledRun);
        await this.logWorkflowEvent(cancelledRun.id, "approval_answered", "Approval denied by user.", {
          channel: message.channel,
          approved: "false"
        });
        await this.logWorkflowEvent(cancelledRun.id, "run_cancelled", cancelledRun.outcome?.summary ?? "Cancelled", {});
        return cancelledRun;
      }

      const pendingAction = run.checkpoint.pendingBrowserAction;
      const resumedRun = this.services.orchestrator.resumeFromApproval(run, true, message.createdAt);
      await this.services.runCheckpointStore.save(resumedRun);
      await this.logWorkflowEvent(resumedRun.id, "approval_answered", "Approval granted by user.", {
        channel: message.channel,
        approved: "true"
      });
      return this.resumeExecution(resumedRun, pendingAction);
    }

    if (!run.checkpoint.pendingClarificationId) {
      return run;
    }

    const resumedRun = this.services.orchestrator.resumeFromClarification(run, {
      requestId: run.checkpoint.pendingClarificationId,
      runId: run.id,
      answer: message.text,
      respondedAt: message.createdAt
    });
    await this.services.runCheckpointStore.save(resumedRun);
    await this.logWorkflowEvent(resumedRun.id, "clarification_answered", `Run resumed from ${message.channel}.`, {
      channel: message.channel
    });
    return this.resumeExecution(resumedRun);
  }

  private async initializeTask(intent: TaskIntent): Promise<{ run: TaskRun; session: BrowserSession }> {
    const createdRun = this.services.orchestrator.createRun(intent);
    const runningRun = this.services.orchestrator.startRun(createdRun);

    await this.logWorkflowEvent(runningRun.id, "run_created", `Task started: ${intent.goal}`, {
      source: intent.source
    });

    const profile = await this.services.browserKernel.ensureProfile(intent.preferredProfileId);
    const session = await this.services.browserKernel.attachSession(profile, {
      runId: runningRun.id,
      groupId: runningRun.id,
      taskLabel: runningRun.goal,
      source: runningRun.source,
      status: runningRun.status,
      isBackground: runningRun.source !== "desktop"
    });
    const attachedRun = this.services.orchestrator.attachSession(runningRun, profile.id, session.id);
    await this.services.runCheckpointStore.save(attachedRun);

    return { run: attachedRun, session };
  }

  private async failUnexpectedRun(run: TaskRun, error: unknown): Promise<TaskRun> {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[runtime] Unexpected run failure for ${run.id}:`, message);
    const failedRun = this.services.orchestrator.failRun(run, message);
    await this.services.runCheckpointStore.save(failedRun);
    await this.logWorkflowEvent(failedRun.id, "run_failed", failedRun.outcome?.summary ?? "Failed", {
      reason: message
    });
    return failedRun;
  }

  // Attaches a browser session to a running run and persists the checkpoint.
  // Returns the reattached run (with browserSessionId set) and the session.
  // Callers must ensure run.status === "running" before calling.
  private async setupResume(run: TaskRun): Promise<{ reattached: TaskRun; session: BrowserSession }> {
    const profile = await this.services.browserKernel.ensureProfile(run.profileId);
    const session = await this.services.browserKernel.attachSession(profile, {
      runId: run.id,
      groupId: run.id,
      taskLabel: run.goal,
      source: run.source,
      status: run.status,
      isBackground: true
    });
    const reattached = this.services.orchestrator.attachSession(run, profile.id, session.id);
    await this.services.runCheckpointStore.save(reattached);
    return { reattached, session };
  }

  // Restores the last URL, executes any pending action, then runs the planner loop.
  // Called after setupResume has already attached the session.
  private async continueResume(run: TaskRun, session: BrowserSession, pendingAction?: BrowserAction): Promise<TaskRun> {
    let current = run;

    if (current.checkpoint.lastKnownUrl) {
      const restoreResult = await this.services.browserKernel.executeAction(session, {
        type: "navigate",
        value: current.checkpoint.lastKnownUrl,
        description: `Restore previous page ${current.checkpoint.lastKnownUrl}`
      });
      current = this.services.orchestrator.recordBrowserResult(current, restoreResult);
      await this.services.runCheckpointStore.save(current);
    }

    if (pendingAction) {
      const result = await this.services.browserKernel.executeAction(session, pendingAction);
      current = this.services.orchestrator.recordBrowserResult(current, result);
      await this.services.runCheckpointStore.save(current);
      await this.logWorkflowEvent(current.id, "browser_action_executed", result.summary, {
        actionType: pendingAction.type,
        ok: String(result.ok),
        resumed: "true"
      });

      if (!result.ok) {
        const failedRun = this.services.orchestrator.failRun(current, result.summary);
        await this.services.runCheckpointStore.save(failedRun);
        await this.logWorkflowEvent(failedRun.id, "run_failed", failedRun.outcome?.summary ?? "Failed", {});
        return failedRun;
      }
    }

    return this.plannerLoop(current, session);
  }

  private async resumeExecution(run: TaskRun, pendingAction?: BrowserAction): Promise<TaskRun> {
    if (run.status !== "running") return run;
    const { reattached, session } = await this.setupResume(run);
    return this.continueResume(reattached, session, pendingAction);
  }

  // Like resumeTaskFromMessage but non-blocking: attaches the browser session before returning
  // (so callers get a run with browserSessionId set), then runs the planner loop in the background.
  async resumeTaskFromMessageDetached(
    message: TaskMessage,
    onSettled?: (run: TaskRun) => Promise<void> | void
  ): Promise<TaskRun | null> {
    if (!message.runId) return null;
    const run = await this.services.runCheckpointStore.load(message.runId);
    if (!run || !run.suspension) return null;

    if (run.suspension.type === "approval") {
      const approved = parseApprovalAnswer(message.text);
      if (approved === null) {
        await this.services.chatBridge.send({
          channel: message.channel,
          runId: run.id,
          text: `Run "${run.goal}" is waiting for approval. Reply with "approve" or "deny".`
        });
        return run;
      }

      if (!approved) {
        const cancelledRun = this.services.orchestrator.cancelRun(
          run,
          "User denied approval request.",
          message.createdAt
        );
        await this.services.runCheckpointStore.save(cancelledRun);
        await this.logWorkflowEvent(cancelledRun.id, "approval_answered", "Approval denied by user.", {
          channel: message.channel,
          approved: "false"
        });
        await this.logWorkflowEvent(cancelledRun.id, "run_cancelled", cancelledRun.outcome?.summary ?? "Cancelled", {});
        await onSettled?.(cancelledRun);
        return cancelledRun;
      }

      const pendingAction = run.checkpoint.pendingBrowserAction;
      const resumedRun = this.services.orchestrator.resumeFromApproval(run, true, message.createdAt);
      await this.services.runCheckpointStore.save(resumedRun);
      await this.logWorkflowEvent(resumedRun.id, "approval_answered", "Approval granted by user.", {
        channel: message.channel,
        approved: "true"
      });

      if (resumedRun.status !== "running") {
        await onSettled?.(resumedRun);
        return resumedRun;
      }

      let setup: { reattached: TaskRun; session: BrowserSession };
      try {
        setup = await this.setupResume(resumedRun);
      } catch (err) {
        const failedRun = await this.failUnexpectedRun(resumedRun, err);
        await onSettled?.(failedRun);
        return failedRun;
      }

      void this.continueResume(setup.reattached, setup.session, pendingAction)
        .then(async (finalRun) => { await onSettled?.(finalRun); })
        .catch(async (err) => {
          const failedRun = await this.failUnexpectedRun(setup.reattached, err);
          await onSettled?.(failedRun);
        });

      return setup.reattached;
    }

    if (!run.checkpoint.pendingClarificationId) {
      return run;
    }

    const resumedRun = this.services.orchestrator.resumeFromClarification(run, {
      requestId: run.checkpoint.pendingClarificationId,
      runId: run.id,
      answer: message.text,
      respondedAt: message.createdAt
    });
    await this.services.runCheckpointStore.save(resumedRun);
    await this.logWorkflowEvent(resumedRun.id, "clarification_answered", `Run resumed from ${message.channel}.`, {
      channel: message.channel
    });

    if (resumedRun.status !== "running") {
      await onSettled?.(resumedRun);
      return resumedRun;
    }

    let setup: { reattached: TaskRun; session: BrowserSession };
    try {
      setup = await this.setupResume(resumedRun);
    } catch (err) {
      const failedRun = await this.failUnexpectedRun(resumedRun, err);
      await onSettled?.(failedRun);
      return failedRun;
    }

    void this.continueResume(setup.reattached, setup.session)
      .then(async (finalRun) => { await onSettled?.(finalRun); })
      .catch(async (err) => {
        const failedRun = await this.failUnexpectedRun(setup.reattached, err);
        await onSettled?.(failedRun);
      });

    return setup.reattached;
  }

  private async plannerLoop(run: TaskRun, session: BrowserSession): Promise<TaskRun> {
    let current = run;
    for (let step = 0; step < MAX_LOOP_STEPS; step++) {
      const pageModel = await this.services.browserKernel.capturePageModel(session);
      current = this.services.orchestrator.observePage(current, pageModel, session.id);
      await this.services.runCheckpointStore.save(current);

      await this.logWorkflowEvent(current.id, "page_modeled", `Captured page: ${pageModel.title}`, {
        url: pageModel.url,
        pageModelId: pageModel.id
      });
      await this.logWorkflowEvent(current.id, "planner_request_started", `Requesting planner decision for ${pageModel.title || pageModel.url}`, {
        url: pageModel.url,
        plannerMode: this.services.descriptor.planner.mode
      });

      let decision;
      try {
        decision = await this.services.planner.decide({ run: current, pageModel });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.logWorkflowEvent(current.id, "planner_request_failed", `Planner request failed: ${message}`, {
          url: pageModel.url,
          plannerMode: this.services.descriptor.planner.mode
        });
        current = this.services.orchestrator.failRun(current, `Planner request failed: ${message}`);
        await this.services.runCheckpointStore.save(current);
        await this.logWorkflowEvent(current.id, "run_failed", current.outcome?.summary ?? "Failed", {});
        return current;
      }

      await this.logWorkflowEvent(current.id, "planner_decision", decision.reasoning, {
        plannerDecision: decision.type
      });

      if (decision.type === "browser_action" && decision.action) {
        const action = decision.action as BrowserAction;
        if (this.services.securityPolicy.requiresApproval(current, action)) {
          const approvalRequest = this.services.securityPolicy.buildApprovalRequest(current, action);
          const approvalDecision = { ...decision, type: "approval_request" as const, approvalRequest };
          current = this.services.orchestrator.applyPlannerDecision(current, approvalDecision);
          await this.services.runCheckpointStore.save(current);
          await this.services.chatBridge.sendClarification({
            id: approvalRequest.id,
            runId: approvalRequest.runId,
            question: approvalRequest.question,
            contextSummary: approvalRequest.irreversibleActionSummary,
            options: [
              { id: "approve", label: "Approve", summary: "Allow this action" },
              { id: "deny", label: "Deny", summary: "Block this action" }
            ],
            createdAt: approvalRequest.createdAt
          });
          await this.logWorkflowEvent(current.id, "approval_requested", approvalRequest.question, {
            requestId: approvalRequest.id
          });
          return current;
        }

        const result = await this.services.browserKernel.executeAction(session, action);
        current = this.services.orchestrator.recordBrowserResult(current, result);
        await this.logWorkflowEvent(current.id, "browser_action_executed", result.summary, {
          actionType: action.type,
          ok: String(result.ok)
        });

        if (!result.ok) {
          current = this.services.orchestrator.failRun(current, result.summary);
          await this.services.runCheckpointStore.save(current);
          await this.logWorkflowEvent(current.id, "run_failed", current.outcome?.summary ?? "Failed", {});
          return current;
        }

        await this.services.runCheckpointStore.save(current);
        continue;
      }

      current = this.services.orchestrator.applyPlannerDecision(current, decision);
      await this.services.runCheckpointStore.save(current);

      if (decision.clarificationRequest) {
        await this.services.chatBridge.sendClarification(decision.clarificationRequest);
        await this.logWorkflowEvent(current.id, "clarification_requested", decision.clarificationRequest.question, {
          requestId: decision.clarificationRequest.id
        });
      }

      if (
        current.status === "completed" ||
        current.status === "failed" ||
        current.status === "cancelled" ||
        current.status === "suspended_for_clarification" ||
        current.status === "suspended_for_approval"
      ) {
        if (current.status === "completed") {
          await this.logWorkflowEvent(current.id, "run_completed", current.outcome?.summary ?? "Done", {});
        } else if (current.status === "failed") {
          await this.logWorkflowEvent(current.id, "run_failed", current.outcome?.summary ?? "Failed", {});
        }
        return current;
      }
    }

    current = this.services.orchestrator.failRun(current, `Planner loop exceeded ${MAX_LOOP_STEPS} steps`);
    await this.services.runCheckpointStore.save(current);
    await this.logWorkflowEvent(current.id, "run_failed", current.outcome?.summary ?? "Failed", {});
    return current;
  }

  private async logWorkflowEvent(
    runId: string,
    type: WorkflowEvent["type"],
    summary: string,
    payload: Record<string, string>
  ): Promise<void> {
    const event = createWorkflowEvent(runId, type, summary, payload);
    await appendWorkflowEvent(this.services.workflowLogStore, this.services.eventBus, event);
  }
}

export function wireInboundChat(services: RuntimeServices): void {
  if (services.chatBridge instanceof TelegramChatBridge) {
    services.chatBridge.setInboundHandler(async (message) => {
      await handleInboundMessage(services, message);
    });
  }
}

export async function bootstrapRun(services: RuntimeServices, intent: TaskIntent): Promise<TaskRun> {
  const effectiveServices = await resolveRuntimeServicesForIntent(services, intent);
  return new OpenBrowseRuntime(effectiveServices).startTask(intent);
}

export async function bootstrapRunDetached(
  services: RuntimeServices,
  intent: TaskIntent,
  onSettled?: (run: TaskRun) => Promise<void> | void
): Promise<TaskRun> {
  const effectiveServices = await resolveRuntimeServicesForIntent(services, intent);
  return new OpenBrowseRuntime(effectiveServices).startTaskDetached(intent, onSettled);
}

export async function handleInboundMessage(services: RuntimeServices, message: TaskMessage): Promise<TaskRun | null> {
  if (!message.runId) return null;
  const run = await services.runCheckpointStore.load(message.runId);
  if (!run) return null;
  const effectiveServices = await resolveRuntimeServicesForRun(services, run);
  return new OpenBrowseRuntime(effectiveServices).resumeTaskFromMessage(message);
}

// Non-blocking variant: attaches the browser session synchronously (so the returned run has
// browserSessionId set), then fires the planner loop in the background via onSettled.
export async function handleInboundMessageDetached(
  services: RuntimeServices,
  message: TaskMessage,
  onSettled?: (run: TaskRun) => Promise<void> | void
): Promise<TaskRun | null> {
  if (!message.runId) return null;
  const run = await services.runCheckpointStore.load(message.runId);
  if (!run) return null;
  const effectiveServices = await resolveRuntimeServicesForRun(services, run);
  return new OpenBrowseRuntime(effectiveServices).resumeTaskFromMessageDetached(message, onSettled);
}

export async function recoverRun(services: RuntimeServices, run: TaskRun): Promise<TaskRun> {
  const effectiveServices = await resolveRuntimeServicesForRun(services, run);
  return new OpenBrowseRuntime(effectiveServices).resumeAndContinue(run);
}

export async function cancelTrackedRun(
  services: RuntimeServices,
  runId: string,
  summary = "Run cancelled by user."
): Promise<TaskRun | null> {
  const run = await services.runCheckpointStore.load(runId);
  if (!run) return null;

  if (run.checkpoint.browserSessionId) {
    try {
      await services.browserKernel.destroySession(run.checkpoint.browserSessionId);
    } catch {
      // Session may already be gone.
    }
  }

  if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
    return run;
  }

  const cancelledRun = services.orchestrator.cancelRun(run, summary);
  await services.runCheckpointStore.save(cancelledRun);
  const event = createWorkflowEvent(cancelledRun.id, "run_cancelled", cancelledRun.outcome?.summary ?? "Cancelled", {});
  await appendWorkflowEvent(services.workflowLogStore, services.eventBus, event);
  return cancelledRun;
}

export function markBrowserRuntimeInitFailed(services: RuntimeServices, message: string): void {
  services.browserKernel = new StubBrowserKernel();
  services.browserKernelInit = undefined;
  services.descriptor = {
    ...services.descriptor,
    browser: {
      mode: "stub",
      detail: `Browser runtime failed to initialize and was downgraded to stub mode: ${message}`
    }
  };
}

export function markChatBridgeInitFailed(services: RuntimeServices, message: string): void {
  services.chatBridge = new StubChatBridge();
  services.chatBridgeInit = undefined;
  services.descriptor = {
    ...services.descriptor,
    chatBridge: {
      mode: "stub",
      detail: `Telegram bridge failed to initialize and was downgraded to stub mode: ${message}`
    }
  };
  wireInboundChat(services);
}

export function describeRuntime(services: RuntimeServices) {
  return services.descriptor;
}

export async function shutdownRuntime(services: RuntimeServices): Promise<void> {
  await services.browserKernel.destroyAllSessions();
  if (services.scheduler.dispose) {
    await services.scheduler.dispose();
  }
  if (services.chatBridge instanceof TelegramChatBridge) {
    await services.chatBridge.stop();
  }
  services.sqliteDb?.close();
}
