import type { BrowserAction, BrowserActionFailureClass, BrowserSession, PageModel, TaskRun, WorkflowEvent } from "@openbrowse/contracts";
import { MAX_PLANNER_STEPS } from "@openbrowse/planner";
import type { RuntimeServices } from "./types.js";
import type { SessionManager } from "./SessionManager.js";
import type { CancellationController } from "./CancellationController.js";
import type { HandoffManager } from "./HandoffManager.js";
import { createWorkflowEvent, appendWorkflowEvent } from "./workflowEvents.js";
const MAX_CONSECUTIVE_SOFT_FAILURES = 5;
const MAX_TOTAL_SOFT_FAILURES = 8;
const MAX_CONSECUTIVE_IDENTICAL_ACTIONS = 8;
const MAX_URL_VISITS_BEFORE_FAIL = 12;
const CYCLE_DETECTION_WINDOW = 20;

/**
 * Failure classes that are recoverable — the planner gets another iteration to
 * try a different approach.  Safety nets (MAX_CONSECUTIVE_SOFT_FAILURES,
 * MAX_TOTAL_SOFT_FAILURES) prevent infinite loops.
 */
const SOFT_FAILURE_CLASSES: ReadonlySet<BrowserActionFailureClass> = new Set([
  "element_not_found",
  "network_error",
  "interaction_failed",
  "navigation_timeout",
  "validation_error",
]);

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
    let activeSession = session;
    const stuckState = { consecutiveIdenticalActions: 0, lastActionKey: "" };

    // On-demand screenshot: stored when the planner calls browser_screenshot,
    // included as screenshotBase64 in the *next* planner call, then cleared.
    let pendingScreenshot: string | null = null;

    // Initialize openedTabs with primary session if not yet tracked
    if (!current.checkpoint.openedTabs || current.checkpoint.openedTabs.length === 0) {
      current = {
        ...current,
        checkpoint: {
          ...current.checkpoint,
          openedTabs: [{ index: 0, sessionId: session.id, url: session.pageUrl, title: "" }],
          activeTabIndex: 0
        }
      };
    }

    // Session lookup map for tab switching
    const tabSessions = new Map<number, BrowserSession>();
    tabSessions.set(0, session);

    for (let step = 0; step < MAX_PLANNER_STEPS; step++) {
      // Cooperative cancellation check at top of loop
      if (this.cancellation.isCancelled(current.id)) {
        this.cancellation.acknowledge(current.id);
        const latest = await this.services.runCheckpointStore.load(current.id);
        return latest ?? current;
      }

      let pageModel: PageModel;
      try {
        pageModel = await this.services.browserKernel.capturePageModel(activeSession);
      } catch (firstErr) {
        // Retry once after a brief settle
        await new Promise(r => setTimeout(r, 500));
        try {
          pageModel = await this.services.browserKernel.capturePageModel(activeSession);
        } catch (secondErr) {
          const msg = secondErr instanceof Error ? secondErr.message : String(secondErr);
          // Session destroyed (tab closed) — cancel cleanly instead of failing
          if (msg.includes("Session not found")) {
            const latestRun = await this.services.runCheckpointStore.load(current.id);
            if (latestRun && (latestRun.status === "cancelled" || latestRun.status === "failed")) {
              return latestRun;
            }
            current = this.services.orchestrator.cancelRun(current, "Task cancelled: browser tab was closed.");
            await this.services.runCheckpointStore.save(current);
            await this.logEvent(current.id, "run_cancelled", current.outcome?.summary ?? "Cancelled", {});
            await this.handoff.writeHandoff(current);
            return current;
          }
          // Non-"Session not found" errors from destroyed sessions (e.g. "Object has
          // been destroyed", "Debugger is not attached") should not continue the loop
          // if the run was already cancelled externally (e.g. tab closed).
          const maybeTerminal = await this.services.runCheckpointStore.load(current.id);
          if (maybeTerminal && (maybeTerminal.status === "cancelled" || maybeTerminal.status === "failed")) {
            return maybeTerminal;
          }
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
      current = this.services.orchestrator.observePage(current, pageModel, activeSession.id);

      // Keep openedTabs URL/title in sync with latest page model
      const activeIdx = current.checkpoint.activeTabIndex ?? 0;
      const tabs = current.checkpoint.openedTabs;
      if (tabs) {
        const tab = tabs.find(t => t.index === activeIdx);
        if (tab && (tab.url !== pageModel.url || tab.title !== pageModel.title)) {
          tab.url = pageModel.url;
          tab.title = pageModel.title;
          current = { ...current, checkpoint: { ...current.checkpoint, openedTabs: [...tabs] } };
        }
      }

      await this.services.runCheckpointStore.save(current);

      await this.logEvent(current.id, "page_modeled", `Captured page: ${pageModel.title}`, {
        url: pageModel.url,
        pageModelId: pageModel.id
      });
      await this.logEvent(current.id, "planner_request_started", `Requesting planner decision for ${pageModel.title || pageModel.url}`, {
        url: pageModel.url,
        plannerMode: this.services.descriptor.planner.mode
      });

      // Include on-demand screenshot from previous step's browser_screenshot call
      const screenshotForThisStep = pendingScreenshot;
      pendingScreenshot = null; // Clear after one use

      let decision;
      try {
        decision = await this.services.planner.decide({
          run: current,
          pageModel,
          ...(screenshotForThisStep ? { screenshotBase64: screenshotForThisStep } : {})
        });
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

        // Handle save_note locally — no browser kernel interaction needed
        if (action.type === "save_note") {
          const noteKey = action.interactionHint ?? "note";
          const noteValue = action.value ?? "";
          const existing = current.checkpoint.plannerNotes ?? [];
          // Upsert: replace existing note with same key, or append
          const idx = existing.findIndex(n => n.key === noteKey);
          const updated = [...existing];
          if (idx >= 0) {
            updated[idx] = { key: noteKey, value: noteValue };
          } else {
            updated.push({ key: noteKey, value: noteValue });
          }
          // Cap at 20 notes to prevent unbounded growth
          const plannerNotes = updated.slice(-20);
          const syntheticResult = {
            ok: true as const,
            action,
            summary: `Saved note: "${noteKey}"`,
          };
          current = this.services.orchestrator.recordBrowserResult(current, syntheticResult);
          current = {
            ...current,
            checkpoint: { ...current.checkpoint, plannerNotes }
          };
          await this.services.runCheckpointStore.save(current);
          await this.logEvent(current.id, "browser_action_executed", syntheticResult.summary, {
            actionType: action.type,
            ok: "true",
            description: action.description
          });
          const noteStuck = await this.checkStuckAfterAction(action, pageModel, current, stuckState);
          if (noteStuck) return noteStuck;
          continue;
        }

        // Handle screenshot — capture and store for the next planner call
        if (action.type === "screenshot") {
          let screenshotData: string | null = null;
          try {
            screenshotData = await this.services.browserKernel.captureScreenshot(activeSession);
          } catch {
            // Capture failed — proceed without screenshot
          }
          pendingScreenshot = screenshotData;
          const syntheticResult = {
            ok: true as const,
            action,
            summary: screenshotData
              ? "Screenshot captured — visual context will be available on your next step."
              : "Screenshot capture failed — proceeding without visual context.",
          };
          current = this.services.orchestrator.recordBrowserResult(current, syntheticResult);
          await this.services.runCheckpointStore.save(current);
          await this.logEvent(current.id, "browser_action_executed", syntheticResult.summary, {
            actionType: action.type,
            ok: "true",
            description: action.description
          });
          const screenshotStuck = await this.checkStuckAfterAction(action, pageModel, current, stuckState);
          if (screenshotStuck) return screenshotStuck;
          continue;
        }

        // Handle upload_file — suspend with clarification asking for file path
        if (action.type === "upload_file") {
          const targetId = action.targetId;
          if (!targetId) {
            current = this.services.orchestrator.failRun(current, "upload_file action missing targetId");
            await this.services.runCheckpointStore.save(current);
            await this.logEvent(current.id, "run_failed", current.outcome?.summary ?? "Failed", {});
            await this.handoff.writeHandoff(current);
            return current;
          }
          const label = action.description ?? "file input";
          const clarifyId = `clarify_file_${current.id}_${Date.now()}`;
          const question = `This form has a file upload field: "${label}". Please provide the full path to the file you'd like to upload.`;

          current = {
            ...current,
            status: "suspended_for_clarification" as const,
            updatedAt: new Date().toISOString(),
            checkpoint: {
              ...current.checkpoint,
              summary: `Waiting for file path: ${label}`,
              pendingClarificationId: clarifyId,
              pendingBrowserAction: action,
              stopReason: `Waiting for file path: ${label}`,
            },
            suspension: {
              type: "clarification" as const,
              requestId: clarifyId,
              question,
              createdAt: new Date().toISOString(),
            }
          };
          await this.services.runCheckpointStore.save(current);
          await this.services.chatBridge.sendClarification({
            id: clarifyId,
            runId: current.id,
            question,
            contextSummary: `File upload needed for: ${label}`,
            options: [],
            createdAt: new Date().toISOString()
          });
          await this.logEvent(current.id, "clarification_requested", question, {
            requestId: clarifyId
          });
          await this.handoff.writeHandoff(current);
          return current;
        }

        // Handle open_in_new_tab — create new session and navigate
        if (action.type === "open_in_new_tab") {
          const url = action.value;
          if (!url) {
            current = this.services.orchestrator.failRun(current, "open_in_new_tab action missing url");
            await this.services.runCheckpointStore.save(current);
            await this.logEvent(current.id, "run_failed", current.outcome?.summary ?? "Failed", {});
            await this.handoff.writeHandoff(current);
            return current;
          }
          const { session: newSession } = await this.sessions.openAdditionalTab(current);
          const navResult = await this.services.browserKernel.executeAction(newSession, {
            type: "navigate",
            value: url,
            description: `Navigate new tab to ${url}`
          });
          const tabs = current.checkpoint.openedTabs ?? [];
          const newIndex = tabs.length;
          tabSessions.set(newIndex, newSession);
          const updatedTabs = [...tabs, { index: newIndex, sessionId: newSession.id, url, title: "" }];
          const syntheticResult = {
            ok: navResult.ok,
            action,
            summary: `Opened tab ${newIndex}: ${url}`,
            failureClass: navResult.failureClass,
          };
          current = this.services.orchestrator.recordBrowserResult(current, syntheticResult);
          current = { ...current, checkpoint: { ...current.checkpoint, openedTabs: updatedTabs } };
          await this.services.runCheckpointStore.save(current);
          await this.logEvent(current.id, "browser_action_executed", syntheticResult.summary, {
            actionType: action.type,
            ok: String(navResult.ok),
            description: action.description,
            tabIndex: String(newIndex)
          });
          const newTabStuck = await this.checkStuckAfterAction(action, pageModel, current, stuckState);
          if (newTabStuck) return newTabStuck;
          continue;
        }

        // Handle switch_tab — swap active session
        if (action.type === "switch_tab") {
          const targetIndex = parseInt(action.value ?? "", 10);
          const tabs = current.checkpoint.openedTabs ?? [];
          const targetTab = tabs.find(t => t.index === targetIndex);
          if (!targetTab) {
            const syntheticResult = {
              ok: false as const,
              action,
              summary: `Tab ${targetIndex} not found. Available tabs: ${tabs.map(t => t.index).join(", ")}`,
              failureClass: "validation_error" as const,
            };
            current = this.services.orchestrator.recordBrowserResult(current, syntheticResult);
            await this.services.runCheckpointStore.save(current);
            await this.logEvent(current.id, "browser_action_executed", syntheticResult.summary, {
              actionType: action.type, ok: "false", description: action.description
            });
            continue;
          }
          let targetSession = tabSessions.get(targetIndex);
          if (!targetSession) {
            const fetched = await this.sessions.getSession(targetTab.sessionId);
            if (fetched) {
              targetSession = fetched;
              tabSessions.set(targetIndex, fetched);
            }
          }
          if (!targetSession) {
            const syntheticResult = {
              ok: false as const,
              action,
              summary: `Session for tab ${targetIndex} is no longer available.`,
              failureClass: "interaction_failed" as const,
            };
            current = this.services.orchestrator.recordBrowserResult(current, syntheticResult);
            await this.services.runCheckpointStore.save(current);
            continue;
          }
          activeSession = targetSession;
          const syntheticResult = {
            ok: true as const,
            action,
            summary: `Switched to tab ${targetIndex}${targetTab.url ? ` (${targetTab.url})` : ""}`,
          };
          current = this.services.orchestrator.recordBrowserResult(current, syntheticResult);
          current = { ...current, checkpoint: { ...current.checkpoint, activeTabIndex: targetIndex } };
          await this.services.runCheckpointStore.save(current);
          await this.logEvent(current.id, "browser_action_executed", syntheticResult.summary, {
            actionType: action.type, ok: "true", description: action.description, tabIndex: String(targetIndex)
          });
          const switchStuck = await this.checkStuckAfterAction(action, pageModel, current, stuckState);
          if (switchStuck) return switchStuck;
          continue;
        }

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
          result = await this.services.browserKernel.executeAction(activeSession, action);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("Session not found")) {
            const latestRun = await this.services.runCheckpointStore.load(current.id);
            if (latestRun && (latestRun.status === "cancelled" || latestRun.status === "failed")) {
              return latestRun;
            }
            current = this.services.orchestrator.cancelRun(current, "Task cancelled: browser tab was closed.");
            await this.services.runCheckpointStore.save(current);
            await this.logEvent(current.id, "run_cancelled", current.outcome?.summary ?? "Cancelled", {});
            await this.handoff.writeHandoff(current);
            return current;
          }
          // Non-"Session not found" errors from destroyed sessions should not
          // propagate to failUnexpectedRun if the run was already cancelled.
          const latestRun = await this.services.runCheckpointStore.load(current.id);
          if (latestRun && (latestRun.status === "cancelled" || latestRun.status === "failed")) {
            return latestRun;
          }
          throw err;
        }
        current = this.services.orchestrator.recordBrowserResult(current, result);
        await this.logEvent(current.id, "browser_action_executed", result.summary, {
          actionType: action.type,
          ok: String(result.ok),
          description: action.description
        });
        if (this.services.chatBridge.shouldSendStepProgress()) {
          const stepNum = current.checkpoint.stepCount ?? 0;
          const stepText = `Step ${stepNum}: ${result.ok ? "\u2713" : "\u2717"} ${action.type} \u2014 "${action.description}"`;
          void this.services.chatBridge.send({ channel: "telegram", runId: current.id, text: stepText })
            .catch(() => {});
        }

        if (!result.ok) {
          const fc = result.failureClass ?? "unknown";
          if (!SOFT_FAILURE_CLASSES.has(fc as BrowserActionFailureClass)) {
            current = this.services.orchestrator.failRun(current, result.summary);
            await this.services.runCheckpointStore.save(current);
            await this.logEvent(current.id, "run_failed", current.outcome?.summary ?? "Failed", {
              failureClass: fc
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
        const actionStuck = await this.checkStuckAfterAction(action, pageModel, current, stuckState);
        if (actionStuck) return actionStuck;

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

    current = this.services.orchestrator.failRun(current, `Planner loop exceeded ${MAX_PLANNER_STEPS} steps`);
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
        resumed: "true",
        description: pendingAction.description ?? ""
      });

      if (!result.ok) {
        // Soft failures are recoverable on resume — the page DOM likely changed
        // after re-navigation, so the planner should retry with fresh context.
        const fc = result.failureClass ?? "unknown";
        if (SOFT_FAILURE_CLASSES.has(fc as BrowserActionFailureClass)) {
          current.checkpoint.notes.push(
            `Pending action "${pendingAction.description}" failed after resume (${fc}). The page state may have changed. Trying a different approach.`
          );
          await this.services.runCheckpointStore.save(current);
        } else {
          const failedRun = this.services.orchestrator.failRun(current, result.summary);
          await this.services.runCheckpointStore.save(failedRun);
          await this.logEvent(failedRun.id, "run_failed", failedRun.outcome?.summary ?? "Failed", {});
          await this.handoff.writeHandoff(failedRun);
          return failedRun;
        }
      }
    }

    return this.plannerLoop(current, session);
  }

  /**
   * Run stuck detection checks after any action (normal or special-handler).
   * Returns the failed TaskRun if stuck, or null to continue.
   */
  private async checkStuckAfterAction(
    action: { type: string; targetId?: string; description: string },
    pageModel: PageModel,
    current: TaskRun,
    stuckState: { consecutiveIdenticalActions: number; lastActionKey: string }
  ): Promise<TaskRun | null> {
    // 1. Consecutive identical actions
    const actionKey = `${action.type}:${action.targetId ?? ""}:${action.description}:${pageModel.url}`;
    if (actionKey === stuckState.lastActionKey) {
      stuckState.consecutiveIdenticalActions++;
      if (stuckState.consecutiveIdenticalActions >= MAX_CONSECUTIVE_IDENTICAL_ACTIONS) {
        return this.failStuck(current, `Stuck: repeated "${action.type}" on ${pageModel.url} ${stuckState.consecutiveIdenticalActions} times.`);
      }
    } else {
      stuckState.consecutiveIdenticalActions = 0;
      stuckState.lastActionKey = actionKey;
    }

    // 2. URL visit count — detect excessive revisiting
    const urlCounts = current.checkpoint.urlVisitCounts ?? {};
    const visits = urlCounts[pageModel.url] ?? 0;
    if (visits >= MAX_URL_VISITS_BEFORE_FAIL) {
      return this.failStuck(current, `Stuck: visited ${pageModel.url} ${visits} times. Moving on is not working.`);
    }

    // 3. Cycle detection: 2/3/4/5-step cycles over extended window
    const recentKeys = (current.checkpoint.actionHistory ?? [])
      .slice(-CYCLE_DETECTION_WINDOW)
      .map(r => `${r.type}:${r.targetId ?? ""}:${r.description}:${r.targetUrl ?? r.url ?? ""}`);
    const cycleLength = detectCycle(recentKeys);
    if (cycleLength > 0) {
      return this.failStuck(current, `Stuck in ${cycleLength}-step cycle. The agent is repeating the same sequence of actions.`);
    }

    return null;
  }

  private async failStuck(current: TaskRun, message: string): Promise<TaskRun> {
    const failed = this.services.orchestrator.failRun(current, message);
    await this.services.runCheckpointStore.save(failed);
    await this.logEvent(failed.id, "run_failed", failed.outcome?.summary ?? "Failed", {});
    await this.handoff.writeHandoff(failed);
    return failed;
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
