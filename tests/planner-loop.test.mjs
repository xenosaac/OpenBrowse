import test from "node:test";
import assert from "node:assert/strict";

import { TaskOrchestrator, DefaultClarificationPolicy } from "../packages/orchestrator/dist/index.js";
import { ScriptedPlannerGateway } from "../packages/planner/dist/index.js";
import { StubBrowserKernel } from "../packages/browser-runtime/dist/BrowserKernel.js";
import {
  InMemoryRunCheckpointStore,
  InMemoryWorkflowLogStore,
  InMemoryPreferenceStore
} from "../packages/memory-store/dist/index.js";
import { EventBus } from "../packages/observability/dist/index.js";
import { StubChatBridge } from "../packages/chat-bridge/dist/index.js";
import { DefaultApprovalPolicy } from "../packages/security/dist/index.js";

// ---- Constants (matching OpenBrowseRuntime) ----

const MAX_LOOP_STEPS = 35;
const MAX_CONSECUTIVE_SOFT_FAILURES = 5;

// ---- Factories ----

function makeRun(overrides = {}) {
  return {
    id: "run_intent_loop_1",
    taskIntentId: "intent_1",
    status: "running",
    goal: "Test planner loop",
    source: "desktop",
    constraints: [],
    metadata: {},
    createdAt: "2026-03-15T00:00:00Z",
    updatedAt: "2026-03-15T00:00:00Z",
    checkpoint: {
      summary: "Run started.",
      notes: [],
      stepCount: 0,
      actionHistory: [],
      consecutiveSoftFailures: 0,
      ...(overrides.checkpoint ?? {})
    },
    ...overrides,
    checkpoint: {
      summary: "Run started.",
      notes: [],
      stepCount: 0,
      actionHistory: [],
      consecutiveSoftFailures: 0,
      ...(overrides.checkpoint ?? {})
    }
  };
}

/**
 * Create a Proxy-based wrapper around StubBrowserKernel that injects
 * failures at specified executeAction call indices.
 *
 * @param {Object} failureMap - Map of call index → { ok, failureClass, summary }
 */
function createFailableBrowserKernel(failureMap = {}) {
  const inner = new StubBrowserKernel();
  let executeCallCount = 0;

  return new Proxy(inner, {
    get(target, prop) {
      if (prop === "executeAction") {
        return async (session, action) => {
          const idx = executeCallCount++;
          if (failureMap[idx]) {
            const failure = failureMap[idx];
            return {
              ok: failure.ok,
              action,
              summary: failure.summary || "Simulated failure",
              failureClass: failure.failureClass,
              pageModelId: `page_${session.id}`
            };
          }
          return target.executeAction(session, action);
        };
      }
      if (prop === "setPageModelOverride") {
        return (fn) => target.setPageModelOverride(fn);
      }
      const val = target[prop];
      return typeof val === "function" ? val.bind(target) : val;
    }
  });
}

/**
 * Enhanced planner loop that mirrors OpenBrowseRuntime.plannerLoop() (lines 599-745).
 * Handles: soft/hard failures, consecutive soft failure guard, recovery context clearing,
 * approval gating, and step exhaustion.
 */
