import test from "node:test";
import assert from "node:assert/strict";

import { TaskOrchestrator, DefaultClarificationPolicy } from "../packages/orchestrator/dist/index.js";
import {
  ScriptedPlannerGateway,
  createTravelSearchScenario,
  createAppointmentBookingScenario,
  createPriceMonitorScenario
} from "../packages/planner/dist/index.js";
import { StubBrowserKernel } from "../packages/browser-runtime/dist/BrowserKernel.js";
import {
  InMemoryRunCheckpointStore,
  InMemoryWorkflowLogStore,
  InMemoryPreferenceStore
} from "../packages/memory-store/dist/index.js";
import { EventBus } from "../packages/observability/dist/index.js";
import { StubChatBridge } from "../packages/chat-bridge/dist/index.js";
import { IntervalWatchScheduler } from "../packages/scheduler/dist/index.js";
import { DefaultApprovalPolicy } from "../packages/security/dist/index.js";

/**
 * Helper: create a minimal RuntimeServices-like object for testing demos
 * without requiring Electron or a full desktop bootstrap.
 */
function createTestServices(planner, pageModelOverride) {
  const browserKernel = new StubBrowserKernel();
  if (pageModelOverride) {
    browserKernel.setPageModelOverride(pageModelOverride);
  }

  const runCheckpointStore = new InMemoryRunCheckpointStore();
  const workflowLogStore = new InMemoryWorkflowLogStore();
  const eventBus = new EventBus();

  return {
    browserKernel,
    chatBridge: new StubChatBridge(),
    eventBus,
    orchestrator: new TaskOrchestrator({
      clarificationPolicy: new DefaultClarificationPolicy()
    }),
    planner,
    preferenceStore: new InMemoryPreferenceStore(),
    runCheckpointStore,
    runtimeConfig: {
      platform: "macos",
      siliconOnly: true,
      appName: "OpenBrowse",
      workflowLogPath: "/tmp/openbrowse-test/workflow",
      managedProfilesPath: "/tmp/openbrowse-test/profiles"
    },
    scheduler: new IntervalWatchScheduler(async () => {}),
    securityPolicy: new DefaultApprovalPolicy(),
    pendingCancellations: new Set(),
    workflowLogStore,
    descriptor: {
      phase: "phase3",
      mode: "desktop_runtime",
      planner: { mode: "stub", detail: "test" },
      browser: { mode: "stub", detail: "test" },
      chatBridge: { mode: "stub", detail: "test" },
      storage: { mode: "memory", detail: "test" },
      notes: [],
      deferredCapabilities: []
    }
  };
}

/**
 * Inline implementation of the planner loop from OpenBrowseRuntime,
 * simplified for testing without requiring Electron or full runtime composition.
 */
async function runDemoFlow(services, intent) {
  const { orchestrator, browserKernel, planner, securityPolicy, chatBridge, runCheckpointStore, workflowLogStore, eventBus } = services;

  // Create and start the run
  let run = orchestrator.startRun(orchestrator.createRun(intent));
  const profile = await browserKernel.ensureProfile();
  const session = await browserKernel.attachSession(profile);
  run = orchestrator.attachSession(run, profile.id, session.id);
  await runCheckpointStore.save(run);

  // Log run_created
  await logEvent(workflowLogStore, eventBus, run.id, "run_created", `Task started: ${intent.goal}`, {});

  const MAX_STEPS = 20;

  for (let step = 0; step < MAX_STEPS; step++) {
    const pageModel = await browserKernel.capturePageModel(session);
    run = orchestrator.observePage(run, pageModel, session.id);
    await runCheckpointStore.save(run);
    await logEvent(workflowLogStore, eventBus, run.id, "page_modeled", `Captured page: ${pageModel.title}`, { url: pageModel.url });

    const decision = await planner.decide({ run, pageModel });
    await logEvent(workflowLogStore, eventBus, run.id, "planner_decision", decision.reasoning, { plannerDecision: decision.type });

    if (decision.type === "browser_action" && decision.action) {
      // Check approval policy
      if (securityPolicy.requiresApproval(run, decision.action)) {
        const approvalRequest = securityPolicy.buildApprovalRequest(run, decision.action);
        const approvalDecision = { ...decision, type: "approval_request", approvalRequest };
        run = orchestrator.applyPlannerDecision(run, approvalDecision);
        await runCheckpointStore.save(run);
        await logEvent(workflowLogStore, eventBus, run.id, "approval_requested", approvalRequest.question, {});
        return run; // Suspended for approval
      }

      const result = await browserKernel.executeAction(session, decision.action);
      run = orchestrator.recordBrowserResult(run, result);
      await logEvent(workflowLogStore, eventBus, run.id, "browser_action_executed", result.summary, {
        actionType: decision.action.type, ok: String(result.ok)
      });

      if (!result.ok) {
        run = orchestrator.failRun(run, result.summary);
        await runCheckpointStore.save(run);
        return run;
      }

      await runCheckpointStore.save(run);
      continue;
    }

    // Non-browser-action decisions
    run = orchestrator.applyPlannerDecision(run, decision);
    await runCheckpointStore.save(run);

    if (decision.clarificationRequest) {
      await logEvent(workflowLogStore, eventBus, run.id, "clarification_requested", decision.clarificationRequest.question, {});
    }

    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled" ||
        run.status === "suspended_for_clarification" || run.status === "suspended_for_approval") {
      if (run.status === "completed") {
        await logEvent(workflowLogStore, eventBus, run.id, "run_completed", run.outcome?.summary ?? "Done", {});
      }
      return run;
    }
  }

  run = orchestrator.failRun(run, `Planner loop exceeded ${MAX_STEPS} steps`);
  await runCheckpointStore.save(run);
  return run;
}

