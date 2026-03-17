import test from "node:test";
import assert from "node:assert/strict";

import { TaskOrchestrator, DefaultClarificationPolicy } from "../packages/orchestrator/dist/index.js";

// --- Helpers ---

function makeOrchestrator(policyOverride) {
  return new TaskOrchestrator({
    clarificationPolicy: policyOverride ?? new DefaultClarificationPolicy(),
  });
}

function makeIntent(overrides = {}) {
  return {
    id: overrides.id ?? "intent_1",
    source: overrides.source ?? "desktop",
    goal: overrides.goal ?? "Book a flight",
    constraints: overrides.constraints ?? [],
    metadata: overrides.metadata ?? {},
    preferredProfileId: overrides.preferredProfileId,
    createdAt: overrides.createdAt,
  };
}

function makeRunning(orchestrator, intentOverrides = {}) {
  return orchestrator.startRun(orchestrator.createRun(makeIntent(intentOverrides)));
}

function makePageModel(overrides = {}) {
  return {
    id: overrides.id ?? "pm_1",
    url: overrides.url ?? "https://example.com",
    title: overrides.title ?? "Example",
    summary: overrides.summary ?? "A page",
    elements: overrides.elements ?? [],
    visibleText: overrides.visibleText ?? "hello",
    createdAt: new Date().toISOString(),
    forms: overrides.forms ?? [],
    alerts: overrides.alerts ?? [],
    captchaDetected: false,
    scrollY: overrides.scrollY,
  };
}

function makeAction(overrides = {}) {
  return {
    type: overrides.type ?? "click",
    targetId: overrides.targetId ?? "btn_1",
    value: overrides.value,
    description: overrides.description ?? "Click button",
  };
}

function makeActionResult(overrides = {}) {
  return {
    ok: overrides.ok ?? true,
    action: overrides.action ?? makeAction(),
    pageModelId: overrides.pageModelId ?? "pm_1",
    summary: overrides.summary ?? "Clicked button",
    failureClass: overrides.failureClass,
  };
}

// === createRun ===

test("createRun produces queued run with correct fields", () => {
  const o = makeOrchestrator();
  const run = o.createRun(makeIntent({ id: "i_42", goal: "Search flights", source: "telegram" }));

  assert.equal(run.id, "run_i_42");
  assert.equal(run.taskIntentId, "i_42");
  assert.equal(run.status, "queued");
  assert.equal(run.goal, "Search flights");
  assert.equal(run.source, "telegram");
  assert.equal(run.checkpoint.stepCount, 0);
  assert.deepEqual(run.checkpoint.actionHistory, []);
  assert.equal(run.checkpoint.consecutiveSoftFailures, 0);
});

test("createRun uses provided createdAt", () => {
  const o = makeOrchestrator();
  const run = o.createRun(makeIntent({ createdAt: "2025-06-01T00:00:00Z" }));

  assert.equal(run.createdAt, "2025-06-01T00:00:00Z");
  assert.equal(run.updatedAt, "2025-06-01T00:00:00Z");
});

test("createRun auto-generates timestamp when createdAt omitted", () => {
  const o = makeOrchestrator();
  const run = o.createRun(makeIntent());

  assert.ok(run.createdAt);
  assert.ok(new Date(run.createdAt).getTime() > 0);
});

test("createRun preserves constraints and metadata", () => {
  const o = makeOrchestrator();
  const run = o.createRun(makeIntent({
    constraints: ["prefer cheapest", "non-stop only"],
    metadata: { priority: "high" },
  }));

  assert.deepEqual(run.constraints, ["prefer cheapest", "non-stop only"]);
  assert.deepEqual(run.metadata, { priority: "high" });
});

test("createRun stores preferredProfileId as profileId", () => {
  const o = makeOrchestrator();
  const run = o.createRun(makeIntent({ preferredProfileId: "work-profile" }));

  assert.equal(run.profileId, "work-profile");
});

// === startRun ===

test("startRun transitions queued to running", () => {
  const o = makeOrchestrator();
  const queued = o.createRun(makeIntent());
  const running = o.startRun(queued);

  assert.equal(running.status, "running");
  assert.equal(running.checkpoint.summary, "Run started.");
});

test("startRun throws on invalid transition from completed", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const completed = o.applyPlannerDecision(running, { type: "task_complete", reasoning: "Done" });

  assert.throws(() => o.startRun(completed), /Invalid task-run transition/);
});