async function runPlannerLoop(services, intent, options = {}) {
  const { orchestrator, browserKernel, planner, securityPolicy, runCheckpointStore, workflowLogStore } = services;

  // Create and start the run
  let run = orchestrator.startRun(orchestrator.createRun(intent));

  // Apply initial recovery context if provided
  if (options.initialRecoveryContext) {
    run = { ...run, checkpoint: { ...run.checkpoint, recoveryContext: options.initialRecoveryContext } };
  }

  const profile = await browserKernel.ensureProfile();
  const session = await browserKernel.attachSession(profile, {
    runId: run.id, groupId: run.id, taskLabel: intent.goal,
    source: "desktop", status: "running", isBackground: true
  });
  run = orchestrator.attachSession(run, profile.id, session.id);
  await runCheckpointStore.save(run);

  for (let step = 0; step < MAX_LOOP_STEPS; step++) {
    const pageModel = await browserKernel.capturePageModel(session);
    run = orchestrator.observePage(run, pageModel, session.id);
    await runCheckpointStore.save(run);

    let decision;
    try {
      decision = await planner.decide({ run, pageModel });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      run = orchestrator.failRun(run, `Planner request failed: ${message}`);
      await runCheckpointStore.save(run);
      return run;
    }

    // Clear recovery context after first planner call
    if (run.checkpoint.recoveryContext) {
      run = { ...run, checkpoint: { ...run.checkpoint, recoveryContext: undefined } };
      await runCheckpointStore.save(run);
    }

    if (decision.type === "browser_action" && decision.action) {
      const action = decision.action;

      // Security policy check
      if (securityPolicy.requiresApproval(run, action)) {
        const approvalRequest = securityPolicy.buildApprovalRequest(run, action);
        const approvalDecision = { ...decision, type: "approval_request", approvalRequest };
        run = orchestrator.applyPlannerDecision(run, approvalDecision);
        await runCheckpointStore.save(run);
        return run;
      }

      const result = await browserKernel.executeAction(session, action);
      run = orchestrator.recordBrowserResult(run, result);

      if (!result.ok) {
        if (result.failureClass !== "element_not_found") {
          // Hard failure
          run = orchestrator.failRun(run, result.summary);
          await runCheckpointStore.save(run);
          return run;
        }
        // Soft failure — guard against infinite loops
        const softCount = run.checkpoint.consecutiveSoftFailures ?? 0;
        if (softCount >= MAX_CONSECUTIVE_SOFT_FAILURES) {
          const msg = `Stuck: ${softCount} consecutive element-not-found failures. Last action: "${action.description}".`;
          run = orchestrator.failRun(run, msg);
          await runCheckpointStore.save(run);
          return run;
        }
        await runCheckpointStore.save(run);
        continue;
      }

      await runCheckpointStore.save(run);
      continue;
    }

    // Non-browser-action decisions
    run = orchestrator.applyPlannerDecision(run, decision);
    await runCheckpointStore.save(run);

    if (
      run.status === "completed" || run.status === "failed" || run.status === "cancelled" ||
      run.status === "suspended_for_clarification" || run.status === "suspended_for_approval"
    ) {
      return run;
    }
  }

  // Max steps exceeded
  run = orchestrator.failRun(run, `Planner loop exceeded ${MAX_LOOP_STEPS} steps`);
  await runCheckpointStore.save(run);
  return run;
}

function createTestServices(planner, browserKernel) {
  const kernel = browserKernel || new StubBrowserKernel();
  return {
    browserKernel: kernel,
    chatBridge: new StubChatBridge(),
    eventBus: new EventBus(),
    orchestrator: new TaskOrchestrator({ clarificationPolicy: new DefaultClarificationPolicy() }),
    planner,
    preferenceStore: new InMemoryPreferenceStore(),
    runCheckpointStore: new InMemoryRunCheckpointStore(),
    securityPolicy: new DefaultApprovalPolicy(),
    workflowLogStore: new InMemoryWorkflowLogStore()
  };
}

function makeIntent(overrides = {}) {
  return {
    id: "test_loop_intent",
    source: "desktop",
    goal: "Test planner loop",
    constraints: [],
    metadata: {},
    ...overrides
  };
}

// ============================================================================
// Test 1: Soft failure retry — loop continues after element_not_found
// ============================================================================

test("soft failure: planner loop continues after element_not_found", async () => {
  const scenario = {
    id: "soft-fail-test",
    label: "Soft Failure",
    steps: [
      { decision: { type: "browser_action", reasoning: "Click button", action: { type: "click", ref: "el_1", description: "Click the blue button" } } },
      { decision: { type: "browser_action", reasoning: "Click button retry", action: { type: "click", ref: "el_2", description: "Click the green button" } } },
      { decision: { type: "task_complete", reasoning: "Done", completionSummary: "Task completed after retry" } }
    ]
  };

  const planner = new ScriptedPlannerGateway(scenario);
  const kernel = createFailableBrowserKernel({
    0: { ok: false, failureClass: "element_not_found", summary: "Element el_1 not found" }
  });

  const services = createTestServices(planner, kernel);
  const run = await runPlannerLoop(services, makeIntent());

  assert.equal(run.status, "completed");
  assert.ok(run.outcome.summary.includes("completed after retry"));
});