/**
 * Resume a suspended run with a user answer.
 */
async function resumeWithAnswer(services, runId, answer) {
  const { orchestrator, browserKernel, planner, runCheckpointStore, workflowLogStore, eventBus, securityPolicy } = services;

  let run = await runCheckpointStore.load(runId);
  if (!run || !run.suspension) {
    throw new Error(`Run ${runId} not found or not suspended`);
  }

  // Resume from clarification
  run = orchestrator.resumeFromClarification(run, {
    requestId: run.checkpoint.pendingClarificationId,
    runId: run.id,
    answer,
    respondedAt: new Date().toISOString()
  });
  await runCheckpointStore.save(run);
  await logEvent(workflowLogStore, eventBus, run.id, "clarification_answered", `Resumed with answer: ${answer}`, {});

  // Re-enter planner loop
  const profile = await browserKernel.ensureProfile();
  const session = await browserKernel.attachSession(profile);
  run = orchestrator.attachSession(run, profile.id, session.id);
  await runCheckpointStore.save(run);

  const MAX_STEPS = 20;
  for (let step = 0; step < MAX_STEPS; step++) {
    const pageModel = await browserKernel.capturePageModel(session);
    run = orchestrator.observePage(run, pageModel, session.id);
    await runCheckpointStore.save(run);

    const decision = await planner.decide({ run, pageModel });
    await logEvent(workflowLogStore, eventBus, run.id, "planner_decision", decision.reasoning, { plannerDecision: decision.type });

    if (decision.type === "browser_action" && decision.action) {
      if (securityPolicy.requiresApproval(run, decision.action)) {
        const approvalRequest = securityPolicy.buildApprovalRequest(run, decision.action);
        const approvalDecision = { ...decision, type: "approval_request", approvalRequest };
        run = orchestrator.applyPlannerDecision(run, approvalDecision);
        await runCheckpointStore.save(run);
        return run;
      }

      const result = await browserKernel.executeAction(session, decision.action);
      run = orchestrator.recordBrowserResult(run, result);
      await logEvent(workflowLogStore, eventBus, run.id, "browser_action_executed", result.summary, {
        actionType: decision.action.type, ok: String(result.ok)
      });

      if (!result.ok) {
        run = orchestrator.failRun(run, result.summary);
        await runCheckpointStore.save(run);
        return run;
      }

      await runCheckpointStore.save(run);
      continue;
    }

    run = orchestrator.applyPlannerDecision(run, decision);
    await runCheckpointStore.save(run);

    if (decision.clarificationRequest) {
      await logEvent(workflowLogStore, eventBus, run.id, "clarification_requested", decision.clarificationRequest.question, {});
    }

    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled" ||
        run.status === "suspended_for_clarification" || run.status === "suspended_for_approval") {
      if (run.status === "completed") {
        await logEvent(workflowLogStore, eventBus, run.id, "run_completed", run.outcome?.summary ?? "Done", {});
      }
      return run;
    }
  }

  return run;
}

/**
 * Resume a suspended run with an approval answer.
 */
