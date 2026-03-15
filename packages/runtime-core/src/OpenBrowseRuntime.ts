import { StubBrowserKernel } from "@openbrowse/browser-runtime";
import type { BrowserAction, BrowserSession, PageModel, TaskIntent, TaskMessage, TaskRun, WorkflowEvent } from "@openbrowse/contracts";
import { TelegramChatBridge, StubChatBridge } from "@openbrowse/chat-bridge";
import { buildHandoffArtifact, renderHandoffMarkdown } from "@openbrowse/observability";
import { createWorkflowEvent, appendWorkflowEvent } from "./workflowEvents.js";
import type { RuntimeServices } from "./types.js";

const MAX_LOOP_STEPS = 20;
const MAX_CONSECUTIVE_SOFT_FAILURES = 5;

/** Module-level handoff emitter — usable outside the OpenBrowseRuntime class. */
export async function emitHandoffEvent(services: RuntimeServices, run: TaskRun, pageModelSnapshot?: PageModel): Promise<void> {
  const artifact = buildHandoffArtifact(run, pageModelSnapshot);
  const markdown = renderHandoffMarkdown(artifact);
  const event = createWorkflowEvent(run.id, "handoff_written", `Handoff written: ${run.status}`, {
    status: run.status,
    stepCount: String(artifact.stepCount),
    lastFailureClass: artifact.lastFailureClass ?? "",
    consecutiveSoftFailures: String(artifact.consecutiveSoftFailures),
    handoffMarkdown: markdown.slice(0, 1000)
  });
  await appendWorkflowEvent(services.workflowLogStore, services.eventBus, event);
}

// ── Outbound notification helpers ─────────────────────────────────────────

/**
 * Sends a terminal-state notification (completed / failed / cancelled) to the
 * configured chat channel. Fire-and-forget safe: errors are swallowed so they
 * never affect run state.
 */
async function notifyTerminalEvent(services: RuntimeServices, run: TaskRun): Promise<void> {
  const artifact = buildHandoffArtifact(run);
  const markdown = renderHandoffMarkdown(artifact);
  const prefix: Record<string, string> = {
    completed: `✓ Task completed: "${run.goal.slice(0, 60)}"`,
    failed:    `✗ Task failed: "${run.goal.slice(0, 60)}"`,
    cancelled: `⊘ Task cancelled: "${run.goal.slice(0, 60)}"`
  };
  const statusLine = prefix[run.status] ?? `Run ended (${run.status}): "${run.goal.slice(0, 60)}"`;
  const text = `${statusLine}\n\n${markdown}`;
  await services.chatBridge.send({ channel: "telegram", runId: run.id, text })
    .catch((err) => console.error("[runtime] Failed to send terminal notification:", err instanceof Error ? err.message : err));
}

/**
 * Wires the command handler closure (which has access to RuntimeServices) into
 * the Telegram bridge. Must be called after the chat bridge is (re-)created,
 * e.g. in applyRuntimeSettings and on initial bootstrap.
 */
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
          const emoji = r.status === "running" ? "⚙" : "⏸";
          const steps = r.checkpoint.stepCount ?? 0;
          const url = r.checkpoint.lastKnownUrl
            ? ` — ${r.checkpoint.lastKnownUrl.slice(0, 50)}`
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
          running: "⚙", completed: "✓", failed: "✗",
          cancelled: "⊘", suspended_for_clarification: "⏸",
          suspended_for_approval: "⏸", queued: "⏳"
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
          // Cancel the most recently started running task.
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
        // Send in 4000-char chunks.
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