// ============================================================================
// Test 2: 5 consecutive soft failures → Stuck
// ============================================================================

test("5 consecutive soft failures terminates run with Stuck message", async () => {
  // Create 10 browser_action steps — all will fail with element_not_found
  const steps = Array.from({ length: 10 }, (_, i) => ({
    decision: {
      type: "browser_action",
      reasoning: `Attempt ${i + 1}`,
      action: { type: "click", ref: `el_${i}`, description: `Click element ${i}` }
    }
  }));

  const planner = new ScriptedPlannerGateway({ id: "stuck-test", label: "Stuck", steps });

  // All executions fail with element_not_found
  const failureMap = {};
  for (let i = 0; i < 10; i++) {
    failureMap[i] = { ok: false, failureClass: "element_not_found", summary: `Element not found` };
  }
  const kernel = createFailableBrowserKernel(failureMap);

  const services = createTestServices(planner, kernel);
  const run = await runPlannerLoop(services, makeIntent());

  assert.equal(run.status, "failed");
  assert.match(run.outcome.summary, /Stuck/);
  assert.match(run.outcome.summary, /5.*consecutive/);
});

// ============================================================================
// Test 3: Hard failure immediately terminates run
// ============================================================================

test("hard failure (navigation_timeout) immediately terminates run", async () => {
  const scenario = {
    id: "hard-fail-test",
    label: "Hard Failure",
    steps: [
      { decision: { type: "browser_action", reasoning: "Navigate", action: { type: "navigate", value: "https://example.com", description: "Go to site" } } },
      { decision: { type: "browser_action", reasoning: "Click", action: { type: "click", ref: "el_1", description: "Click button" } } },
      { decision: { type: "task_complete", reasoning: "Done", completionSummary: "Should not reach here" } }
    ]
  };

  const planner = new ScriptedPlannerGateway(scenario);
  const kernel = createFailableBrowserKernel({
    0: { ok: false, failureClass: "navigation_timeout", summary: "Navigation timed out after 30s" }
  });

  const services = createTestServices(planner, kernel);
  const run = await runPlannerLoop(services, makeIntent());

  assert.equal(run.status, "failed");
  assert.match(run.outcome.summary, /Navigation timed out/);
});

// ============================================================================
// Test 4: Max step exhaustion after 35 steps
// ============================================================================

test("max step exhaustion: 35+ steps fails with exceeded message", async () => {
  // 40 browser_action steps — all succeed, but loop should stop at 35
  const steps = Array.from({ length: 40 }, (_, i) => ({
    decision: {
      type: "browser_action",
      reasoning: `Step ${i + 1}`,
      action: { type: "click", ref: `el_${i}`, description: `Click element ${i}` }
    }
  }));

  const planner = new ScriptedPlannerGateway({ id: "exhaust-test", label: "Exhaustion", steps });
  const services = createTestServices(planner);
  const run = await runPlannerLoop(services, makeIntent());

  assert.equal(run.status, "failed");
  assert.match(run.outcome.summary, /exceeded 35 steps/);
  assert.equal(run.checkpoint.stepCount, 35);
});

// ============================================================================
// Test 5: planner.decide() throws → run fails
// ============================================================================

test("planner.decide() throws terminates run with planner error", async () => {
  const errorPlanner = {
    async decide() {
      throw new Error("API quota exceeded");
    }
  };

  const services = createTestServices(errorPlanner);
  const run = await runPlannerLoop(services, makeIntent());

  assert.equal(run.status, "failed");
  assert.match(run.outcome.summary, /Planner request failed/);
  assert.match(run.outcome.summary, /API quota exceeded/);
});