// === attachSession ===

test("attachSession sets profileId and browserSessionId", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const attached = o.attachSession(running, "profile_work", "sess_42", "pm_initial");

  assert.equal(attached.profileId, "profile_work");
  assert.equal(attached.checkpoint.browserSessionId, "sess_42");
  assert.equal(attached.checkpoint.lastPageModelId, "pm_initial");
});

test("attachSession works without pageModelId", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const attached = o.attachSession(running, "profile_1", "sess_1");

  assert.equal(attached.checkpoint.lastPageModelId, undefined);
});

// === observePage ===

test("observePage updates URL, title, summary, stepCount", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const observed = o.observePage(running, makePageModel({
    id: "pm_5",
    url: "https://flights.com",
    title: "Flights",
    summary: "Flight search page",
  }));

  assert.equal(observed.checkpoint.lastPageModelId, "pm_5");
  assert.equal(observed.checkpoint.lastKnownUrl, "https://flights.com");
  assert.equal(observed.checkpoint.lastPageTitle, "Flights");
  assert.equal(observed.checkpoint.lastPageSummary, "Flight search page");
  assert.equal(observed.checkpoint.stepCount, 1);
});

test("observePage increments stepCount on each call", () => {
  const o = makeOrchestrator();
  let run = makeRunning(o);
  run = o.observePage(run, makePageModel());
  run = o.observePage(run, makePageModel());
  run = o.observePage(run, makePageModel());

  assert.equal(run.checkpoint.stepCount, 3);
});

test("observePage captures lastPageModelSnapshot with visibleText truncated", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const longText = "x".repeat(1000);
  const observed = o.observePage(running, makePageModel({
    title: "Page",
    summary: "Summary",
    visibleText: longText,
    scrollY: 250,
  }));

  const snapshot = observed.checkpoint.lastPageModelSnapshot;
  assert.ok(snapshot);
  assert.equal(snapshot.title, "Page");
  assert.equal(snapshot.summary, "Summary");
  assert.equal(snapshot.visibleText.length, 500);
  assert.equal(snapshot.scrollY, 250);
});

test("observePage extracts form field values from input elements", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const observed = o.observePage(running, makePageModel({
    elements: [
      { id: "input_1", inputType: "text", value: "hello", role: "textbox" },
      { id: "input_2", inputType: "email", value: "a@b.com" },
      { id: "btn_1", role: "button", value: "" }, // no inputType, not textbox → skipped
    ],
  }));

  const formValues = observed.checkpoint.lastPageModelSnapshot.formValues;
  assert.ok(formValues);
  assert.equal(formValues["input_1"], "hello");
  assert.equal(formValues["input_2"], "a@b.com");
  assert.equal(formValues["btn_1"], undefined);
});

test("observePage omits formValues when no input elements", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const observed = o.observePage(running, makePageModel({ elements: [] }));

  assert.equal(observed.checkpoint.lastPageModelSnapshot.formValues, undefined);
});

test("observePage updates browserSessionId when provided", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const observed = o.observePage(running, makePageModel(), "sess_new");

  assert.equal(observed.checkpoint.browserSessionId, "sess_new");
});

test("observePage sets lastPageTitle to undefined for empty title", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const observed = o.observePage(running, makePageModel({ title: "" }));

  assert.equal(observed.checkpoint.lastPageTitle, undefined);
});

test("observePage caps formValues at 20 entries", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const elements = Array.from({ length: 25 }, (_, i) => ({
    id: `input_${i}`,
    role: "textbox",
    label: `Field ${i}`,
    value: `val_${i}`,
    isActionable: true,
    inputType: "text",
  }));
  const observed = o.observePage(running, makePageModel({ elements }));
  assert.equal(Object.keys(observed.checkpoint.lastPageModelSnapshot.formValues).length, 20);
});

test("observePage only captures inputs with non-empty value", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const pm = makePageModel({
    elements: [
      { id: "e1", role: "button", label: "Submit", isActionable: true },
      { id: "e2", role: "textbox", label: "Empty", isActionable: true, inputType: "text" },
      { id: "e3", role: "link", label: "Link", isActionable: true, href: "https://example.com" },
    ],
  });
  const observed = o.observePage(running, pm);
  assert.equal(observed.checkpoint.lastPageModelSnapshot.formValues, undefined);
});