/**
 * Handles a Telegram (or other remote channel) message that has no runId —
 * i.e. the user is starting a new task. Constructs an intent from the message
 * text, starts the run, binds the chatId for outbound routing, and sends a
 * start confirmation back to the channel.
 */
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

  // Terminal notification + clearRunState are handled inside plannerLoop via
  // writeHandoff, which fires at every terminal state transition. No onSettled
  // callback needed here to avoid double-notification.
  const run = await bootstrapRunDetached(services, intent);

  // Bind the chatId so all outbound messages for this run route back to the
  // originating Telegram chat (survives process restart via TelegramStateStore).
  // This must happen after bootstrapRunDetached returns the run with its real id.
  if (services.chatBridge instanceof TelegramChatBridge && message.chatId) {
    await services.chatBridge.bindRunToChat(run.id, message.chatId);
  }

  // Start confirmation is sent by initializeTask for source === "telegram".
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
        const pendingAction = run.checkpoint.pendingBrowserAction;
        const denialOutcome = pendingAction
          ? this.services.securityPolicy.resolveDenial(run, pendingAction)
          : "denied";

        if (denialOutcome === "denied_continue") {
          // Resume the planner loop with a note that the action was denied
          const resumedRun = this.services.orchestrator.resumeFromApproval(run, false, message.createdAt);
          // Add a note so the planner knows the action was denied
          resumedRun.checkpoint.notes.push(`Action denied by user: "${pendingAction?.description ?? "unknown"}". Try a different approach.`);
          resumedRun.checkpoint.pendingBrowserAction = undefined;
          await this.services.runCheckpointStore.save(resumedRun);
          await this.logWorkflowEvent(resumedRun.id, "approval_answered", "Approval denied — continuing with alternative.", {
            channel: message.channel,
            approved: "false",
            outcome: "denied_continue"
          });
          return this.resumeExecution(resumedRun);
        }

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
        await this.writeHandoff(cancelledRun);
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
    // Send start confirmation when a run is initiated from a remote channel.
    // Desktop runs are surfaced via the run_updated IPC event instead.
    if (intent.source === "telegram" || intent.source === "scheduler") {
      void this.services.chatBridge.send({
        channel: "telegram",
        runId: runningRun.id,
        text: `⚙ Task started: "${intent.goal.slice(0, 80)}"\nRun: \`${runningRun.id}\``
      }).catch(() => {});
    }

    // Try to reuse the user's currently active browser session instead of opening a new tab.
    // This lets the agent observe what the user is already looking at for context.
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
    await this.writeHandoff(failedRun);
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

    // Inject recovery context so the planner knows this is a resumed run
    const snapshot = current.checkpoint.lastPageModelSnapshot;
    current = {
      ...current,
      checkpoint: {
        ...current.checkpoint,
        recoveryContext: {
          recoveredAt: new Date().toISOString(),
          preInterruptionPageTitle: snapshot?.title ?? current.checkpoint.lastPageTitle,
          preInterruptionPageSummary: snapshot?.summary ?? current.checkpoint.lastPageSummary,
          preInterruptionVisibleText: snapshot?.visibleText,
          preInterruptionScrollY: snapshot?.scrollY,
          preInterruptionFormValues: snapshot?.formValues,
        }
      }
    };

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
        await this.writeHandoff(failedRun);
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
        const pendingAction = run.checkpoint.pendingBrowserAction;
        const denialOutcome = pendingAction
          ? this.services.securityPolicy.resolveDenial(run, pendingAction)
          : "denied";

        if (denialOutcome === "denied_continue") {
          const resumedRun = this.services.orchestrator.resumeFromApproval(run, false, message.createdAt);
          resumedRun.checkpoint.notes.push(`Action denied by user: "${pendingAction?.description ?? "unknown"}". Try a different approach.`);
          resumedRun.checkpoint.pendingBrowserAction = undefined;
          await this.services.runCheckpointStore.save(resumedRun);
          await this.logWorkflowEvent(resumedRun.id, "approval_answered", "Approval denied — continuing with alternative.", {
            channel: message.channel,
            approved: "false",
            outcome: "denied_continue"
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
        await this.writeHandoff(cancelledRun);
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
        await this.writeHandoff(current);
        return current;
      }

      await this.logWorkflowEvent(current.id, "planner_decision", decision.reasoning, {
        plannerDecision: decision.type
      });

      // Clear recovery context after it has been consumed by the first planner call
      if (current.checkpoint.recoveryContext) {
        current = { ...current, checkpoint: { ...current.checkpoint, recoveryContext: undefined } };
        await this.services.runCheckpointStore.save(current);
      }

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
          await this.writeHandoff(current);
          return current;
        }

        const result = await this.services.browserKernel.executeAction(session, action);
        current = this.services.orchestrator.recordBrowserResult(current, result);
        await this.logWorkflowEvent(current.id, "browser_action_executed", result.summary, {
          actionType: action.type,
          ok: String(result.ok)
        });
        // Step progress — only sent when operator has opted into verbose mode.
        if (this.services.chatBridge.shouldSendStepProgress()) {
          const stepNum = current.checkpoint.stepCount ?? 0;
          const stepText = `Step ${stepNum}: ${result.ok ? "✓" : "✗"} ${action.type} — "${action.description}"`;
          void this.services.chatBridge.send({ channel: "telegram", runId: current.id, text: stepText })
            .catch(() => {});
        }

        if (!result.ok) {
          // Soft failures (element not found) let the planner retry with fresh page context.
          // Hard failures (navigation timeout, validation errors) terminate the run.
          if (result.failureClass !== "element_not_found") {
            current = this.services.orchestrator.failRun(current, result.summary);
            await this.services.runCheckpointStore.save(current);
            await this.logWorkflowEvent(current.id, "run_failed", current.outcome?.summary ?? "Failed", {
              failureClass: result.failureClass ?? "unknown"
            });
            await this.writeHandoff(current);
            return current;
          }
          // Guard against infinite soft-failure loops.
          const softCount = current.checkpoint.consecutiveSoftFailures ?? 0;
          if (softCount >= MAX_CONSECUTIVE_SOFT_FAILURES) {
            const msg = `Stuck: ${softCount} consecutive element-not-found failures. Last action: "${action.description}". The planner should try a different approach.`;
            current = this.services.orchestrator.failRun(current, msg);
            await this.services.runCheckpointStore.save(current);
            await this.logWorkflowEvent(current.id, "run_failed", current.outcome?.summary ?? "Failed", {
              failureClass: "element_not_found",
              consecutiveSoftFailures: String(softCount)
            });
            await this.writeHandoff(current);
            return current;
          }
          await this.services.runCheckpointStore.save(current);
          continue;
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
        await this.writeHandoff(current);
        return current;
      }
    }

    current = this.services.orchestrator.failRun(current, `Planner loop exceeded ${MAX_LOOP_STEPS} steps`);
    await this.services.runCheckpointStore.save(current);
    await this.logWorkflowEvent(current.id, "run_failed", current.outcome?.summary ?? "Failed", {});
    await this.writeHandoff(current);
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

  private async writeHandoff(run: TaskRun, pageModelSnapshot?: PageModel): Promise<void> {
    // Capture current page model if session is still alive and no snapshot was provided
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
    await emitHandoffEvent(this.services, run, snapshot);
    await notifyTerminalEvent(this.services, run);
    await this.services.chatBridge.clearRunState?.(run.id);
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
  if (!message.runId) {
    // No runId = new task initiation. Filter out bare bot commands (handled separately).
    if (message.text.trimStart().startsWith("/")) return null;
    return handleNewTaskMessage(services, message);
  }
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
  await emitHandoffEvent(services, cancelledRun);
  await notifyTerminalEvent(services, cancelledRun);
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
