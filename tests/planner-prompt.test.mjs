import test from "node:test";
import assert from "node:assert/strict";

import { buildPlannerPrompt } from "../packages/planner/dist/index.js";

function makeRun(overrides = {}) {
  return {
    id: "run_intent_1",
    taskIntentId: "intent_1",
    status: "running",
    goal: "Search for flights to Tokyo",
    source: "desktop",
    constraints: ["under $800", "direct flights only"],
    metadata: {},
    createdAt: "2026-03-15T00:00:00Z",
    updatedAt: "2026-03-15T00:00:00Z",
    checkpoint: {
      summary: "Run started.",
      notes: [],
      stepCount: 0,
      actionHistory: [],
      consecutiveSoftFailures: 0
    },
    ...overrides
  };
}

function makePageModel(overrides = {}) {
  return {
    id: "pm_1",
    url: "https://flights.example.com",
    title: "Flight Search",
    summary: "Search page for flights",
    elements: [],
    visibleText: "Welcome to flight search.",
    ...overrides
  };
}

// ---------------------------------------------------------------------------

test("basic prompt includes goal, constraints, URL, title", () => {
  const { user } = buildPlannerPrompt(makeRun(), makePageModel());

  assert.match(user, /Search for flights to Tokyo/);
  assert.match(user, /under \$800/);
  assert.match(user, /direct flights only/);
  assert.match(user, /https:\/\/flights\.example\.com/);
  assert.match(user, /Flight Search/);
});

test("action history appears in prompt", () => {
  const run = makeRun({
    checkpoint: {
      summary: "ok",
      notes: [],
      stepCount: 3,
      consecutiveSoftFailures: 0,
      actionHistory: [
        { step: 0, type: "navigate", description: "Go to flights page", ok: true, createdAt: "2026-03-15T00:00:00Z" },
        { step: 1, type: "click", description: "Click search", ok: true, createdAt: "2026-03-15T00:01:00Z" },
        { step: 2, type: "type", description: "Type Tokyo", ok: false, failureClass: "element_not_found", createdAt: "2026-03-15T00:02:00Z" }
      ]
    }
  });

  const { user } = buildPlannerPrompt(run, makePageModel());

  assert.match(user, /Step 0.*Go to flights page.*OK/);
  assert.match(user, /Step 1.*Click search.*OK/);
  assert.match(user, /Step 2.*Type Tokyo.*FAILED/);
});

test("soft failure warning appears when consecutiveSoftFailures > 0", () => {
  const run = makeRun({
    checkpoint: {
      summary: "ok",
      notes: [],
      stepCount: 2,
      actionHistory: [],
      consecutiveSoftFailures: 3
    }
  });

  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.match(user, /WARNING.*3 action\(s\) failed/);
});

test("recovery section appears when recoveryContext present", () => {
  const run = makeRun({
    checkpoint: {
      summary: "ok",
      notes: [],
      stepCount: 0,
      actionHistory: [],
      consecutiveSoftFailures: 0,
      recoveryContext: {
        preInterruptionPageTitle: "Checkout Page",
        preInterruptionPageSummary: "User was filling payment form",
        preInterruptionFormValues: { "input_name": "John", "input_email": "john@test.com" },
        preInterruptionScrollY: 500
      }
    }
  });

  const { user } = buildPlannerPrompt(run, makePageModel());

  assert.match(user, /RECOVERY MODE/);
  assert.match(user, /Checkout Page/);
  assert.match(user, /payment form/);
  assert.match(user, /input_name="John"/);
  assert.match(user, /input_email="john@test\.com"/);
  assert.match(user, /Y=500px/);
});