test("recordBrowserResult omits targetId when action has none", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const after = o.recordBrowserResult(running, makeActionResult({
    action: { type: "navigate", value: "https://example.com", description: "Go to site" },
    summary: "Navigated",
  }));
  assert.equal(after.checkpoint.actionHistory[0].targetId, undefined);
});

// === applyPlannerDecision — clarification_request ===

test("applyPlannerDecision suspends for clarification", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const suspended = o.applyPlannerDecision(running, {
    type: "clarification_request",
    reasoning: "Need date",
    clarificationRequest: {
      id: "c1",
      runId: running.id,
      question: "Which date?",
      contextSummary: "Multiple options",
      options: [],
      createdAt: "2026-01-01T00:00:00Z",
    },
  });

  assert.equal(suspended.status, "suspended_for_clarification");
  assert.equal(suspended.checkpoint.pendingClarificationId, "c1");
  assert.equal(suspended.checkpoint.pendingApprovalId, undefined);
  assert.equal(suspended.checkpoint.pendingBrowserAction, undefined);
  assert.ok(suspended.checkpoint.stopReason.includes("clarification"));
  assert.equal(suspended.suspension.type, "clarification");
  assert.equal(suspended.suspension.requestId, "c1");
  assert.equal(suspended.suspension.question, "Which date?");
});

test("applyPlannerDecision clarification without request object uses fallback", () => {
  // Custom policy that always suspends regardless of decision type
  const alwaysSuspend = { shouldSuspend: () => true };
  const o = makeOrchestrator(alwaysSuspend);
  const running = makeRunning(o);
  const suspended = o.applyPlannerDecision(running, {
    type: "browser_action",
    reasoning: "Something",
  });

  assert.equal(suspended.status, "suspended_for_clarification");
  assert.ok(suspended.checkpoint.stopReason.includes("Clarification needed"));
  assert.equal(suspended.suspension, undefined);
});

// === applyPlannerDecision — approval_request ===

test("applyPlannerDecision suspends for approval", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const action = makeAction({ description: "Delete account" });
  const suspended = o.applyPlannerDecision(running, {
    type: "approval_request",
    reasoning: "Dangerous action",
    approvalRequest: {
      id: "ap1",
      runId: running.id,
      question: "Delete the account?",
      irreversibleActionSummary: "Permanently delete account",
      riskClass: "destructive",
      createdAt: "2026-01-01T00:00:00Z",
    },
    action,
  });

  assert.equal(suspended.status, "suspended_for_approval");
  assert.equal(suspended.checkpoint.pendingApprovalId, "ap1");
  assert.equal(suspended.checkpoint.pendingClarificationId, undefined);
  assert.deepEqual(suspended.checkpoint.pendingBrowserAction, action);
  assert.ok(suspended.checkpoint.stopReason.includes("approval"));
  assert.ok(suspended.checkpoint.nextSuggestedStep.includes("Delete account"));
  assert.equal(suspended.suspension.type, "approval");
  assert.equal(suspended.suspension.riskClass, "destructive");
});

test("applyPlannerDecision approval uses irreversibleActionSummary when no action", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const suspended = o.applyPlannerDecision(running, {
    type: "approval_request",
    reasoning: "Risky",
    approvalRequest: {
      id: "ap2",
      runId: running.id,
      question: "Proceed?",
      irreversibleActionSummary: "Transfer $1000",
      createdAt: "2026-01-01T00:00:00Z",
    },
  });

  assert.ok(suspended.checkpoint.stopReason.includes("Transfer $1000"));
});

// === applyPlannerDecision — task_complete ===

test("applyPlannerDecision completes run", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const completed = o.applyPlannerDecision(running, {
    type: "task_complete",
    reasoning: "Flight booked successfully",
  });

  assert.equal(completed.status, "completed");
  assert.equal(completed.outcome.status, "completed");
  assert.equal(completed.outcome.summary, "Flight booked successfully");
  assert.ok(completed.outcome.finishedAt);
  assert.equal(completed.checkpoint.pendingApprovalId, undefined);
  assert.equal(completed.checkpoint.pendingClarificationId, undefined);
  assert.equal(completed.checkpoint.pendingBrowserAction, undefined);
  assert.equal(completed.suspension, undefined);
});

