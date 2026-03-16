import { StubBrowserKernel } from "@openbrowse/browser-runtime";
import type { BrowserAction, BrowserSession, PageModel, TaskIntent, TaskMessage, TaskRun, WorkflowEvent } from "@openbrowse/contracts";
import { TelegramChatBridge, StubChatBridge } from "@openbrowse/chat-bridge";
import { buildHandoffArtifact, renderHandoffMarkdown } from "@openbrowse/observability";
import { createWorkflowEvent, appendWorkflowEvent } from "./workflowEvents.js";
import { HandoffManager } from "./HandoffManager.js";
import { SessionManager } from "./SessionManager.js";
import { CancellationController } from "./CancellationController.js";
import { RunExecutor } from "./RunExecutor.js";
import type { RuntimeServices } from "./types.js";

// ── Backward-compatible module-level functions ────────────────────────────

/** Module-level handoff emitter — usable outside the OpenBrowseRuntime class. */
export async function emitHandoffEvent(services: RuntimeServices, run: TaskRun, pageModelSnapshot?: PageModel): Promise<void> {
  const hm = new HandoffManager(services);
  await hm.emitHandoffEvent(run, pageModelSnapshot);
}

export function wireBotCommands(services: RuntimeServices): void {
  if (!(services.chatBridge instanceof TelegramChatBridge)) return;

  services.chatBridge.setCommandHandler(async (ctx) => {
    const { command, args, respond } = ctx;

    switch (command) {
      case "status": {
        const runs = await services.runCheckpointStore.listAll();
        const active = runs.filter(
          (r) => r.status === "running" || r.status.startsWith("suspended")
        );
        if (active.length === 0) {
          await respond("No active runs.");
          return;
        }
        const lines = active.map((r) => {
          const emoji = r.status === "running" ? "\u2699" : "\u23F8";
          const steps = r.checkpoint.stepCount ?? 0;
          const url = r.checkpoint.lastKnownUrl
            ? ` \u2014 ${r.checkpoint.lastKnownUrl.slice(0, 50)}`
            : "";
          return `${emoji} \`${r.id.slice(0, 12)}\` ${r.goal.slice(0, 40)} (step ${steps}${url})`;
        });
        await respond(`Active runs:\n${lines.join("\n")}`);
        break;
      }

      case "list": {
        const n = Math.min(parseInt(args) || 5, 20);
        const all = await services.runCheckpointStore.listAll();
        const recent = all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, n);
        if (recent.length === 0) {
          await respond("No runs yet.");
          return;
        }
        const statusEmoji: Record<string, string> = {
          running: "\u2699", completed: "\u2713", failed: "\u2717",
          cancelled: "\u2298", suspended_for_clarification: "\u23F8",
          suspended_for_approval: "\u23F8", queued: "\u23F3"
        };
        const lines = recent.map((r) => {
          const e = statusEmoji[r.status] ?? "?";
          return `${e} \`${r.id.slice(0, 12)}\` ${r.goal.slice(0, 50)}`;
        });
        await respond(`Recent runs:\n${lines.join("\n")}`);
        break;
      }

      case "cancel": {
        const targetId = args.trim() || null;
        if (!targetId) {
          const all = await services.runCheckpointStore.listAll();
          const running = all
            .filter((r) => r.status === "running")
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          if (running.length === 0) {
            await respond("No running tasks to cancel.");
            return;
          }
          const target = running[0];
          const cancelled = await cancelTrackedRun(services, target.id, "Cancelled by remote operator.");
          await respond(
            cancelled
              ? `Cancelled: "${target.goal.slice(0, 60)}"`
              : "Failed to cancel the run."
          );
          return;
        }
        const cancelled = await cancelTrackedRun(services, targetId, "Cancelled by remote operator.");
        if (!cancelled) {
          await respond(`Run not found: ${targetId}`);
          return;
        }
        await respond(`Cancelled: "${cancelled.goal.slice(0, 60)}"`);
        break;
      }

      case "handoff": {
        const targetId = args.trim() || null;
        let run: TaskRun | null = null;
        if (targetId) {
          run = await services.runCheckpointStore.load(targetId);
        } else {
          const all = await services.runCheckpointStore.listAll();
          const terminal = all
            .filter((r) => ["completed", "failed", "cancelled"].includes(r.status))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          run = terminal[0] ?? null;
        }
        if (!run) {
          await respond("Run not found.");
          return;
        }
        const artifact = buildHandoffArtifact(run);
        const md = renderHandoffMarkdown(artifact);
        for (let i = 0; i < md.length; i += 4000) {
          await respond(md.slice(i, i + 4000));
        }
        break;
      }

      default:
        await respond(`Unknown command: /${command}`);
    }
  });
}

