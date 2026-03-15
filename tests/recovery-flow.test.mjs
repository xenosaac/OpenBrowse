import test from "node:test";
import assert from "node:assert/strict";

import { TaskOrchestrator, DefaultClarificationPolicy } from "../packages/orchestrator/dist/index.js";
import { buildPlannerPrompt, ScriptedPlannerGateway } from "../packages/planner/dist/index.js";
import { StubBrowserKernel } from "../packages/browser-runtime/dist/BrowserKernel.js";
import {
  InMemoryRunCheckpointStore,
  InMemoryWorkflowLogStore,
  InMemoryPreferenceStore
} from "../packages/memory-store/dist/index.js";
import { EventBus } from "../packages/observability/dist/index.js";
import { StubChatBridge } from "../packages/chat-bridge/dist/index.js";
import { DefaultApprovalPolicy } from "../packages/security/dist/index.js";

// ---- Factories ----

function makeRun(overrides = {}) {
  return {
    id: "run_intent_recovery_1",
    taskIntentId: "intent_1",
    status: "running",
    goal: "Complete payment form",
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
      ...overrides.checkpoint
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

function makePageModel(overrides = {}) {
  return {
    id: "pm_1",
    url: "https://example.com/payment",
    title: "Payment Form",
    summary: "Enter your credit card details to complete purchase.",
    focusedElementId: undefined,
    elements: [],
    visibleText: "Payment form with card number, expiry, and CVV fields.",
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

function makeOrchestrator() {
  return new TaskOrchestrator({ clarificationPolicy: new DefaultClarificationPolicy() });
}

/**
 * Inline recovery context injection, mirroring OpenBrowseRuntime.continueResume lines 396-409.
 */
function injectRecoveryContext(run) {
  const snapshot = run.checkpoint.lastPageModelSnapshot;
  return {
    ...run,
    checkpoint: {
      ...run.checkpoint,
      recoveryContext: {
        recoveredAt: new Date().toISOString(),
        preInterruptionPageTitle: snapshot?.title ?? run.checkpoint.lastPageTitle,
        preInterruptionPageSummary: snapshot?.summary ?? run.checkpoint.lastPageSummary,
        preInterruptionVisibleText: snapshot?.visibleText,
        preInterruptionScrollY: snapshot?.scrollY,
        preInterruptionFormValues: snapshot?.formValues,
      }
    }
  };
}

// ============================================================================
// Test 1: Snapshot round-trips through checkpoint store
// ============================================================================

test("observePage snapshot round-trips through checkpoint store", async () => {
  const orchestrator = makeOrchestrator();
  const store = new InMemoryRunCheckpointStore();

  const run = makeRun();
  const pageModel = makePageModel({
    elements: [
      { id: "el_1", role: "textbox", tagName: "INPUT", inputType: "text", value: "4242424242424242", description: "Card number" },
      { id: "el_2", role: "textbox", tagName: "INPUT", inputType: "text", value: "12/28", description: "Expiry" },
      { id: "el_3", role: "textbox", tagName: "INPUT", inputType: "text", value: "123", description: "CVV" }
    ],
    scrollY: 400,
    visibleText: "A".repeat(600) // exceeds 500 char cap
  });

  const observed = orchestrator.observePage(run, pageModel, "session_1");
  await store.save(observed);
  const loaded = await store.load(observed.id);

  assert.ok(loaded.checkpoint.lastPageModelSnapshot);
  assert.equal(loaded.checkpoint.lastPageModelSnapshot.title, "Payment Form");
  assert.equal(loaded.checkpoint.lastPageModelSnapshot.summary, "Enter your credit card details to complete purchase.");
  assert.equal(loaded.checkpoint.lastPageModelSnapshot.scrollY, 400);
  assert.deepEqual(loaded.checkpoint.lastPageModelSnapshot.formValues, {
    el_1: "4242424242424242",
    el_2: "12/28",
    el_3: "123"
  });
  // visibleText capped at 500
  assert.equal(loaded.checkpoint.lastPageModelSnapshot.visibleText.length, 500);
});

// ============================================================================
// Test 2: Recovery context correctly constructed from snapshot
// ============================================================================

test("recovery context is correctly constructed from snapshot", () => {
  const run = makeRun({
    checkpoint: {
      lastPageModelSnapshot: {
        title: "Payment Form",
        summary: "Enter card details",
        visibleText: "Card number, expiry, CVV",
        formValues: { el_1: "4242", el_2: "12/28", el_3: "123" },
        scrollY: 350
      }
    }
  });

  const recovered = injectRecoveryContext(run);
  const ctx = recovered.checkpoint.recoveryContext;

  assert.ok(ctx);
  assert.equal(ctx.preInterruptionPageTitle, "Payment Form");
  assert.equal(ctx.preInterruptionPageSummary, "Enter card details");
  assert.equal(ctx.preInterruptionVisibleText, "Card number, expiry, CVV");
  assert.equal(ctx.preInterruptionScrollY, 350);
  assert.deepEqual(ctx.preInterruptionFormValues, { el_1: "4242", el_2: "12/28", el_3: "123" });
  assert.ok(ctx.recoveredAt);
  assert.ok(new Date(ctx.recoveredAt).getTime() > 0);
});

// ============================================================================
// Test 3: Recovery context falls back to lastPageTitle when no snapshot
// ============================================================================

test("recovery context falls back to lastPageTitle/lastPageSummary when no snapshot", () => {
  const run = makeRun({
    checkpoint: {
      lastPageTitle: "Search Results",
      lastPageSummary: "Flight options displayed",
      lastPageModelSnapshot: undefined
    }
  });

  const recovered = injectRecoveryContext(run);
  const ctx = recovered.checkpoint.recoveryContext;

  assert.equal(ctx.preInterruptionPageTitle, "Search Results");
  assert.equal(ctx.preInterruptionPageSummary, "Flight options displayed");
  assert.equal(ctx.preInterruptionVisibleText, undefined);
  assert.equal(ctx.preInterruptionFormValues, undefined);
});

// ============================================================================
// Test 4: Recovery context with all-undefined fields
// ============================================================================

test("recovery context with no snapshot and no lastPageTitle has undefined fields", () => {
  const run = makeRun({
    checkpoint: {
      lastPageModelSnapshot: undefined,
      lastPageTitle: undefined,
      lastPageSummary: undefined
    }
  });

  const recovered = injectRecoveryContext(run);
  const ctx = recovered.checkpoint.recoveryContext;

  assert.equal(ctx.preInterruptionPageTitle, undefined);
  assert.equal(ctx.preInterruptionPageSummary, undefined);
  assert.equal(ctx.preInterruptionVisibleText, undefined);
  assert.equal(ctx.preInterruptionFormValues, undefined);
  // buildPlannerPrompt will render these as "unknown" / "unavailable"
});

// ============================================================================
// Test 5: Full integration — observePage → save → load → inject → buildPlannerPrompt
// ============================================================================

test("full integration: observePage → store round-trip → recovery context → prompt includes RECOVERY MODE", async () => {
  const orchestrator = makeOrchestrator();
  const store = new InMemoryRunCheckpointStore();

  const run = makeRun();
  const pageModel = makePageModel({
    elements: [
      { id: "card_num", role: "textbox", tagName: "INPUT", inputType: "text", value: "4242424242424242", description: "Card number" },
      { id: "expiry", role: "textbox", tagName: "INPUT", inputType: "text", value: "12/28", description: "Expiry" }
    ],
    scrollY: 500
  });

  // Step 1: observePage populates snapshot
  const observed = orchestrator.observePage(run, pageModel, "session_1");
  await store.save(observed);

  // Step 2: Simulate crash — load from store
  const loaded = await store.load(observed.id);

  // Step 3: Inject recovery context (mirroring continueResume)
  const recovered = injectRecoveryContext(loaded);

  // Step 4: Build prompt — should contain RECOVERY MODE
  const currentPage = makePageModel({ title: "Payment Form (Reloaded)", url: "https://example.com/payment" });
  const prompt = buildPlannerPrompt(recovered, currentPage);

  assert.match(prompt.user, /RECOVERY MODE/);
  assert.match(prompt.user, /Payment Form/); // pre-interruption title
  assert.match(prompt.user, /card_num="4242424242424242"/);
  assert.match(prompt.user, /expiry="12\/28"/);
  assert.match(prompt.user, /Y=500px/); // scroll hint
});

// ============================================================================
// Test 6: Recovery context cleared → prompt omits RECOVERY MODE
// ============================================================================

test("recovery context cleared after first planner call → prompt omits RECOVERY MODE", () => {
  const run = makeRun({
    checkpoint: {
      recoveryContext: {
        recoveredAt: "2026-03-15T00:05:00Z",
        preInterruptionPageTitle: "Old Page",
        preInterruptionPageSummary: "Old summary"
      }
    }
  });

  // Verify recovery section present before clearing
  const promptBefore = buildPlannerPrompt(run, makePageModel());
  assert.match(promptBefore.user, /RECOVERY MODE/);

  // Clear (mirroring plannerLoop lines 636-639)
  const cleared = { ...run, checkpoint: { ...run.checkpoint, recoveryContext: undefined } };
  const promptAfter = buildPlannerPrompt(cleared, makePageModel());
  assert.doesNotMatch(promptAfter.user, /RECOVERY MODE/);
});

// ============================================================================
// Test 7: Full lifecycle — observe → save → load → inject → prompt → clear → prompt
// ============================================================================

test("full lifecycle: snapshot → store → recovery → prompt → clear → no recovery in next prompt", async () => {
  const orchestrator = makeOrchestrator();
  const store = new InMemoryRunCheckpointStore();

  // Phase 1: normal operation — observePage
  let run = makeRun();
  const page1 = makePageModel({ scrollY: 250 });
  run = orchestrator.observePage(run, page1, "session_1");
  await store.save(run);

  // Phase 2: crash + load
  const loaded = await store.load(run.id);

  // Phase 3: inject recovery context
  let recovered = injectRecoveryContext(loaded);

  // Phase 4: first planner prompt — RECOVERY MODE present
  const page2 = makePageModel({ title: "Reloaded Page" });
  const prompt1 = buildPlannerPrompt(recovered, page2);
  assert.match(prompt1.user, /RECOVERY MODE/);

  // Phase 5: clear recovery context
  recovered = { ...recovered, checkpoint: { ...recovered.checkpoint, recoveryContext: undefined } };
  await store.save(recovered);

  // Phase 6: second planner prompt — RECOVERY MODE absent
  const reloaded = await store.load(recovered.id);
  const prompt2 = buildPlannerPrompt(reloaded, page2);
  assert.doesNotMatch(prompt2.user, /RECOVERY MODE/);
  assert.equal(reloaded.checkpoint.recoveryContext, undefined);
});

// ============================================================================
// Test 8: Recovery with pending action (approval resume)
// ============================================================================

test("recovery with pending action: approval resume executes action then continues", async () => {
  const orchestrator = makeOrchestrator();
  const browserKernel = new StubBrowserKernel();
  const store = new InMemoryRunCheckpointStore();

  // Create a run suspended for approval with a pending action
  let run = makeRun({
    status: "suspended_for_approval",
    checkpoint: {
      pendingBrowserAction: { type: "click", ref: "el_5", description: "Click Purchase" },
      pendingApprovalId: "approval_1",
      lastKnownUrl: "https://store.example.com/checkout"
    },
    suspension: { type: "approval", question: "Confirm purchase?", requestId: "approval_1" }
  });

  await store.save(run);

  // Resume from approval
  const pendingAction = run.checkpoint.pendingBrowserAction;
  run = orchestrator.resumeFromApproval(run, true);
  await store.save(run);

  assert.equal(run.status, "running");
  // pendingBrowserAction is intentionally NOT cleared by resumeFromApproval —
  // the runtime reads it to execute the action, then it's cleared by the next applyPlannerDecision
  assert.ok(run.checkpoint.pendingBrowserAction);
  assert.equal(run.checkpoint.pendingApprovalId, undefined);

  // Execute the pending action
  const profile = await browserKernel.ensureProfile();
  const session = await browserKernel.attachSession(profile, {
    runId: run.id, groupId: run.id, taskLabel: run.goal,
    source: "desktop", status: "running", isBackground: true
  });

  const result = await browserKernel.executeAction(session, pendingAction);
  assert.equal(result.ok, true);

  run = orchestrator.recordBrowserResult(run, result);
  assert.equal(run.checkpoint.actionHistory.length, 1);
  assert.equal(run.checkpoint.actionHistory[0].type, "click");
});

// ============================================================================
// Test 9: Recovery with no lastKnownUrl skips navigation
// ============================================================================

test("recovery with no lastKnownUrl: navigation restore is skipped", async () => {
  const orchestrator = makeOrchestrator();
  const browserKernel = new StubBrowserKernel();

  let run = makeRun({
    checkpoint: {
      lastKnownUrl: undefined,
      lastPageModelSnapshot: { title: "Some Page", summary: "Content" }
    }
  });

  // Inject recovery context — should work even without URL
  const recovered = injectRecoveryContext(run);
  assert.ok(recovered.checkpoint.recoveryContext);
  assert.equal(recovered.checkpoint.recoveryContext.preInterruptionPageTitle, "Some Page");

  // The guard: `if (current.checkpoint.lastKnownUrl)` — with no URL, no navigate action
  const hasUrl = !!recovered.checkpoint.lastKnownUrl;
  assert.equal(hasUrl, false);

  // Run can still proceed — planner loop starts from wherever session defaults
  const profile = await browserKernel.ensureProfile();
  const session = await browserKernel.attachSession(profile);
  const pageModel = await browserKernel.capturePageModel(session);
  run = orchestrator.observePage(recovered, pageModel, session.id);

  // No navigate action in history (only observePage was called, no executeAction)
  assert.equal(run.checkpoint.actionHistory.length, 0);
});

// ============================================================================
// Test 10: Snapshot visibleText truncation at 500 chars
// ============================================================================

test("snapshot visibleText is truncated to 500 chars", () => {
  const orchestrator = makeOrchestrator();
  const longText = "X".repeat(1000);
  const run = makeRun();
  const pageModel = makePageModel({ visibleText: longText });

  const observed = orchestrator.observePage(run, pageModel, "session_1");
  assert.equal(observed.checkpoint.lastPageModelSnapshot.visibleText.length, 500);
  assert.equal(observed.checkpoint.lastPageModelSnapshot.visibleText, "X".repeat(500));
});