test("applyPlannerDecision task_complete uses completionSummary over reasoning", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const completed = o.applyPlannerDecision(running, {
    type: "task_complete",
    reasoning: "internal reasoning",
    completionSummary: "Flight LAX→JFK booked for Oct 12",
  });

  assert.equal(completed.outcome.summary, "Flight LAX→JFK booked for Oct 12");
  assert.equal(completed.checkpoint.summary, "Flight LAX→JFK booked for Oct 12");
});

// === applyPlannerDecision — task_failed ===

test("applyPlannerDecision fails run", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const failed = o.applyPlannerDecision(running, {
    type: "task_failed",
    reasoning: "Page not loading",
  });

  assert.equal(failed.status, "failed");
  assert.equal(failed.outcome.status, "failed");
  assert.equal(failed.outcome.summary, "Page not loading");
  assert.ok(failed.checkpoint.stopReason.includes("Failed"));
  assert.equal(failed.suspension, undefined);
});

test("applyPlannerDecision task_failed uses failureSummary over reasoning", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const failed = o.applyPlannerDecision(running, {
    type: "task_failed",
    reasoning: "internal",
    failureSummary: "CAPTCHA blocked automation",
  });

  assert.equal(failed.outcome.summary, "CAPTCHA blocked automation");
});

// === applyPlannerDecision — browser_action (continuation) ===

test("applyPlannerDecision browser_action keeps run running", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const continued = o.applyPlannerDecision(running, {
    type: "browser_action",
    reasoning: "Navigate to flights page",
    action: makeAction({ description: "Click search" }),
  });

  assert.equal(continued.status, "running");
  assert.equal(continued.checkpoint.summary, "Navigate to flights page");
  assert.equal(continued.checkpoint.nextSuggestedStep, "Click search");
  assert.equal(continued.checkpoint.pendingApprovalId, undefined);
  assert.equal(continued.suspension, undefined);
});

test("applyPlannerDecision browser_action uses reasoning when no action description", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const continued = o.applyPlannerDecision(running, {
    type: "browser_action",
    reasoning: "Scrolling down",
  });

  assert.equal(continued.checkpoint.nextSuggestedStep, "Scrolling down");
});

test("applyPlannerDecision browser_action transitions queued to running", () => {
  const o = makeOrchestrator();
  const queued = o.createRun(makeIntent());
  const continued = o.applyPlannerDecision(queued, {
    type: "browser_action",
    reasoning: "First action",
    action: makeAction(),
  });

  assert.equal(continued.status, "running");
});

// === recordBrowserResult ===

test("recordBrowserResult appends to actionHistory", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const after = o.recordBrowserResult(running, makeActionResult({
    action: makeAction({ type: "click", targetId: "btn_1", description: "Click buy" }),
    summary: "Button clicked",
  }));

  assert.equal(after.status, "running");
  const history = after.checkpoint.actionHistory;
  assert.equal(history.length, 1);
  assert.equal(history[0].type, "click");
  assert.equal(history[0].targetId, "btn_1");
  assert.equal(history[0].description, "Click buy");
  assert.equal(history[0].ok, true);
});

test("recordBrowserResult caps actionHistory at 25", () => {
  const o = makeOrchestrator();
  let run = makeRunning(o);
  // Set up 24 existing actions
  run.checkpoint.actionHistory = Array.from({ length: 24 }, (_, i) => ({
    step: i, type: "click", description: `action ${i}`, ok: true, createdAt: new Date().toISOString(),
  }));

  // Add 2 more (should cap at 25)
  run = o.recordBrowserResult(run, makeActionResult({ summary: "action 24" }));
  run = o.recordBrowserResult(run, makeActionResult({ summary: "action 25" }));

  assert.equal(run.checkpoint.actionHistory.length, 25);
});

test("recordBrowserResult tracks consecutiveSoftFailures for element_not_found", () => {
  const o = makeOrchestrator();
  let run = makeRunning(o);

  run = o.recordBrowserResult(run, makeActionResult({
    ok: false,
    failureClass: "element_not_found",
    summary: "not found",
  }));
  assert.equal(run.checkpoint.consecutiveSoftFailures, 1);
  assert.equal(run.checkpoint.totalSoftFailures, 1);

  run = o.recordBrowserResult(run, makeActionResult({
    ok: false,
    failureClass: "element_not_found",
    summary: "still not found",
  }));
  assert.equal(run.checkpoint.consecutiveSoftFailures, 2);
  assert.equal(run.checkpoint.totalSoftFailures, 2);
});