async function resumeWithApproval(services, runId, approved) {
  const { orchestrator, browserKernel, planner, runCheckpointStore, workflowLogStore, eventBus, securityPolicy } = services;

  let run = await runCheckpointStore.load(runId);
  if (!run) {
    throw new Error(`Run ${runId} not found`);
  }

  const pendingAction = run.checkpoint.pendingBrowserAction;
  run = orchestrator.resumeFromApproval(run, approved);
  await runCheckpointStore.save(run);
  await logEvent(workflowLogStore, eventBus, run.id, "approval_answered", `Approval ${approved ? "granted" : "denied"}`, {});

  if (!approved) {
    run = orchestrator.cancelRun(run, "User denied approval.");
    await runCheckpointStore.save(run);
    return run;
  }

  // Execute the pending action then continue planner loop
  const profile = await browserKernel.ensureProfile();
  const session = await browserKernel.attachSession(profile);
  run = orchestrator.attachSession(run, profile.id, session.id);
  await runCheckpointStore.save(run);

  if (pendingAction) {
    const result = await browserKernel.executeAction(session, pendingAction);
    run = orchestrator.recordBrowserResult(run, result);
    await logEvent(workflowLogStore, eventBus, run.id, "browser_action_executed", result.summary, {
      actionType: pendingAction.type, ok: String(result.ok)
    });
    await runCheckpointStore.save(run);
  }

  const MAX_STEPS = 20;
  for (let step = 0; step < MAX_STEPS; step++) {
    const pageModel = await browserKernel.capturePageModel(session);
    run = orchestrator.observePage(run, pageModel, session.id);

    const decision = await planner.decide({ run, pageModel });

    if (decision.type === "browser_action" && decision.action) {
      const result = await browserKernel.executeAction(session, decision.action);
      run = orchestrator.recordBrowserResult(run, result);
      await runCheckpointStore.save(run);
      continue;
    }

    run = orchestrator.applyPlannerDecision(run, decision);
    await runCheckpointStore.save(run);

    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled" ||
        run.status === "suspended_for_clarification" || run.status === "suspended_for_approval") {
      if (run.status === "completed") {
        await logEvent(workflowLogStore, eventBus, run.id, "run_completed", run.outcome?.summary ?? "Done", {});
      }
      return run;
    }
  }

  return run;
}

