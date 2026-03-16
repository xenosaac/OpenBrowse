import type { BrowserAction, BrowserSession, PageModel, TaskRun, WorkflowEvent } from "@openbrowse/contracts";
import type { RuntimeServices } from "./types.js";
import type { SessionManager } from "./SessionManager.js";
import type { CancellationController } from "./CancellationController.js";
import type { HandoffManager } from "./HandoffManager.js";
import { createWorkflowEvent, appendWorkflowEvent } from "./workflowEvents.js";

const MAX_LOOP_STEPS = 35;
const MAX_CONSECUTIVE_SOFT_FAILURES = 5;
const MAX_TOTAL_SOFT_FAILURES = 8;
const MAX_CONSECUTIVE_IDENTICAL_ACTIONS = 8;
const MAX_URL_VISITS_BEFORE_FAIL = 12;
const CYCLE_DETECTION_WINDOW = 20;

/**
 * Detect repeating cycles of length 2–5 in an array of action keys.
 * Short cycles (len 2) require 4 full repetitions to avoid false positives
 * on legitimate sequences like "click Play → click Close modal".
 * Longer cycles (len 3–5) require 3 full repetitions.
 * Returns cycle length or 0.
 */
export function detectCycle(keys: string[]): number {
  for (let len = 2; len <= 5; len++) {
    const reps = len === 2 ? 4 : 3;
    const needed = len * reps;
    if (keys.length < needed) continue;
    const tail = keys.slice(-needed);
    let isCycle = true;
    for (let i = 0; i < len; i++) {
      for (let r = 1; r < reps; r++) {
        if (tail[i] !== tail[i + len * r]) {
          isCycle = false; break;
        }
      }
      if (!isCycle) break;
    }
    if (isCycle) return len;
  }
  return 0;
}

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

      let pageModel: PageModel;
      try {
        pageModel = await this.services.browserKernel.capturePageModel(session);
      } catch (firstErr) {
        // Retry once after a brief settle
        await new Promise(r => setTimeout(r, 500));
        try {
          pageModel = await this.services.browserKernel.capturePageModel(session);
        } catch (secondErr) {
          const msg = secondErr instanceof Error ? secondErr.message : String(secondErr);
          await this.logEvent(current.id, "planner_request_failed", `capturePageModel failed twice: ${msg}`, {});
          // Use minimal fallback so the loop can continue or fail gracefully
          pageModel = {
            id: `pm_fallback_${Date.now()}`,
            url: current.checkpoint.lastKnownUrl ?? "unknown",
            title: current.checkpoint.lastPageTitle ?? "Page capture failed",
            summary: "Page model capture failed. The page may be loading or the browser session may be unresponsive.",
            elements: [],
            visibleText: "",
            createdAt: new Date().toISOString(),
            forms: [],
            alerts: ["PAGE_MODEL_CAPTURE_FAILED"],
            captchaDetected: false,
          };
        }
      }
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
          // Check consecutive soft failures
          const softCount = current.checkpoint.consecutiveSoftFailures ?? 0;
          if (softCount >= MAX_CONSECUTIVE_SOFT_FAILURES) {
            const msg = `Stuck: ${softCount} consecutive soft failures. Last: "${action.description}".`;
            current = this.services.orchestrator.failRun(current, msg);
            await this.services.runCheckpointStore.save(current);
            await this.logEvent(current.id, "run_failed", current.outcome?.summary ?? "Failed", {
              failureClass: "element_not_found",
              consecutiveSoftFailures: String(softCount)
            });
            await this.handoff.writeHandoff(current);
            return current;
          }
          // Check total soft failures (never resets — catches intermittent failure patterns)
          const totalSoft = current.checkpoint.totalSoftFailures ?? 0;
          if (totalSoft >= MAX_TOTAL_SOFT_FAILURES) {
            const msg = `Too many failures: ${totalSoft} total soft failures across this run. The task may not be achievable with the current approach.`;
            current = this.services.orchestrator.failRun(current, msg);
            await this.services.runCheckpointStore.save(current);
            await this.logEvent(current.id, "run_failed", current.outcome?.summary ?? "Failed", {
              totalSoftFailures: String(totalSoft)
            });
            await this.handoff.writeHandoff(current);
            return current;
          }
          await this.services.runCheckpointStore.save(current);
          continue;
        }

        // --- Stuck detection (only on successful actions — prevents false positives) ---

        // 1. Consecutive identical actions
        const actionKey = `${action.type}:${action.targetId ?? ""}:${action.description}:${pageModel.url}`;
        if (actionKey === lastActionKey) {
          consecutiveIdenticalActions++;
          if (consecutiveIdenticalActions >= MAX_CONSECUTIVE_IDENTICAL_ACTIONS) {
            const msg = `Stuck: repeated "${action.type}" on ${pageModel.url} ${consecutiveIdenticalActions} times.`;
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

        // 2. URL visit count — detect excessive revisiting
        const urlCounts = current.checkpoint.urlVisitCounts ?? {};
        const currentUrlVisits = urlCounts[pageModel.url] ?? 0;
        if (currentUrlVisits >= MAX_URL_VISITS_BEFORE_FAIL) {
          const msg = `Stuck: visited ${pageModel.url} ${currentUrlVisits} times. Moving on is not working.`;
          current = this.services.orchestrator.failRun(current, msg);
          await this.services.runCheckpointStore.save(current);
          await this.logEvent(current.id, "run_failed", current.outcome?.summary ?? "Failed", {});
          await this.handoff.writeHandoff(current);
          return current;
        }

        // 3. Cycle detection: 2/3/4/5-step cycles over extended window
        const recentKeys = (current.checkpoint.actionHistory ?? [])
          .slice(-CYCLE_DETECTION_WINDOW)
          .map(r => `${r.type}:${r.targetId ?? ""}:${r.description}:${r.targetUrl ?? r.url ?? ""}`);

        const cycleLength = detectCycle(recentKeys);
        if (cycleLength > 0) {
          const msg = `Stuck in ${cycleLength}-step cycle. The agent is repeating the same sequence of actions.`;
          current = this.services.orchestrator.failRun(current, msg);
          await this.services.runCheckpointStore.save(current);
          await this.logEvent(current.id, "run_failed", current.outcome?.summary ?? "Failed", {});
          await this.handoff.writeHandoff(current);
          return current;
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