test("recordBrowserResult resets consecutiveSoftFailures on success", () => {
  const o = makeOrchestrator();
  let run = makeRunning(o);

  run = o.recordBrowserResult(run, makeActionResult({
    ok: false,
    failureClass: "element_not_found",
    summary: "not found",
  }));
  assert.equal(run.checkpoint.consecutiveSoftFailures, 1);

  run = o.recordBrowserResult(run, makeActionResult({ ok: true, summary: "ok" }));
  assert.equal(run.checkpoint.consecutiveSoftFailures, 0);
  assert.equal(run.checkpoint.totalSoftFailures, 1); // total doesn't reset
});

test("recordBrowserResult tracks network_error as soft failure", () => {
  const o = makeOrchestrator();
  let run = makeRunning(o);

  run = o.recordBrowserResult(run, makeActionResult({
    ok: false,
    failureClass: "network_error",
    summary: "timeout",
  }));
  assert.equal(run.checkpoint.consecutiveSoftFailures, 1);
});

test("recordBrowserResult tracks interaction_failed as soft failure", () => {
  const o = makeOrchestrator();
  let run = makeRunning(o);

  run = o.recordBrowserResult(run, makeActionResult({
    ok: false,
    failureClass: "interaction_failed",
    summary: "click failed",
  }));
  assert.equal(run.checkpoint.consecutiveSoftFailures, 1);
  assert.equal(run.checkpoint.totalSoftFailures, 1);
});

test("recordBrowserResult tracks navigation_timeout as soft failure", () => {
  const o = makeOrchestrator();
  let run = makeRunning(o);

  run = o.recordBrowserResult(run, makeActionResult({
    ok: false,
    failureClass: "navigation_timeout",
    summary: "timed out",
  }));
  assert.equal(run.checkpoint.consecutiveSoftFailures, 1);
  assert.equal(run.checkpoint.totalSoftFailures, 1);
});

test("recordBrowserResult tracks validation_error as soft failure (T34)", () => {
  const o = makeOrchestrator();
  let run = makeRunning(o);

  run = o.recordBrowserResult(run, makeActionResult({
    ok: false,
    failureClass: "validation_error",
    summary: "invalid email",
  }));
  assert.equal(run.checkpoint.consecutiveSoftFailures, 1);
  assert.equal(run.checkpoint.totalSoftFailures, 1);
});

test("recordBrowserResult does not count non-soft failures", () => {
  const o = makeOrchestrator();
  let run = makeRunning(o);

  run = o.recordBrowserResult(run, makeActionResult({
    ok: false,
    failureClass: "execution_error",
    summary: "crash",
  }));
  assert.equal(run.checkpoint.consecutiveSoftFailures, 0);
  assert.equal(run.checkpoint.totalSoftFailures, 0);
});

test("recordBrowserResult tracks urlVisitCounts for navigate actions", () => {
  const o = makeOrchestrator();
  let run = makeRunning(o);

  run = o.recordBrowserResult(run, makeActionResult({
    action: makeAction({ type: "navigate", value: "https://a.com", description: "go" }),
    summary: "navigated",
  }));
  run = o.recordBrowserResult(run, makeActionResult({
    action: makeAction({ type: "navigate", value: "https://a.com", description: "go" }),
    summary: "navigated again",
  }));

  assert.equal(run.checkpoint.urlVisitCounts["https://a.com"], 2);
});

test("recordBrowserResult does NOT increment urlVisitCounts for non-navigate actions", () => {
  const o = makeOrchestrator();
  let run = makeRunning(o);
  run.checkpoint.lastKnownUrl = "https://current.com";

  run = o.recordBrowserResult(run, makeActionResult({
    action: makeAction({ type: "click", description: "click" }),
    summary: "clicked",
  }));

  // Non-navigate actions should not count as URL visits —
  // they are productive work on the current page, not revisitation.
  assert.equal(run.checkpoint.urlVisitCounts["https://current.com"], undefined);
});

