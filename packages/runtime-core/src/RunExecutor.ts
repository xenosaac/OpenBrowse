import type { BrowserAction, BrowserSession, PageModel, TaskRun, WorkflowEvent } from "@openbrowse/contracts";
import type { RuntimeServices } from "./types.js";
import type { SessionManager } from "./SessionManager.js";
import type { CancellationController } from "./CancellationController.js";
import type { HandoffManager } from "./HandoffManager.js";
import { createWorkflowEvent, appendWorkflowEvent } from "./workflowEvents.js";

const MAX_LOOP_STEPS = 20;
const MAX_CONSECUTIVE_SOFT_FAILURES = 5;
const MAX_CONSECUTIVE_IDENTICAL_ACTIONS = 3;

/**
 * Owns the planner loop core: page model → planner decision → execute action.
 * Delegates session lifecycle to SessionManager, cancellation to CancellationController,
 * and handoff to HandoffManager.
 */
export class RunExecutor {
  constructor(
    private readonly services: RuntimeServices,
    private readonly sessions: SessionManager,
    private readonly cancellation: CancellationController,
    private readonly handoff: HandoffManager
  ) {}

  async plannerLoop(run: TaskRun, session: BrowserSession): Promise<TaskRun> {
    let current = run;
    let consecutiveIdenticalActions = 0;
    let lastActionKey = "";
    for (let step = 0; step < MAX_LOOP_STEPS; step++) {
      // Cooperative cancellation check at top of loop
      if (this.cancellation.isCancelled(current.id)) {
        this.cancellation.acknowledge(current.id);
        const latest = await this.services.runCheckpointStore.load(current.id);
        return latest ?? current;
      }

      const pageModel = await this.services.browserKernel.capturePageModel(session);
      current = this.services.orchestrator.observePage(current, pageModel, session.id);
      await this.services.runCheckpointStore.save(current);

      await this.logEvent(current.id, "page_modeled", `Captured page: ${pageModel.title}`, {
        url: pageModel.url,
        pageModelId: pageModel.id
      });
      await this.logEvent(current.id, "planner_request_started", `Requesting planner decision for ${pageModel.title || pageModel.url}`, {
        url: pageModel.url,
        plannerMode: this.services.descriptor.planner.mode
      });

      let decision;
      try {
        decision = await this.services.planner.decide({ run: current, pageModel });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.logEvent(current.id, "planner_request_failed", `Planner request failed: ${message}`, {
          url: pageModel.url,
          plannerMode: this.services.descriptor.planner.mode
        });
        current = this.services.orchestrator.failRun(current, `Planner request failed: ${message}`);
        await this.services.runCheckpointStore.save(current);
        await this.logEvent(current.id, "run_failed", current.outcome?.summary ?? "Failed", {});
        await this.handoff.writeHandoff(current);
        return current;
      }

      // Check cancellation after planner (may have taken seconds)
      if (this.cancellation.isCancelled(current.id)) {
        this.cancellation.acknowledge(current.id);
        const latest = await this.services.runCheckpointStore.load(current.id);
        return latest ?? current;
      }

      // Also check checkpoint-based cancellation for backward compat
      const freshRun = await this.services.runCheckpointStore.load(current.id);
      if (freshRun && (freshRun.status === "cancelled" || freshRun.status === "failed")) {
        return freshRun;
      }

      await this.logEvent(current.id, "planner_decision", decision.reasoning, {
        plannerDecision: decision.type
      });

      // Clear recovery context after first planner call consumes it
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
          await this.logEvent(current.id, "approval_requested", approvalRequest.question, {
            requestId: approvalRequest.id
          });
          await this.handoff.writeHandoff(current);
          return current;
        }

        let result;
        try {
          result = await this.services.browserKernel.executeAction(session, action);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("Session not found")) {
            const latestRun = await this.services.runCheckpointStore.load(current.id);
            if (latestRun && (latestRun.status === "cancelled" || latestRun.status === "failed")) {
              return latestRun;
            }
            current = this.services.orchestrator.failRun(current, `Browser session lost: ${msg}`);
            await this.services.runCheckpointStore.save(current);
            await this.logEvent(current.id, "run_failed", current.outcome?.summary ?? "Failed", {});
            await this.handoff.writeHandoff(current);
            return current;
          }
          throw err;
        }
        current = this.services.orchestrator.recordBrowserResult(current, result);
        await this.logEvent(current.id, "browser_action_executed", result.summary, {
          actionType: action.type,
          ok: String(result.ok)
        });
        if (this.services.chatBridge.shouldSendStepProgress()) {
          const stepNum = current.checkpoint.stepCount ?? 0;
          const stepText = `Step ${stepNum}: ${result.ok ? "\u2713" : "\u2717"} ${action.type} \u2014 "${action.description}"`;
          void this.services.chatBridge.send({ channel: "telegram", runId: current.id, text: stepText })
            .catch(() => {});
        }