// ============================================================================
// Test 6: Security policy flags action → suspended for approval
// ============================================================================

test("security policy flags action, run suspends for approval", async () => {
  const scenario = {
    id: "approval-test",
    label: "Approval",
    steps: [
      {
        decision: {
          type: "browser_action",
          reasoning: "Completing purchase",
          action: { type: "click", ref: "el_buy", description: "Click 'Complete Purchase' to finalize order" }
        }
      }
    ]
  };

  const planner = new ScriptedPlannerGateway(scenario);
  const services = createTestServices(planner);
  const run = await runPlannerLoop(services, makeIntent());

  assert.equal(run.status, "suspended_for_approval");
  assert.ok(run.suspension);
  assert.equal(run.suspension.type, "approval");
  assert.ok(run.checkpoint.pendingBrowserAction);
  assert.equal(run.checkpoint.pendingBrowserAction.type, "click");
  assert.ok(run.checkpoint.pendingApprovalId);
});

// ============================================================================
// Test 7: recoveryContext cleared after first planner iteration
// ============================================================================

test("recoveryContext cleared after first planner iteration", async () => {
  const scenario = {
    id: "recovery-clear-test",
    label: "Recovery Clear",
    steps: [
      { decision: { type: "browser_action", reasoning: "Navigate", action: { type: "navigate", value: "https://example.com", description: "Go to site" } } },
      { decision: { type: "task_complete", reasoning: "Done", completionSummary: "Complete" } }
    ]
  };

  const planner = new ScriptedPlannerGateway(scenario);
  const services = createTestServices(planner);
  const run = await runPlannerLoop(services, makeIntent(), {
    initialRecoveryContext: {
      recoveredAt: "2026-03-15T00:05:00Z",
      preInterruptionPageTitle: "Old Page",
      preInterruptionPageSummary: "Old summary"
    }
  });

  assert.equal(run.status, "completed");
  assert.equal(run.checkpoint.recoveryContext, undefined);

  // Verify checkpoint was saved without recovery context
  const saved = await services.runCheckpointStore.load(run.id);
  assert.equal(saved.checkpoint.recoveryContext, undefined);
});

// ============================================================================
// Test 8: actionHistory accumulates, capped at 25
// ============================================================================

test("actionHistory accumulates and is capped at 25", async () => {
  const steps = Array.from({ length: 27 }, (_, i) => ({
    decision: {
      type: "browser_action",
      reasoning: `Step ${i + 1}`,
      action: { type: "click", ref: `el_${i}`, description: `Click element ${i}` }
    }
  }));
  steps.push({ decision: { type: "task_complete", reasoning: "Done", completionSummary: "Complete" } });

  const planner = new ScriptedPlannerGateway({ id: "history-test", label: "History", steps });
  const services = createTestServices(planner);
  const run = await runPlannerLoop(services, makeIntent());

  assert.equal(run.status, "completed");
  assert.equal(run.checkpoint.actionHistory.length, 25);
  // The first 2 actions should have been trimmed — oldest dropped
  assert.ok(run.checkpoint.actionHistory[0].description.includes("element 2"));
});

// ============================================================================
// Test 9: stepCount increments with each observePage call
// ============================================================================

test("stepCount increments with each observePage call", async () => {
  const steps = Array.from({ length: 5 }, (_, i) => ({
    decision: {
      type: "browser_action",
      reasoning: `Step ${i + 1}`,
      action: { type: "click", ref: `el_${i}`, description: `Click element ${i}` }
    }
  }));
  steps.push({ decision: { type: "task_complete", reasoning: "Done", completionSummary: "Complete" } });

  const planner = new ScriptedPlannerGateway({ id: "step-count-test", label: "Steps", steps });
  const services = createTestServices(planner);
  const run = await runPlannerLoop(services, makeIntent());

  assert.equal(run.status, "completed");
  // 5 browser actions + 1 task_complete iteration = 6 observePage calls
  assert.equal(run.checkpoint.stepCount, 6);
});