test("recordBrowserResult records targetUrl for navigate actions", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const after = o.recordBrowserResult(running, makeActionResult({
    action: makeAction({ type: "navigate", value: "https://target.com", description: "go" }),
    summary: "navigated",
  }));

  assert.equal(after.checkpoint.actionHistory[0].targetUrl, "https://target.com");
});

test("recordBrowserResult records typedText for type actions", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const after = o.recordBrowserResult(running, makeActionResult({
    action: makeAction({ type: "type", value: "hello world", targetId: "input_1", description: "type text" }),
    summary: "typed",
  }));

  assert.equal(after.checkpoint.actionHistory[0].typedText, "hello world");
});

test("recordBrowserResult stores lastFailureClass on failure", () => {
  const o = makeOrchestrator();
  let run = makeRunning(o);

  run = o.recordBrowserResult(run, makeActionResult({
    ok: false,
    failureClass: "element_not_found",
    summary: "missing",
  }));

  assert.equal(run.checkpoint.lastFailureClass, "element_not_found");
});

test("recordBrowserResult clears lastFailureClass on success", () => {
  const o = makeOrchestrator();
  let run = makeRunning(o);
  run.checkpoint.lastFailureClass = "element_not_found";

  run = o.recordBrowserResult(run, makeActionResult({ ok: true, summary: "ok" }));

  assert.equal(run.checkpoint.lastFailureClass, undefined);
});

// === resumeFromClarification ===

test("resumeFromClarification transitions to running", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const suspended = o.applyPlannerDecision(running, {
    type: "clarification_request",
    reasoning: "Need date",
    clarificationRequest: {
      id: "c1",
      runId: running.id,
      question: "Which date?",
      contextSummary: "",
      options: [],
      createdAt: "2026-01-01T00:00:00Z",
    },
  });

  const resumed = o.resumeFromClarification(suspended, {
    requestId: "c1",
    runId: suspended.id,
    answer: "October 12",
    respondedAt: "2026-01-01T00:01:00Z",
  });

  assert.equal(resumed.status, "running");
  assert.equal(resumed.checkpoint.pendingClarificationId, undefined);
  assert.equal(resumed.checkpoint.pendingApprovalId, undefined);
  assert.ok(resumed.checkpoint.notes.includes("October 12"));
  assert.ok(resumed.checkpoint.summary.includes("October 12"));
  assert.equal(resumed.suspension, undefined);
});

test("resumeFromClarification throws from invalid status", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const completed = o.applyPlannerDecision(running, { type: "task_complete", reasoning: "Done" });

  assert.throws(() => o.resumeFromClarification(completed, {
    requestId: "c1",
    runId: completed.id,
    answer: "test",
    respondedAt: new Date().toISOString(),
  }), /Invalid task-run transition/);
});

// === resumeFromApproval ===

test("resumeFromApproval granted sets running with approval note", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const suspended = o.applyPlannerDecision(running, {
    type: "approval_request",
    reasoning: "Risky",
    approvalRequest: {
      id: "ap1",
      runId: running.id,
      question: "Proceed?",
      irreversibleActionSummary: "Delete",
      createdAt: "2026-01-01T00:00:00Z",
    },
  });

  const resumed = o.resumeFromApproval(suspended, true);

  assert.equal(resumed.status, "running");
  assert.ok(resumed.checkpoint.summary.includes("granted"));
  assert.ok(resumed.checkpoint.notes.includes("User approved action"));
  assert.equal(resumed.checkpoint.pendingApprovalId, undefined);
  assert.equal(resumed.suspension, undefined);
});

test("resumeFromApproval denied sets running with denial note", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const suspended = o.applyPlannerDecision(running, {
    type: "approval_request",
    reasoning: "Risky",
    approvalRequest: {
      id: "ap1",
      runId: running.id,
      question: "Proceed?",
      irreversibleActionSummary: "Delete",
      createdAt: "2026-01-01T00:00:00Z",
    },
  });

  const resumed = o.resumeFromApproval(suspended, false);

  assert.equal(resumed.status, "running");
  assert.ok(resumed.checkpoint.summary.includes("denied"));
  assert.ok(resumed.checkpoint.notes.includes("User denied approval"));
});

test("resumeFromApproval uses provided respondedAt", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const suspended = o.applyPlannerDecision(running, {
    type: "approval_request",
    reasoning: "Risky",
    approvalRequest: {
      id: "ap1",
      runId: running.id,
      question: "Proceed?",
      irreversibleActionSummary: "Delete",
      createdAt: "2026-01-01T00:00:00Z",
    },
  });

  const resumed = o.resumeFromApproval(suspended, true, "2026-06-15T12:00:00Z");

  assert.equal(resumed.updatedAt, "2026-06-15T12:00:00Z");
});