        if (!result.ok) {
          if (result.failureClass !== "element_not_found" && result.failureClass !== "network_error") {
            current = this.services.orchestrator.failRun(current, result.summary);
            await this.services.runCheckpointStore.save(current);
            await this.logEvent(current.id, "run_failed", current.outcome?.summary ?? "Failed", {
              failureClass: result.failureClass ?? "unknown"
            });
            await this.handoff.writeHandoff(current);
            return current;
          }
          const softCount = current.checkpoint.consecutiveSoftFailures ?? 0;
          if (softCount >= MAX_CONSECUTIVE_SOFT_FAILURES) {
            const msg = `Stuck: ${softCount} consecutive element-not-found failures. Last action: "${action.description}". The planner should try a different approach.`;
            current = this.services.orchestrator.failRun(current, msg);
            await this.services.runCheckpointStore.save(current);
            await this.logEvent(current.id, "run_failed", current.outcome?.summary ?? "Failed", {
              failureClass: "element_not_found",
              consecutiveSoftFailures: String(softCount)
            });
            await this.handoff.writeHandoff(current);
            return current;
          }
          await this.services.runCheckpointStore.save(current);
          continue;
        }

        // Detect consecutive identical actions
        const actionKey = `${action.type}:${pageModel.url}`;
        if (actionKey === lastActionKey) {
          consecutiveIdenticalActions++;
          if (consecutiveIdenticalActions >= MAX_CONSECUTIVE_IDENTICAL_ACTIONS) {
            const msg = `Stuck: repeated "${action.type}" on ${pageModel.url} ${consecutiveIdenticalActions} times. The task may not be actionable.`;
            current = this.services.orchestrator.failRun(current, msg);
            await this.services.runCheckpointStore.save(current);
            await this.logEvent(current.id, "run_failed", current.outcome?.summary ?? "Failed", {});
            await this.handoff.writeHandoff(current);
            return current;
          }
        } else {
          consecutiveIdenticalActions = 0;
          lastActionKey = actionKey;
        }

        // Cycle detection: A-B-A-B (length 2) and A-B-C-A-B-C (length 3)
        const recentKeys = (current.checkpoint.actionHistory ?? [])
          .slice(-6)
          .map(r => `${r.type}:${r.targetUrl ?? r.url ?? ""}`);

        if (recentKeys.length >= 4) {
          const l4 = recentKeys.slice(-4);
          if (l4[0] === l4[2] && l4[1] === l4[3]) {
            const msg = `Stuck in cycle: alternating between actions. Try a completely different strategy.`;
            current = this.services.orchestrator.failRun(current, msg);
            await this.services.runCheckpointStore.save(current);
            await this.logEvent(current.id, "run_failed", current.outcome?.summary ?? "Failed", {});
            await this.handoff.writeHandoff(current);
            return current;
          }
        }

        if (recentKeys.length >= 6) {
          const l6 = recentKeys.slice(-6);
          if (l6[0] === l6[3] && l6[1] === l6[4] && l6[2] === l6[5]) {
            const msg = `Stuck in 3-step cycle. Try a completely different strategy.`;
            current = this.services.orchestrator.failRun(current, msg);
            await this.services.runCheckpointStore.save(current);
            await this.logEvent(current.id, "run_failed", current.outcome?.summary ?? "Failed", {});
            await this.handoff.writeHandoff(current);
            return current;
          }
        }

        await this.services.runCheckpointStore.save(current);
        continue;
      }

      current = this.services.orchestrator.applyPlannerDecision(current, decision);
      await this.services.runCheckpointStore.save(current);

      if (decision.clarificationRequest) {
        await this.services.chatBridge.sendClarification(decision.clarificationRequest);
        await this.logEvent(current.id, "clarification_requested", decision.clarificationRequest.question, {
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
          await this.logEvent(current.id, "run_completed", current.outcome?.summary ?? "Done", {});
        } else if (current.status === "failed") {
          await this.logEvent(current.id, "run_failed", current.outcome?.summary ?? "Failed", {});
        }
        await this.handoff.writeHandoff(current);
        return current;
      }
    }

    current = this.services.orchestrator.failRun(current, `Planner loop exceeded ${MAX_LOOP_STEPS} steps`);
    await this.services.runCheckpointStore.save(current);
    await this.logEvent(current.id, "run_failed", current.outcome?.summary ?? "Failed", {});
    await this.handoff.writeHandoff(current);
    return current;
  }

  async continueResume(run: TaskRun, session: BrowserSession, pendingAction?: BrowserAction): Promise<TaskRun> {
    let current = run;

    // Inject recovery context
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
      await this.logEvent(current.id, "browser_action_executed", result.summary, {
        actionType: pendingAction.type,
        ok: String(result.ok),
        resumed: "true"
      });

      if (!result.ok) {
        const failedRun = this.services.orchestrator.failRun(current, result.summary);
        await this.services.runCheckpointStore.save(failedRun);
        await this.logEvent(failedRun.id, "run_failed", failedRun.outcome?.summary ?? "Failed", {});
        await this.handoff.writeHandoff(failedRun);
        return failedRun;
      }
    }

    return this.plannerLoop(current, session);
  }

  private async logEvent(
    runId: string,
    type: WorkflowEvent["type"],
    summary: string,
    payload: Record<string, string>
  ): Promise<void> {
    const event = createWorkflowEvent(runId, type, summary, payload);
    await appendWorkflowEvent(this.services.workflowLogStore, this.services.eventBus, event);
  }
}