async function logEvent(workflowLogStore, eventBus, runId, type, summary, payload) {
  const event = {
    id: `event_${runId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    runId,
    type,
    summary,
    createdAt: new Date().toISOString(),
    payload
  };
  await workflowLogStore.append(event);
  await eventBus.publish("workflow", event);
}

// ============================================================================
// Test 1: Travel Search Demo — full lifecycle with clarification
// ============================================================================
test("travel search demo: start → navigate → clarify dates → resume → complete", async () => {
  const scenario = createTravelSearchScenario();
  const planner = new ScriptedPlannerGateway(scenario);

  let pageModelCounter = 0;
  const pageModels = scenario.steps.filter((s) => s.simulatedPageModel).map((s) => s.simulatedPageModel);

  const services = createTestServices(planner, () => {
    if (pageModelCounter < pageModels.length) {
      return pageModels[pageModelCounter++];
    }
    return undefined;
  });

  const intent = {
    id: "test_travel_search",
    source: "desktop",
    goal: "Search for flights SFO to TYO",
    constraints: ["ask for dates"],
    metadata: { demo: "travel-search" }
  };

  // Phase 1: Run until clarification suspension
  const suspendedRun = await runDemoFlow(services, intent);
  assert.equal(suspendedRun.status, "suspended_for_clarification");
  assert.ok(suspendedRun.suspension);
  assert.equal(suspendedRun.suspension.type, "clarification");
  assert.ok(suspendedRun.suspension.question.includes("travel dates"));

  // Phase 2: Resume with user's date preference
  const completedRun = await resumeWithAnswer(services, suspendedRun.id, "Oct 10-24");
  assert.equal(completedRun.status, "completed");
  assert.ok(completedRun.outcome);
  assert.ok(completedRun.outcome.summary.includes("Japan Airlines"));
  assert.ok(completedRun.outcome.summary.includes("$1,245"));

  // Validate workflow log has expected events
  const logs = await services.workflowLogStore.listByRun(completedRun.id);
  const logTypes = logs.map((e) => e.type);
  assert.ok(logTypes.includes("run_created"));
  assert.ok(logTypes.includes("page_modeled"));
  assert.ok(logTypes.includes("browser_action_executed"));
  assert.ok(logTypes.includes("clarification_requested"));
  assert.ok(logTypes.includes("clarification_answered"));
  assert.ok(logTypes.includes("run_completed"));

  console.log(`[test] Travel search: ${logs.length} workflow events logged`);
});

// ============================================================================
// Test 2: Appointment Booking Demo — full lifecycle with clarification + approval
// ============================================================================
test("appointment booking demo: start → search → clarify preference → approve → complete", async () => {
  const scenario = createAppointmentBookingScenario();
  const planner = new ScriptedPlannerGateway(scenario);

  let pageModelCounter = 0;
  const pageModels = scenario.steps.filter((s) => s.simulatedPageModel).map((s) => s.simulatedPageModel);

  const services = createTestServices(planner, () => {
    if (pageModelCounter < pageModels.length) {
      return pageModels[pageModelCounter++];
    }
    return undefined;
  });

  const intent = {
    id: "test_appointment_booking",
    source: "desktop",
    goal: "Book a dentist appointment on ZocDoc",
    constraints: ["ask for preference", "require approval"],
    metadata: { demo: "appointment-booking" }
  };

  // Phase 1: Run until clarification suspension
  const suspendedRun = await runDemoFlow(services, intent);
  assert.equal(suspendedRun.status, "suspended_for_clarification");
  assert.ok(suspendedRun.suspension.question.includes("dentist"));

  // Phase 2: Resume with provider preference, should then hit approval
  const approvalRun = await resumeWithAnswer(services, suspendedRun.id, "Dr. Chen – Tomorrow 9 AM");
  assert.equal(approvalRun.status, "suspended_for_approval");
  assert.ok(approvalRun.suspension);
  assert.equal(approvalRun.suspension.type, "approval");
  assert.ok(approvalRun.suspension.question.includes("confirm"));

  // Phase 3: Approve the booking
  const completedRun = await resumeWithApproval(services, approvalRun.id, true);
  assert.equal(completedRun.status, "completed");
  assert.ok(completedRun.outcome);
  assert.ok(completedRun.outcome.summary.includes("Dr. Sarah Chen"));

  // Validate workflow log
  const logs = await services.workflowLogStore.listByRun(completedRun.id);
  const logTypes = logs.map((e) => e.type);
  assert.ok(logTypes.includes("run_created"));
  assert.ok(logTypes.includes("clarification_requested"));
  assert.ok(logTypes.includes("clarification_answered"));
  assert.ok(logTypes.includes("approval_answered"));
  assert.ok(logTypes.includes("run_completed"));

  console.log(`[test] Appointment booking: ${logs.length} workflow events logged`);
});

// ============================================================================
// Test 3: Price Monitor Demo — full lifecycle with clarification
// ============================================================================
test("price monitor demo: start → clarify product → navigate → extract → complete", async () => {
  const scenario = createPriceMonitorScenario();
  const planner = new ScriptedPlannerGateway(scenario);

  let pageModelCounter = 0;
  const pageModels = scenario.steps.filter((s) => s.simulatedPageModel).map((s) => s.simulatedPageModel);

  const services = createTestServices(planner, () => {
    if (pageModelCounter < pageModels.length) {
      return pageModels[pageModelCounter++];
    }
    return undefined;
  });

  const intent = {
    id: "test_price_monitor",
    source: "desktop",
    goal: "Monitor product price on Amazon",
    constraints: ["extract only"],
    metadata: { demo: "price-monitor" }
  };

  // Phase 1: Run until clarification suspension (asks for product URL/target)
  const suspendedRun = await runDemoFlow(services, intent);
  assert.equal(suspendedRun.status, "suspended_for_clarification");
  assert.ok(suspendedRun.suspension.question.includes("product"));

  // Phase 2: Resume with product details
  const completedRun = await resumeWithAnswer(
    services,
    suspendedRun.id,
    "https://www.amazon.com/dp/B0D1XD1ZV3 target $199"
  );
  assert.equal(completedRun.status, "completed");
  assert.ok(completedRun.outcome);
  assert.ok(completedRun.outcome.summary.includes("AirPods Pro"));
  assert.ok(completedRun.outcome.summary.includes("$189.99"));
  assert.ok(completedRun.outcome.summary.includes("below your target"));

  // Validate workflow log
  const logs = await services.workflowLogStore.listByRun(completedRun.id);
  const logTypes = logs.map((e) => e.type);
  assert.ok(logTypes.includes("run_created"));
  assert.ok(logTypes.includes("clarification_requested"));
  assert.ok(logTypes.includes("clarification_answered"));
  assert.ok(logTypes.includes("browser_action_executed"));
  assert.ok(logTypes.includes("run_completed"));

  console.log(`[test] Price monitor: ${logs.length} workflow events logged`);
});

// ============================================================================
// Test 4: ScriptedPlannerGateway exhaustion — completes gracefully at end of script
// ============================================================================
test("scripted planner completes when script is exhausted", async () => {
  const scenario = {
    id: "test-short",
    label: "Short Test",
    steps: [
      {
        decision: {
          type: "browser_action",
          reasoning: "Test action",
          action: { type: "navigate", value: "https://example.com", description: "Go to example" }
        }
      }
    ]
  };

  const planner = new ScriptedPlannerGateway(scenario);

  // First call: returns the scripted action
  const first = await planner.decide({ run: {}, pageModel: {} });
  assert.equal(first.type, "browser_action");

  // Second call: script exhausted, returns task_complete
  const second = await planner.decide({ run: {}, pageModel: {} });
  assert.equal(second.type, "task_complete");
  assert.ok(second.completionSummary.includes("Short Test"));
});