test("recovery section omits scroll hint when scrollY <= 200", () => {
  const run = makeRun({
    checkpoint: {
      summary: "ok",
      notes: [],
      stepCount: 0,
      actionHistory: [],
      consecutiveSoftFailures: 0,
      recoveryContext: {
        preInterruptionPageTitle: "Page",
        preInterruptionPageSummary: "Summary",
        preInterruptionScrollY: 100
      }
    }
  });

  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.match(user, /RECOVERY MODE/);
  // The specific scroll-to hint (Y=...) should be absent; boilerplate "scroll position" is expected
  assert.doesNotMatch(user, /Y=\d+px/);
});

test("recovery section omits form fields when none present", () => {
  const run = makeRun({
    checkpoint: {
      summary: "ok",
      notes: [],
      stepCount: 0,
      actionHistory: [],
      consecutiveSoftFailures: 0,
      recoveryContext: {
        preInterruptionPageTitle: "Page",
        preInterruptionPageSummary: "Summary"
      }
    }
  });

  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.match(user, /RECOVERY MODE/);
  assert.doesNotMatch(user, /Form fields that were filled/);
});

test("recovery section absent when no recoveryContext", () => {
  const { user } = buildPlannerPrompt(makeRun(), makePageModel());
  assert.doesNotMatch(user, /RECOVERY MODE/);
});

test("notes section includes user answers", () => {
  const run = makeRun({
    checkpoint: {
      summary: "ok",
      notes: ["Leave on October 12", "Prefer window seat"],
      stepCount: 0,
      actionHistory: [],
      consecutiveSoftFailures: 0
    }
  });

  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.match(user, /1\. Leave on October 12/);
  assert.match(user, /2\. Prefer window seat/);
});

test("elements are sorted by actionability", () => {
  const pm = makePageModel({
    elements: [
      { id: "e1", role: "text", label: "Static text", isActionable: false, boundingVisible: true },
      { id: "e2", role: "button", label: "Submit", isActionable: true, boundingVisible: true },
      { id: "e3", role: "link", label: "Help", isActionable: true, boundingVisible: false }
    ]
  });

  const { user } = buildPlannerPrompt(makeRun(), pm);

  // actionable+visible (e2) should appear before actionable-only (e3) and before non-actionable (e1)
  const e2Pos = user.indexOf("[e2]");
  const e3Pos = user.indexOf("[e3]");
  const e1Pos = user.indexOf("[e1]");
  assert.ok(e2Pos < e3Pos, "actionable+visible should come before actionable-only");
  assert.ok(e3Pos < e1Pos, "actionable should come before non-actionable");
});

test("elements capped at 80", () => {
  const elements = Array.from({ length: 100 }, (_, i) => ({
    id: `el_${i}`,
    role: "button",
    label: `Button ${i}`,
    isActionable: true,
    boundingVisible: true
  }));

  const { user } = buildPlannerPrompt(makeRun(), makePageModel({ elements }));

  // el_0 through el_79 should be present, el_80+ should not
  // (sorting is stable for identical scores, so order is preserved)
  assert.match(user, /\[el_0\]/);
  assert.match(user, /\[el_79\]/);
  assert.doesNotMatch(user, /\[el_99\]/);
});

test("step budget shows correct values", () => {
  const run = makeRun({
    checkpoint: {
      summary: "ok",
      notes: [],
      stepCount: 5,
      actionHistory: [],
      consecutiveSoftFailures: 0
    }
  });

  const { system } = buildPlannerPrompt(run, makePageModel());
  assert.match(system, /step 6 of 20/);
});

test("captcha hint appears when captchaDetected", () => {
  const pm = makePageModel({ captchaDetected: true });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /CAPTCHA DETECTED/);
});

test("visibleText truncated to 1500 chars", () => {
  const longText = "A".repeat(3000);
  const pm = makePageModel({ visibleText: longText });
  const { user } = buildPlannerPrompt(makeRun(), pm);

  // The prompt should contain at most 1500 A's
  const matches = user.match(/A+/g);
  const longestRun = Math.max(...matches.map((m) => m.length));
  assert.ok(longestRun <= 1500, `Expected at most 1500 chars, got ${longestRun}`);
});