export async function handleNewTaskMessage(
  services: RuntimeServices,
  message: TaskMessage
): Promise<TaskRun> {
  const intent: TaskIntent = {
    id: `intent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    source: message.channel === "telegram" ? "telegram" : "desktop",
    goal: message.text.trim(),
    constraints: [],
    metadata: {},
    createdAt: message.createdAt
  };

  const run = await bootstrapRunDetached(services, intent);

  if (services.chatBridge instanceof TelegramChatBridge && message.chatId) {
    await services.chatBridge.bindRunToChat(run.id, message.chatId);
  }

  return run;
}

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

// ── OpenBrowseRuntime: thin facade over 4 modules ─────────────────────────

export class OpenBrowseRuntime {
  private readonly handoff: HandoffManager;
  private readonly sessions: SessionManager;
  private readonly cancellation: CancellationController;
  private readonly executor: RunExecutor;

  constructor(private readonly services: RuntimeServices) {
    this.handoff = new HandoffManager(services);
    this.sessions = new SessionManager(services.browserKernel);
    this.cancellation = new CancellationController(services, this.sessions, this.handoff);
    this.executor = new RunExecutor(services, this.sessions, this.cancellation, this.handoff);
  }

  async startTask(intent: TaskIntent): Promise<TaskRun> {
    const { run, session } = await this.initializeTask(intent);
    return this.executor.plannerLoop(run, session);
  }

  async startTaskDetached(
    intent: TaskIntent,
    onSettled?: (run: TaskRun) => Promise<void> | void
  ): Promise<TaskRun> {
    const { run, session } = await this.initializeTask(intent);

    void this.executor.plannerLoop(run, session)
      .then(async (finalRun) => { await onSettled?.(finalRun); })
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
        const pendingAction = run.checkpoint.pendingBrowserAction;
        const denialOutcome = pendingAction
          ? this.services.securityPolicy.resolveDenial(run, pendingAction)
          : "denied";

        if (denialOutcome === "denied_continue") {
          const resumedRun = this.services.orchestrator.resumeFromApproval(run, false, message.createdAt);
          resumedRun.checkpoint.notes.push(`Action denied by user: "${pendingAction?.description ?? "unknown"}". Try a different approach.`);
          resumedRun.checkpoint.pendingBrowserAction = undefined;
          await this.services.runCheckpointStore.save(resumedRun);
          await this.logWorkflowEvent(resumedRun.id, "approval_answered", "Approval denied \u2014 continuing with alternative.", {
            channel: message.channel,
            approved: "false",
            outcome: "denied_continue"
          });
          return this.resumeExecution(resumedRun);
        }

        const cancelledRun = this.services.orchestrator.cancelRun(run, "User denied approval request.", message.createdAt);
        await this.services.runCheckpointStore.save(cancelledRun);
        await this.logWorkflowEvent(cancelledRun.id, "approval_answered", "Approval denied by user.", {
          channel: message.channel, approved: "false"
        });
        await this.logWorkflowEvent(cancelledRun.id, "run_cancelled", cancelledRun.outcome?.summary ?? "Cancelled", {});
        await this.handoff.writeHandoff(cancelledRun);
        return cancelledRun;
      }

      const pendingAction = run.checkpoint.pendingBrowserAction;
      const resumedRun = this.services.orchestrator.resumeFromApproval(run, true, message.createdAt);
      await this.services.runCheckpointStore.save(resumedRun);
      await this.logWorkflowEvent(resumedRun.id, "approval_answered", "Approval granted by user.", {
        channel: message.channel, approved: "true"
      });
      return this.resumeExecution(resumedRun, pendingAction);
    }

    if (!run.checkpoint.pendingClarificationId) return run;

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
          channel: message.channel, runId: run.id,
          text: `Run "${run.goal}" is waiting for approval. Reply with "approve" or "deny".`
        });
        return run;
      }

      if (!approved) {
        const pendingAction = run.checkpoint.pendingBrowserAction;
        const denialOutcome = pendingAction
          ? this.services.securityPolicy.resolveDenial(run, pendingAction)
          : "denied";

        if (denialOutcome === "denied_continue") {
          const resumedRun = this.services.orchestrator.resumeFromApproval(run, false, message.createdAt);
          resumedRun.checkpoint.notes.push(`Action denied by user: "${pendingAction?.description ?? "unknown"}". Try a different approach.`);
          resumedRun.checkpoint.pendingBrowserAction = undefined;
          await this.services.runCheckpointStore.save(resumedRun);
          await this.logWorkflowEvent(resumedRun.id, "approval_answered", "Approval denied \u2014 continuing with alternative.", {
            channel: message.channel, approved: "false", outcome: "denied_continue"
          });
          return this.detachedResume(resumedRun, onSettled);
        }

        const cancelledRun = this.services.orchestrator.cancelRun(run, "User denied approval request.", message.createdAt);
        await this.services.runCheckpointStore.save(cancelledRun);
        await this.logWorkflowEvent(cancelledRun.id, "approval_answered", "Approval denied by user.", {
          channel: message.channel, approved: "false"
        });
        await this.logWorkflowEvent(cancelledRun.id, "run_cancelled", cancelledRun.outcome?.summary ?? "Cancelled", {});
        await this.handoff.writeHandoff(cancelledRun);
        await onSettled?.(cancelledRun);
        return cancelledRun;
      }

      const pendingAction = run.checkpoint.pendingBrowserAction;
      const resumedRun = this.services.orchestrator.resumeFromApproval(run, true, message.createdAt);
      await this.services.runCheckpointStore.save(resumedRun);
      await this.logWorkflowEvent(resumedRun.id, "approval_answered", "Approval granted by user.", {
        channel: message.channel, approved: "true"
      });
      return this.detachedResume(resumedRun, onSettled, pendingAction);
    }

    if (!run.checkpoint.pendingClarificationId) return run;

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
    return this.detachedResume(resumedRun, onSettled);
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async initializeTask(intent: TaskIntent): Promise<{ run: TaskRun; session: BrowserSession }> {
    const createdRun = this.services.orchestrator.createRun(intent);
    const runningRun = this.services.orchestrator.startRun(createdRun);

    await this.logWorkflowEvent(runningRun.id, "run_created", `Task started: ${intent.goal}`, {
      source: intent.source
    });
    if (intent.source === "telegram" || intent.source === "scheduler") {
      void this.services.chatBridge.send({
        channel: "telegram",
        runId: runningRun.id,
        text: `\u2699 Task started: "${intent.goal.slice(0, 80)}"\nRun: \`${runningRun.id}\``
      }).catch(() => {});
    }

    let session: BrowserSession | null = null;
    let profileId: string | undefined;
    if (intent.activeSessionId) {
      session = await this.services.browserKernel.getSession(intent.activeSessionId);
      if (session) {
        profileId = session.profileId;
        await this.logWorkflowEvent(runningRun.id, "run_created", `Reusing active tab: ${session.pageUrl ?? "about:blank"}`, {
          activeSessionId: intent.activeSessionId
        });
      }
    }

    if (!session) {
      const profile = await this.services.browserKernel.ensureProfile(intent.preferredProfileId);
      profileId = profile.id;
      session = await this.services.browserKernel.attachSession(profile, {
        runId: runningRun.id,
        groupId: runningRun.id,
        taskLabel: runningRun.goal,
        source: runningRun.source,
        status: runningRun.status,
        isBackground: runningRun.source !== "desktop"
      });
    }

    this.sessions["track"](runningRun.id, session.id);
    const attachedRun = this.services.orchestrator.attachSession(runningRun, profileId!, session.id);
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
    await this.handoff.writeHandoff(failedRun);
    return failedRun;
  }

  private async setupResume(run: TaskRun): Promise<{ reattached: TaskRun; session: BrowserSession }> {
    // Clean up orphaned sessions before creating a new one
    await this.sessions.cleanupOrphans(run.id);

    const profile = await this.services.browserKernel.ensureProfile(run.profileId);
    const session = await this.services.browserKernel.attachSession(profile, {
      runId: run.id,
      groupId: run.id,
      taskLabel: run.goal,
      source: run.source,
      status: run.status,
      isBackground: true
    });
    this.sessions["track"](run.id, session.id);
    const reattached = this.services.orchestrator.attachSession(run, profile.id, session.id);
    await this.services.runCheckpointStore.save(reattached);
    return { reattached, session };
  }

  private async resumeExecution(run: TaskRun, pendingAction?: BrowserAction): Promise<TaskRun> {
    if (run.status !== "running") return run;
    const { reattached, session } = await this.setupResume(run);
    return this.executor.continueResume(reattached, session, pendingAction);
  }

  private async detachedResume(
    run: TaskRun,
    onSettled?: (run: TaskRun) => Promise<void> | void,
    pendingAction?: BrowserAction
  ): Promise<TaskRun> {
    if (run.status !== "running") {
      await onSettled?.(run);
      return run;
    }

    let setup: { reattached: TaskRun; session: BrowserSession };
    try {
      setup = await this.setupResume(run);
    } catch (err) {
      const failedRun = await this.failUnexpectedRun(run, err);
      await onSettled?.(failedRun);
      return failedRun;
    }

    void this.executor.continueResume(setup.reattached, setup.session, pendingAction)
      .then(async (finalRun) => { await onSettled?.(finalRun); })
      .catch(async (err) => {
        const failedRun = await this.failUnexpectedRun(setup.reattached, err);
        await onSettled?.(failedRun);
      });

    return setup.reattached;
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

// ── Module-level entry points (unchanged signatures) ──────────────────────

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
  if (!message.runId) {
    if (message.text.trimStart().startsWith("/")) return null;
    return handleNewTaskMessage(services, message);
  }
  const run = await services.runCheckpointStore.load(message.runId);
  if (!run) return null;
  const effectiveServices = await resolveRuntimeServicesForRun(services, run);
  return new OpenBrowseRuntime(effectiveServices).resumeTaskFromMessage(message);
}

export async function handleInboundMessageDetached(
  services: RuntimeServices,
  message: TaskMessage,
  onSettled?: (run: TaskRun) => Promise<void> | void
): Promise<TaskRun | null> {
  if (!message.runId) {
    if (message.text.trimStart().startsWith("/")) return null;
    const run = await handleNewTaskMessage(services, message);
    await onSettled?.(run);
    return run;
  }
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
    } catch { /* Session may already be gone. */ }
  }

  if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
    return run;
  }

  const hm = new HandoffManager(services);
  const cancelledRun = services.orchestrator.cancelRun(run, summary);
  await services.runCheckpointStore.save(cancelledRun);
  const event = createWorkflowEvent(cancelledRun.id, "run_cancelled", cancelledRun.outcome?.summary ?? "Cancelled", {});
  await appendWorkflowEvent(services.workflowLogStore, services.eventBus, event);
  await hm.emitHandoffEvent(cancelledRun);
  await hm.notifyTerminalEvent(cancelledRun);
  await services.chatBridge.clearRunState?.(cancelledRun.id);
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
  wireBotCommands(services);
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
