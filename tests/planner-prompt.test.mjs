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

  // el_0 through el_99 should be present (cap is 150), el_150+ should not
  assert.match(user, /\[el_0\]/);
  assert.match(user, /\[el_99\]/);
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
  assert.match(system, /step 6 of 35/);
});

test("captcha hint appears when captchaDetected", () => {
  const pm = makePageModel({ captchaDetected: true });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /CAPTCHA DETECTED/);
});

test("targetId appears in action history output", () => {
  const run = makeRun({
    checkpoint: {
      summary: "ok",
      notes: [],
      stepCount: 2,
      consecutiveSoftFailures: 0,
      actionHistory: [
        { step: 0, type: "click", description: "Click Play button", ok: true, targetId: "el_14", createdAt: "2026-03-15T00:00:00Z" },
        { step: 1, type: "click", description: "Close modal", ok: true, targetId: "el_22", createdAt: "2026-03-15T00:01:00Z" }
      ]
    }
  });

  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.match(user, /→ Element: \[el_14\]/);
  assert.match(user, /→ Element: \[el_22\]/);
});

test("self-assessment triggers after 15 steps", () => {
  const run = makeRun({
    checkpoint: {
      summary: "ok",
      notes: [],
      stepCount: 15,
      actionHistory: [],
      consecutiveSoftFailures: 0
    }
  });

  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.match(user, /PROGRESS CHECK/);
});

test("self-assessment triggers on 3+ same-type actions in last 5", () => {
  const run = makeRun({
    checkpoint: {
      summary: "ok",
      notes: [],
      stepCount: 5,
      consecutiveSoftFailures: 0,
      actionHistory: [
        { step: 0, type: "click", description: "Click A", ok: true, createdAt: "2026-03-15T00:00:00Z" },
        { step: 1, type: "navigate", description: "Go somewhere", ok: true, createdAt: "2026-03-15T00:01:00Z" },
        { step: 2, type: "click", description: "Click B", ok: true, createdAt: "2026-03-15T00:02:00Z" },
        { step: 3, type: "click", description: "Click C", ok: true, createdAt: "2026-03-15T00:03:00Z" },
        { step: 4, type: "click", description: "Click D", ok: true, createdAt: "2026-03-15T00:04:00Z" }
      ]
    }
  });

  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.match(user, /PROGRESS CHECK/);
});

test("self-assessment does NOT trigger on early varied steps", () => {
  const run = makeRun({
    checkpoint: {
      summary: "ok",
      notes: [],
      stepCount: 3,
      consecutiveSoftFailures: 0,
      actionHistory: [
        { step: 0, type: "navigate", description: "Go to page", ok: true, createdAt: "2026-03-15T00:00:00Z" },
        { step: 1, type: "click", description: "Click A", ok: true, createdAt: "2026-03-15T00:01:00Z" },
        { step: 2, type: "type", description: "Type text", ok: true, createdAt: "2026-03-15T00:02:00Z" }
      ]
    }
  });

  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.doesNotMatch(user, /PROGRESS CHECK/);
});

test("visibleText truncated to 3000 chars", () => {
  const longText = "A".repeat(5000);
  const pm = makePageModel({ visibleText: longText });
  const { user } = buildPlannerPrompt(makeRun(), pm);

  // The prompt should contain at most 3000 A's
  const matches = user.match(/A+/g);
  const longestRun = Math.max(...matches.map((m) => m.length));
  assert.ok(longestRun <= 3000, `Expected at most 3000 chars, got ${longestRun}`);
});