// === failRun ===

test("failRun transitions running to failed", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const failed = o.failRun(running, "Exceeded max retries");

  assert.equal(failed.status, "failed");
  assert.equal(failed.outcome.status, "failed");
  assert.equal(failed.outcome.summary, "Exceeded max retries");
  assert.ok(failed.outcome.finishedAt);
  assert.ok(failed.checkpoint.stopReason.includes("Exceeded max retries"));
  assert.equal(failed.checkpoint.pendingApprovalId, undefined);
  assert.equal(failed.checkpoint.pendingClarificationId, undefined);
  assert.equal(failed.checkpoint.pendingBrowserAction, undefined);
  assert.equal(failed.checkpoint.nextSuggestedStep, undefined);
  assert.equal(failed.suspension, undefined);
});

test("failRun works from suspended_for_clarification", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const suspended = o.applyPlannerDecision(running, {
    type: "clarification_request",
    reasoning: "Need info",
    clarificationRequest: {
      id: "c1",
      runId: running.id,
      question: "?",
      contextSummary: "",
      options: [],
      createdAt: "2026-01-01T00:00:00Z",
    },
  });

  const failed = o.failRun(suspended, "Timeout waiting for clarification");
  assert.equal(failed.status, "failed");
});

test("failRun throws from already completed", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const completed = o.applyPlannerDecision(running, { type: "task_complete", reasoning: "Done" });

  assert.throws(() => o.failRun(completed, "Too late"), /Invalid task-run transition/);
});

// === cancelRun ===

test("cancelRun transitions running to cancelled", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const cancelled = o.cancelRun(running, "User requested cancellation");

  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.outcome.status, "cancelled");
  assert.equal(cancelled.outcome.summary, "User requested cancellation");
  assert.ok(cancelled.checkpoint.stopReason.includes("Cancelled"));
  assert.equal(cancelled.suspension, undefined);
});

test("cancelRun works from queued", () => {
  const o = makeOrchestrator();
  const queued = o.createRun(makeIntent());
  const cancelled = o.cancelRun(queued, "Changed my mind");

  assert.equal(cancelled.status, "cancelled");
});

test("cancelRun works from suspended_for_approval", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const suspended = o.applyPlannerDecision(running, {
    type: "approval_request",
    reasoning: "Risky",
    approvalRequest: {
      id: "ap1",
      runId: running.id,
      question: "Proceed?",
      irreversibleActionSummary: "Delete",
      createdAt: "2026-01-01T00:00:00Z",
    },
  });

  const cancelled = o.cancelRun(suspended, "Cancelled during approval");
  assert.equal(cancelled.status, "cancelled");
});

test("cancelRun throws from already failed", () => {
  const o = makeOrchestrator();
  const running = makeRunning(o);
  const failed = o.failRun(running, "error");

  assert.throws(() => o.cancelRun(failed, "too late"), /Invalid task-run transition/);
});

// === State transition edge cases ===

test("full lifecycle: create → start → observe → decide → record → complete", () => {
  const o = makeOrchestrator();
  let run = o.createRun(makeIntent({ goal: "Search Google" }));
  assert.equal(run.status, "queued");

  run = o.startRun(run);
  assert.equal(run.status, "running");

  run = o.attachSession(run, "default", "sess_1", "pm_0");
  run = o.observePage(run, makePageModel({ url: "https://google.com", title: "Google" }));
  assert.equal(run.checkpoint.stepCount, 1);

  run = o.applyPlannerDecision(run, {
    type: "browser_action",
    reasoning: "Type query",
    action: makeAction({ type: "type", value: "flights", description: "Type search" }),
  });
  assert.equal(run.status, "running");

  run = o.recordBrowserResult(run, makeActionResult({
    action: makeAction({ type: "type", value: "flights", description: "Type search" }),
    summary: "Typed search",
  }));

  run = o.applyPlannerDecision(run, {
    type: "task_complete",
    reasoning: "Search completed",
  });

  assert.equal(run.status, "completed");
  assert.equal(run.outcome.summary, "Search completed");
});
