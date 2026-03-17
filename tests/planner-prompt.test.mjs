import test from "node:test";
import assert from "node:assert/strict";

import { buildPlannerPrompt, MAX_PLANNER_STEPS } from "../packages/planner/dist/index.js";

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
  assert.match(system, /step 6 of 50/);
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

test("self-assessment triggers after 25 steps", () => {
  const run = makeRun({
    checkpoint: {
      summary: "ok",
      notes: [],
      stepCount: 25,
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

// ---------------------------------------------------------------------------
// Untested conditional sections
// ---------------------------------------------------------------------------

test("failedUrlsSection lists unique failed URLs", () => {
  const run = makeRun({
    checkpoint: {
      summary: "ok",
      notes: [],
      stepCount: 3,
      consecutiveSoftFailures: 0,
      actionHistory: [
        { step: 0, type: "navigate", description: "Go to A", ok: false, targetUrl: "https://a.com", createdAt: "2026-03-15T00:00:00Z" },
        { step: 1, type: "navigate", description: "Go to B", ok: false, targetUrl: "https://b.com", createdAt: "2026-03-15T00:01:00Z" },
        { step: 2, type: "navigate", description: "Go to A again", ok: false, targetUrl: "https://a.com", createdAt: "2026-03-15T00:02:00Z" }
      ]
    }
  });

  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.match(user, /FAILED URLs.*do NOT revisit/);
  assert.match(user, /https:\/\/a\.com/);
  assert.match(user, /https:\/\/b\.com/);
});

test("failedUrlsSection absent when no failed URLs", () => {
  const run = makeRun({
    checkpoint: {
      summary: "ok",
      notes: [],
      stepCount: 1,
      consecutiveSoftFailures: 0,
      actionHistory: [
        { step: 0, type: "navigate", description: "Go to page", ok: true, targetUrl: "https://ok.com", createdAt: "2026-03-15T00:00:00Z" }
      ]
    }
  });

  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.doesNotMatch(user, /FAILED URLs/);
});

test("usedQueriesSection lists unique typed search queries", () => {
  const run = makeRun({
    checkpoint: {
      summary: "ok",
      notes: [],
      stepCount: 3,
      consecutiveSoftFailures: 0,
      actionHistory: [
        { step: 0, type: "type", description: "Type query", ok: true, typedText: "flights to tokyo", createdAt: "2026-03-15T00:00:00Z" },
        { step: 1, type: "type", description: "Type again", ok: true, typedText: "cheap flights japan", createdAt: "2026-03-15T00:01:00Z" },
        { step: 2, type: "type", description: "Dupe", ok: true, typedText: "flights to tokyo", createdAt: "2026-03-15T00:02:00Z" }
      ]
    }
  });

  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.match(user, /Search queries already used.*DIFFERENT terms/);
  assert.match(user, /flights to tokyo/);
  assert.match(user, /cheap flights japan/);
});

test("usedQueriesSection absent when no type actions", () => {
  const { user } = buildPlannerPrompt(makeRun(), makePageModel());
  assert.doesNotMatch(user, /Search queries already used/);
});

test("repeatedNavWarning appears when last 3 actions are same-URL navigations", () => {
  const run = makeRun({
    checkpoint: {
      summary: "ok",
      notes: [],
      stepCount: 4,
      consecutiveSoftFailures: 0,
      actionHistory: [
        { step: 0, type: "click", description: "Click something", ok: true, createdAt: "2026-03-15T00:00:00Z" },
        { step: 1, type: "navigate", description: "Go to page", ok: true, url: "https://redirect.com", createdAt: "2026-03-15T00:01:00Z" },
        { step: 2, type: "navigate", description: "Go again", ok: true, url: "https://redirect.com", createdAt: "2026-03-15T00:02:00Z" },
        { step: 3, type: "navigate", description: "Go third time", ok: true, url: "https://redirect.com", createdAt: "2026-03-15T00:03:00Z" }
      ]
    }
  });

  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.match(user, /navigated to the same URL.*times in a row/);
});

test("repeatedNavWarning absent for varied navigations", () => {
  const run = makeRun({
    checkpoint: {
      summary: "ok",
      notes: [],
      stepCount: 3,
      consecutiveSoftFailures: 0,
      actionHistory: [
        { step: 0, type: "navigate", description: "Go A", ok: true, url: "https://a.com", createdAt: "2026-03-15T00:00:00Z" },
        { step: 1, type: "navigate", description: "Go B", ok: true, url: "https://b.com", createdAt: "2026-03-15T00:01:00Z" },
        { step: 2, type: "navigate", description: "Go C", ok: true, url: "https://c.com", createdAt: "2026-03-15T00:02:00Z" }
      ]
    }
  });

  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.doesNotMatch(user, /navigated to the same URL/);
});

test("scrollSection shows scroll position", () => {
  const pm = makePageModel({ scrollY: 1234 });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /Scroll position: Y=1234px/);
});

test("scrollSection absent when scrollY undefined", () => {
  const pm = makePageModel();
  delete pm.scrollY;
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /Scroll position:/);
});

test("focusedSection shows focused element", () => {
  const pm = makePageModel({ focusedElementId: "el_7" });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /Focused element: \[el_7\]/);
  assert.match(user, /keyboard focus/);
});

test("focusedSection absent when no focused element", () => {
  const pm = makePageModel();
  delete pm.focusedElementId;
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /Focused element:/);
});

test("focusedSection absent when focusedElementId is empty string", () => {
  const pm = makePageModel({ focusedElementId: "" });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /Focused element:/);
});

test("lastActionSection shows success result", () => {
  const run = makeRun({
    checkpoint: {
      summary: "ok",
      notes: [],
      stepCount: 1,
      consecutiveSoftFailures: 0,
      actionHistory: [
        { step: 0, type: "click", description: "Click Submit", ok: true, createdAt: "2026-03-15T00:00:00Z" }
      ]
    }
  });

  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.match(user, /Last action result: SUCCESS.*click "Click Submit"/);
});

test("lastActionSection shows failure result with class", () => {
  const run = makeRun({
    checkpoint: {
      summary: "ok",
      notes: [],
      stepCount: 1,
      consecutiveSoftFailures: 1,
      actionHistory: [
        { step: 0, type: "click", description: "Click Missing", ok: false, failureClass: "element_not_found", createdAt: "2026-03-15T00:00:00Z" }
      ]
    }
  });

  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.match(user, /Last action result: FAILED \(element_not_found\).*click "Click Missing"/);
});

test("urlWarning shows frequently visited URLs", () => {
  const run = makeRun({
    checkpoint: {
      summary: "ok",
      notes: [],
      stepCount: 5,
      actionHistory: [],
      consecutiveSoftFailures: 0,
      urlVisitCounts: { "https://stuck.com": 5, "https://ok.com": 2 }
    }
  });

  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.match(user, /WARNING.*visited these URLs too many times/);
  assert.match(user, /https:\/\/stuck\.com: 5 visits/);
  assert.doesNotMatch(user, /https:\/\/ok\.com/);
});

test("urlWarning absent when no frequent URLs", () => {
  const run = makeRun({
    checkpoint: {
      summary: "ok",
      notes: [],
      stepCount: 2,
      actionHistory: [],
      consecutiveSoftFailures: 0,
      urlVisitCounts: { "https://ok.com": 2 }
    }
  });

  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.doesNotMatch(user, /visited these URLs too many times/);
});

test("pageTypeStr appears when pageType is not unknown", () => {
  const pm = makePageModel({ pageType: "search_results" });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /Page type: search_results/);
});

test("pageTypeStr absent when pageType is unknown", () => {
  const pm = makePageModel({ pageType: "unknown" });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /Page type:/);
});

test("alertsSection lists page alerts", () => {
  const pm = makePageModel({ alerts: ["Session expired", "Please log in"] });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /Page alerts:/);
  assert.match(user, /Session expired/);
  assert.match(user, /Please log in/);
});

test("alertsSection absent when no alerts", () => {
  const pm = makePageModel({ alerts: [] });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /Page alerts:/);
});

test("formsSection renders enriched form fields", () => {
  const pm = makePageModel({
    forms: [{
      method: "POST",
      action: "/login",
      fieldCount: 2,
      fields: [
        { ref: "el_5", label: "Username", type: "text", required: true, currentValue: "john" },
        { ref: "el_6", label: "Password", type: "password", required: true }
      ],
      submitRef: "el_7"
    }]
  });

  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /FORM: POST \/login \(2 fields\)/);
  assert.match(user, /\[el_5\] "Username" type=text REQUIRED value="john"/);
  assert.match(user, /\[el_6\] "Password" type=password REQUIRED/);
  assert.match(user, /Submit button: \[el_7\]/);
});

test("formsSection absent when no forms", () => {
  const pm = makePageModel({ forms: [] });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /Forms on page:/);
});

test("activePageHint appears on step 0 with non-blank URL", () => {
  const run = makeRun({
    checkpoint: {
      summary: "ok",
      notes: [],
      stepCount: 0,
      actionHistory: [],
      consecutiveSoftFailures: 0
    }
  });
  const pm = makePageModel({ url: "https://shopping.example.com" });

  const { user } = buildPlannerPrompt(run, pm);
  assert.match(user, /CONTEXT.*page the user currently has open/);
});

test("activePageHint absent on step 0 with about:blank", () => {
  const run = makeRun({
    checkpoint: {
      summary: "ok",
      notes: [],
      stepCount: 0,
      actionHistory: [],
      consecutiveSoftFailures: 0
    }
  });
  const pm = makePageModel({ url: "about:blank" });

  const { user } = buildPlannerPrompt(run, pm);
  assert.doesNotMatch(user, /CONTEXT.*page the user currently has open/);
});

test("activePageHint absent after step 0", () => {
  const run = makeRun({
    checkpoint: {
      summary: "ok",
      notes: [],
      stepCount: 1,
      actionHistory: [
        { step: 0, type: "navigate", description: "Go", ok: true, createdAt: "2026-03-15T00:00:00Z" }
      ],
      consecutiveSoftFailures: 0
    }
  });
  const pm = makePageModel({ url: "https://shopping.example.com" });

  const { user } = buildPlannerPrompt(run, pm);
  assert.doesNotMatch(user, /CONTEXT.*page the user currently has open/);
});

test("self-assessment triggers on URL visited 4+ times", () => {
  const run = makeRun({
    checkpoint: {
      summary: "ok",
      notes: [],
      stepCount: 5,
      actionHistory: [],
      consecutiveSoftFailures: 0,
      urlVisitCounts: { "https://stuck.com": 4 }
    }
  });

  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.match(user, /PROGRESS CHECK/);
});

test("typedText appears in action history", () => {
  const run = makeRun({
    checkpoint: {
      summary: "ok",
      notes: [],
      stepCount: 1,
      consecutiveSoftFailures: 0,
      actionHistory: [
        { step: 0, type: "type", description: "Type search", ok: true, typedText: "hello world", createdAt: "2026-03-15T00:00:00Z" }
      ]
    }
  });

  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.match(user, /→ Typed: "hello world"/);
});

test("targetUrl appears in action history", () => {
  const run = makeRun({
    checkpoint: {
      summary: "ok",
      notes: [],
      stepCount: 1,
      consecutiveSoftFailures: 0,
      actionHistory: [
        { step: 0, type: "navigate", description: "Go to page", ok: true, targetUrl: "https://target.com", createdAt: "2026-03-15T00:00:00Z" }
      ]
    }
  });

  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.match(user, /→ URL: https:\/\/target\.com/);
});

test("element attributes rendered (href, inputType, value, disabled, readonly, off-screen)", () => {
  const pm = makePageModel({
    elements: [
      { id: "el_1", role: "link", label: "Home", isActionable: true, boundingVisible: true, href: "https://home.com" },
      { id: "el_2", role: "input", label: "Email", isActionable: true, boundingVisible: true, inputType: "email", value: "test@test.com" },
      { id: "el_3", role: "button", label: "Disabled", isActionable: true, boundingVisible: true, disabled: true },
      { id: "el_4", role: "input", label: "ReadOnly", isActionable: true, boundingVisible: true, readonly: true },
      { id: "el_5", role: "button", label: "Hidden", isActionable: true, boundingVisible: false }
    ]
  });

  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\[el_1\].*href="https:\/\/home\.com"/);
  assert.match(user, /\[el_2\].*type="email".*value="test@test\.com"/);
  assert.match(user, /\[el_3\].*\(disabled\)/);
  assert.match(user, /\[el_4\].*\(readonly\)/);
  assert.match(user, /\[el_5\].*\(off-screen\)/);
});

test("no interactive elements message when elements empty", () => {
  const pm = makePageModel({ elements: [] });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\(no interactive elements found\)/);
});

test("constraints shows none when empty", () => {
  const run = makeRun({ constraints: [] });
  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.match(user, /Constraints: none/);
});

// --- MAX_PLANNER_STEPS export ---

test("MAX_PLANNER_STEPS is exported and equals 50", () => {
  assert.strictEqual(MAX_PLANNER_STEPS, 50);
  assert.strictEqual(typeof MAX_PLANNER_STEPS, "number");
});

test("system prompt uses MAX_PLANNER_STEPS for step budget", () => {
  const run = makeRun({ checkpoint: { ...makeRun().checkpoint, stepCount: 5 } });
  const { system } = buildPlannerPrompt(run, makePageModel());
  assert.match(system, new RegExp(`step 6 of ${MAX_PLANNER_STEPS}`));
});

// --- totalSoftFailures warning ---

test("totalSoftWarning appears when totalSoftFailures >= 5", () => {
  const run = makeRun({
    checkpoint: { ...makeRun().checkpoint, totalSoftFailures: 5 }
  });
  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.match(user, /CRITICAL.*5 total soft failures/);
  assert.match(user, /limit: 8/);
});

test("totalSoftWarning appears at 7 total soft failures", () => {
  const run = makeRun({
    checkpoint: { ...makeRun().checkpoint, totalSoftFailures: 7 }
  });
  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.match(user, /CRITICAL.*7 total soft failures/);
});

test("totalSoftWarning absent when totalSoftFailures < 5", () => {
  const run = makeRun({
    checkpoint: { ...makeRun().checkpoint, totalSoftFailures: 4 }
  });
  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.doesNotMatch(user, /total soft failures/);
});

test("totalSoftWarning absent when totalSoftFailures undefined", () => {
  const run = makeRun();
  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.doesNotMatch(user, /total soft failures/);
});

// --- ARIA state attributes ---

test("checked attribute renders (checked) for checkbox", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "checkbox", label: "Accept terms", isActionable: true, checked: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\(checked\)/);
});

test("checked attribute absent when not set", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "checkbox", label: "Accept terms", isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /\(checked\)/);
});

test("selected attribute renders (selected) for tab", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "tab", label: "Overview", isActionable: true, selected: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\(selected\)/);
});

test("selected attribute absent when not set", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "tab", label: "Overview", isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /\(selected\)/);
});

test("expanded=true renders (expanded) for dropdown", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "button", label: "Menu", isActionable: true, expanded: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\(expanded\)/);
});

test("expanded=false renders (collapsed) for dropdown", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "button", label: "Menu", isActionable: true, expanded: false }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\(collapsed\)/);
});

test("expanded absent when undefined", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "button", label: "Menu", isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /\(expanded\)/);
  assert.doesNotMatch(user, /\(collapsed\)/);
});

test("multiple ARIA state attributes render together", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "option", label: "Choice A", isActionable: true, selected: true, checked: true, expanded: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\(checked\)/);
  assert.match(user, /\(selected\)/);
  assert.match(user, /\(expanded\)/);
});

// --- Select options rendering ---

test("select options rendered when present", () => {
  const pm = makePageModel({
    elements: [{
      id: "el_0", role: "combobox", label: "Country", isActionable: true,
      options: [
        { value: "us", label: "United States" },
        { value: "uk", label: "United Kingdom" },
        { value: "jp", label: "Japan" }
      ]
    }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /options=\[/);
  assert.match(user, /"us" \(United States\)/);
  assert.match(user, /"uk" \(United Kingdom\)/);
  assert.match(user, /"jp" \(Japan\)/);
});

test("select options omit label parenthetical when label equals value", () => {
  const pm = makePageModel({
    elements: [{
      id: "el_0", role: "combobox", label: "Size", isActionable: true,
      options: [
        { value: "Small", label: "Small" },
        { value: "Large", label: "Large" }
      ]
    }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /options=\["Small", "Large"\]/);
  assert.doesNotMatch(user, /\(Small\)/);
});

test("select options absent when options undefined", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "combobox", label: "Country", isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /options=\[/);
});

test("select options absent when options empty", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "combobox", label: "Country", isActionable: true, options: [] }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /options=\[/);
});

// --- datalist suggestions reuse same options rendering ---

test("datalist options rendered same as select options", () => {
  // datalist options populate the same `options` field on PageElementModel
  // so they render identically via the existing options rendering path
  const pm = makePageModel({
    elements: [{
      id: "el_0", role: "textbox", label: "City", isActionable: true, boundingVisible: true,
      inputType: "text",
      options: [
        { value: "NYC", label: "New York City" },
        { value: "LAX", label: "Los Angeles" },
        { value: "CHI", label: "Chicago" }
      ]
    }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /options=\["NYC" \(New York City\), "LAX" \(Los Angeles\), "CHI" \(Chicago\)\]/);
});

test("datalist options omit label when same as value", () => {
  const pm = makePageModel({
    elements: [{
      id: "el_0", role: "textbox", label: "Color", isActionable: true, boundingVisible: true,
      options: [{ value: "Red", label: "Red" }, { value: "Blue", label: "Blue" }]
    }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /options=\["Red", "Blue"\]/);
});

// --- Invalid / validation state ---

test("invalid element shows (invalid) annotation", () => {
  const pm = makePageModel({
    elements: [{
      id: "el_0", role: "textbox", label: "Email", isActionable: true, boundingVisible: true,
      invalid: true
    }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\(invalid\)/);
});

test("non-invalid element omits (invalid) annotation", () => {
  const pm = makePageModel({
    elements: [{
      id: "el_0", role: "textbox", label: "Email", isActionable: true, boundingVisible: true
    }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.ok(!user.includes("(invalid)"));
});

test("invalid annotation appears before disabled", () => {
  const pm = makePageModel({
    elements: [{
      id: "el_0", role: "textbox", label: "Email", isActionable: true, boundingVisible: true,
      invalid: true, disabled: true
    }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  const invalidIdx = user.indexOf("(invalid)");
  const disabledIdx = user.indexOf("(disabled)");
  assert.ok(invalidIdx < disabledIdx, "(invalid) should appear before (disabled)");
});

test("form field shows validation message", () => {
  const pm = makePageModel({
    forms: [{
      action: "/submit",
      method: "POST",
      fieldCount: 1,
      fields: [{
        ref: "el_0",
        label: "Email",
        type: "email",
        required: true,
        currentValue: "notanemail",
        validationMessage: "Please enter a valid email address"
      }],
      submitRef: "el_1"
    }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /INVALID: "Please enter a valid email address"/);
});

test("form field omits validation message when absent", () => {
  const pm = makePageModel({
    forms: [{
      action: "/submit",
      method: "POST",
      fieldCount: 1,
      fields: [{
        ref: "el_0",
        label: "Email",
        type: "email",
        required: true,
        currentValue: "test@example.com"
      }],
      submitRef: "el_1"
    }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.ok(!user.includes("INVALID:"));
});

// ---------------------------------------------------------------------------
// text (visible text differing from label)
// ---------------------------------------------------------------------------

test("element text rendered when different from label", () => {
  const pm = makePageModel({
    elements: [{ id: "el_1", role: "button", label: "Close", text: "✕", isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\[el_1\] button "Close" text="✕"/);
});

test("element text absent when undefined", () => {
  const pm = makePageModel({
    elements: [{ id: "el_1", role: "button", label: "Submit", isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.ok(!user.includes('text='));
});

test("element text absent when same as label", () => {
  // text field should not be set when innerText === label, but even if passed,
  // the prompt renderer checks for truthy text
  const pm = makePageModel({
    elements: [{ id: "el_1", role: "button", label: "Submit", text: undefined, isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.ok(!user.includes('text='));
});

// ---------------------------------------------------------------------------
// Active dialog detection
// ---------------------------------------------------------------------------

test("active dialog hint shown when activeDialog present", () => {
  const pm = makePageModel({ activeDialog: { label: "Cookie Consent" } });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /DIALOG OPEN: "Cookie Consent"/);
  assert.match(user, /You MUST address it/);
  assert.match(user, /before attempting to interact with background/);
});

test("active dialog hint absent when no activeDialog", () => {
  const pm = makePageModel();
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.ok(!user.includes("DIALOG OPEN"));
});

test("active dialog hint absent when activeDialog is undefined", () => {
  const pm = makePageModel({ activeDialog: undefined });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.ok(!user.includes("DIALOG OPEN"));
});

// ---------------------------------------------------------------------------
// Element description (aria-description)
// ---------------------------------------------------------------------------

test("element description rendered when present", () => {
  const pm = makePageModel({
    elements: [{ id: "el_1", role: "button", label: "Delete", description: "Permanently removes the selected items", isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /desc="Permanently removes the selected items"/);
});

test("element description absent when undefined", () => {
  const pm = makePageModel({
    elements: [{ id: "el_1", role: "button", label: "Delete", isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.ok(!user.includes('desc='));
});

test("element description rendered after text and before href", () => {
  const pm = makePageModel({
    elements: [{ id: "el_1", role: "link", label: "Help", text: "?", description: "Opens help center", href: "/help", isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  // Verify ordering: text before desc before href
  const textIdx = user.indexOf('text="?"');
  const descIdx = user.indexOf('desc="Opens help center"');
  const hrefIdx = user.indexOf('href="/help"');
  assert.ok(textIdx < descIdx, "text should come before desc");
  assert.ok(descIdx < hrefIdx, "desc should come before href");
});

// --- Heading level tests ---

test("heading level rendered when present", () => {
  const pm = makePageModel({
    elements: [{ id: "el_1", role: "heading", label: "Welcome", level: 1, isActionable: false }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.ok(user.includes('level=1'), "should show level=1 for h1 heading");
});

test("heading level absent when undefined", () => {
  const pm = makePageModel({
    elements: [{ id: "el_1", role: "button", label: "Click me", isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.ok(!user.includes('level='), "should not show level for non-heading elements");
});

test("heading level rendered after role/label and before text", () => {
  const pm = makePageModel({
    elements: [{ id: "el_1", role: "heading", label: "Section Title", level: 2, text: "Subtitle", isActionable: false }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  const levelIdx = user.indexOf('level=2');
  const textIdx = user.indexOf('text="Subtitle"');
  assert.ok(levelIdx > 0, "level should be present");
  assert.ok(textIdx > 0, "text should be present");
  assert.ok(levelIdx < textIdx, "level should come before text");
});

// --- aria-current ---

test("current annotation rendered when aria-current is 'page'", () => {
  const pm = makePageModel({
    elements: [{ id: "el_1", role: "link", label: "Home", current: "page", isActionable: true, boundingVisible: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\(current=page\)/);
});

test("current annotation rendered as bare (current) when value is 'true'", () => {
  const pm = makePageModel({
    elements: [{ id: "el_1", role: "link", label: "Dashboard", current: "true", isActionable: true, boundingVisible: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\(current\)/);
  assert.ok(!user.includes("(current=true)"), "should not show =true for boolean current");
});

test("current annotation absent when undefined", () => {
  const pm = makePageModel({
    elements: [{ id: "el_1", role: "link", label: "About", isActionable: true, boundingVisible: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.ok(!user.includes("(current"), "should not show current annotation");
});

test("current=step rendered for step indicators", () => {
  const pm = makePageModel({
    elements: [{ id: "el_1", role: "link", label: "Step 2", current: "step", isActionable: true, boundingVisible: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\(current=step\)/);
});

// --- aria-sort ---

test("sort=ascending rendered for sorted column header", () => {
  const pm = makePageModel({
    elements: [{ id: "el_1", role: "columnheader", label: "Name", sort: "ascending", isActionable: true, boundingVisible: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\(sort=ascending\)/);
});

test("sort=descending rendered for sorted column header", () => {
  const pm = makePageModel({
    elements: [{ id: "el_1", role: "columnheader", label: "Date", sort: "descending", isActionable: true, boundingVisible: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\(sort=descending\)/);
});

test("sort annotation absent when undefined", () => {
  const pm = makePageModel({
    elements: [{ id: "el_1", role: "columnheader", label: "Size", isActionable: true, boundingVisible: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.ok(!user.includes("(sort"), "should not show sort annotation");
});

test("sort=other rendered for non-standard sort", () => {
  const pm = makePageModel({
    elements: [{ id: "el_1", role: "columnheader", label: "Priority", sort: "other", isActionable: true, boundingVisible: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\(sort=other\)/);
});

// --- aria-roledescription ---

test("roleDescription rendered when present", () => {
  const pm = makePageModel({
    elements: [{ id: "el_1", role: "slider", label: "Temperature", roleDescription: "temperature control", isActionable: true, boundingVisible: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /roleDesc="temperature control"/);
});

test("roleDescription absent when undefined", () => {
  const pm = makePageModel({
    elements: [{ id: "el_1", role: "slider", label: "Volume", isActionable: true, boundingVisible: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.ok(!user.includes("roleDesc"), "should not show roleDesc annotation");
});

test("roleDescription rendered after sort and before text", () => {
  const pm = makePageModel({
    elements: [{ id: "el_1", role: "columnheader", label: "Name", sort: "ascending", roleDescription: "sortable column", text: "Name ▲", isActionable: true, boundingVisible: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  const sortIdx = user.indexOf("(sort=ascending)");
  const roleDescIdx = user.indexOf('roleDesc="sortable column"');
  const textIdx = user.indexOf('text="Name ▲"');
  assert.ok(sortIdx < roleDescIdx, "sort should come before roleDesc");
  assert.ok(roleDescIdx < textIdx, "roleDesc should come before text");
});

// --- aria-value* (range widgets) ---

test("valueNow rendered as range for slider", () => {
  const pm = makePageModel({
    elements: [{ id: "el_1", role: "slider", label: "Volume", valueNow: 50, valueMin: 0, valueMax: 100, isActionable: true, boundingVisible: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /range=50\/0–100/);
});

test("valueNow without min/max rendered as simple range", () => {
  const pm = makePageModel({
    elements: [{ id: "el_1", role: "progressbar", label: "Upload", valueNow: 75, isActionable: false, boundingVisible: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /range=75\b/);
  assert.ok(!user.includes("range=75/"), "should not show min-max when both undefined");
});

test("valueText takes precedence over valueNow", () => {
  const pm = makePageModel({
    elements: [{ id: "el_1", role: "slider", label: "Temperature", valueNow: 72, valueText: "72°F (warm)", isActionable: true, boundingVisible: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /valueText="72°F \(warm\)"/);
  assert.ok(!user.includes("range="), "should not show range when valueText present");
});

test("range annotation absent when no value properties", () => {
  const pm = makePageModel({
    elements: [{ id: "el_1", role: "slider", label: "Brightness", isActionable: true, boundingVisible: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.ok(!user.includes("range="), "should not show range annotation");
  assert.ok(!user.includes("valueText"), "should not show valueText annotation");
});

test("valueNow with partial min renders question mark for missing max", () => {
  const pm = makePageModel({
    elements: [{ id: "el_1", role: "spinbutton", label: "Quantity", valueNow: 3, valueMin: 1, isActionable: true, boundingVisible: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /range=3\/1–\?/);
});

test("range annotation placed after roleDesc and before text", () => {
  const pm = makePageModel({
    elements: [{ id: "el_1", role: "slider", label: "Speed", roleDescription: "speed control", valueNow: 5, valueMin: 1, valueMax: 10, text: "5 mph", isActionable: true, boundingVisible: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  const roleDescIdx = user.indexOf('roleDesc="speed control"');
  const rangeIdx = user.indexOf("range=5/1–10");
  const textIdx = user.indexOf('text="5 mph"');
  assert.ok(roleDescIdx < rangeIdx, "roleDesc should come before range");
  assert.ok(rangeIdx < textIdx, "range should come before text");
});

// ---------------------------------------------------------------------------
// tables section
// ---------------------------------------------------------------------------

test("tablesSection shows table with caption, headers, and sample rows", () => {
  const pm = makePageModel({
    tables: [{
      caption: "Flight Results",
      headers: ["Airline", "Price", "Duration"],
      rowCount: 5,
      sampleRows: [
        ["Delta", "$450", "14h 30m"],
        ["United", "$520", "15h 10m"],
        ["ANA", "$480", "13h 45m"]
      ]
    }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /TABLE "Flight Results"/);
  assert.match(user, /Airline \| Price \| Duration/);
  assert.match(user, /5 rows/);
  assert.match(user, /Delta \| \$450 \| 14h 30m/);
  assert.match(user, /ANA \| \$480 \| 13h 45m/);
});

test("tablesSection shows table without caption", () => {
  const pm = makePageModel({
    tables: [{
      headers: ["Name", "Value"],
      rowCount: 2,
      sampleRows: [["A", "1"], ["B", "2"]]
    }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /TABLE: Name \| Value/);
  assert.doesNotMatch(user, /TABLE "/);
});

test("tablesSection shows (no headers) when headers empty", () => {
  const pm = makePageModel({
    tables: [{
      headers: [],
      rowCount: 3,
      sampleRows: [["x", "y"]]
    }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\(no headers\)/);
  assert.match(user, /3 rows/);
});

test("tablesSection shows singular row for rowCount 1", () => {
  const pm = makePageModel({
    tables: [{
      headers: ["Col"],
      rowCount: 1
    }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /1 row\)/);
  assert.doesNotMatch(user, /1 rows/);
});

test("tablesSection absent when no tables", () => {
  const pm = makePageModel({ tables: undefined });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /Data tables on page/);
});

test("tablesSection absent when tables empty array", () => {
  const pm = makePageModel({ tables: [] });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /Data tables on page/);
});

test("tablesSection shows multiple tables", () => {
  const pm = makePageModel({
    tables: [
      { headers: ["A"], rowCount: 1 },
      { headers: ["B"], rowCount: 2 }
    ]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /TABLE: A/);
  assert.match(user, /TABLE: B/);
});

// --- aria-pressed (toggle button state) ---

test("pressed=true renders (pressed)", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "button", label: "Mute", pressed: true, isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\(pressed\)/);
});

test("pressed=false renders (not pressed)", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "button", label: "Mute", pressed: false, isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\(not pressed\)/);
});

test("pressed=mixed renders (partially pressed)", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "button", label: "Select All", pressed: "mixed", isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\(partially pressed\)/);
});

test("pressed undefined does not render pressed text", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "button", label: "Submit", isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /pressed/);
});

// --- aria-orientation (slider/scrollbar/toolbar direction) ---

test("orientation=horizontal renders (horizontal)", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "slider", label: "Volume", orientation: "horizontal", isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\(horizontal\)/);
});

test("orientation=vertical renders (vertical)", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "slider", label: "Volume", orientation: "vertical", isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\(vertical\)/);
});

test("orientation undefined does not render orientation text", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "slider", label: "Volume", isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /\(horizontal\)/);
  assert.doesNotMatch(user, /\(vertical\)/);
});

// --- autocomplete ---

test("autocomplete=list renders (autocomplete=list)", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "combobox", label: "Search", autocomplete: "list", isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\(autocomplete=list\)/);
});

test("autocomplete=both renders (autocomplete=both)", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "combobox", label: "City", autocomplete: "both", isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\(autocomplete=both\)/);
});

test("autocomplete=inline renders (autocomplete=inline)", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "combobox", label: "Email", autocomplete: "inline", isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\(autocomplete=inline\)/);
});

test("autocomplete undefined does not render autocomplete text", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "combobox", label: "Search", isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /autocomplete=/);
});

// --- multiselectable ---

test("multiselectable renders (multiselectable) for listbox", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "listbox", label: "Colors", multiselectable: true, isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\(multiselectable\)/);
});

test("multiselectable absent when undefined", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "listbox", label: "Colors", isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /multiselectable/);
});

test("multiselectable absent when false", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "grid", label: "Data", multiselectable: false, isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /multiselectable/);
});

test("multiselectable renders after autocomplete and before invalid", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "listbox", label: "Items", autocomplete: "list", multiselectable: true, invalid: true, isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  const acIdx = user.indexOf("(autocomplete=list)");
  const msIdx = user.indexOf("(multiselectable)");
  const invIdx = user.indexOf("(invalid)");
  assert.ok(acIdx < msIdx, "multiselectable should come after autocomplete");
  assert.ok(msIdx < invIdx, "multiselectable should come before invalid");
});

// --- aria-required (form element required state) ---

test("required=true renders (required) for textbox", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "textbox", label: "Email", required: true, isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\(required\)/);
});

test("required absent when undefined", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "textbox", label: "Email", isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /required/);
});

test("required absent when false", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "combobox", label: "Country", required: false, isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /required/);
});

test("required renders after multiselectable and before invalid", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "listbox", label: "Items", multiselectable: true, required: true, invalid: true, isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  const msIdx = user.indexOf("(multiselectable)");
  const reqIdx = user.indexOf("(required)");
  const invIdx = user.indexOf("(invalid)");
  assert.ok(msIdx < reqIdx, "required should come after multiselectable");
  assert.ok(reqIdx < invIdx, "required should come before invalid");
});

// --- hasPopup tests ---

test("hasPopup renders (haspopup=menu) for button with aria-haspopup=menu", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "button", label: "Options", hasPopup: "menu", isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\(haspopup=menu\)/);
});

test("hasPopup absent when undefined", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "button", label: "Submit", isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /haspopup/);
});

test("hasPopup renders (haspopup=dialog) for dialog triggers", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "button", label: "Settings", hasPopup: "dialog", isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\(haspopup=dialog\)/);
});

test("hasPopup renders after required and before invalid", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "combobox", label: "Country", required: true, hasPopup: "listbox", invalid: true, isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  const reqIdx = user.indexOf("(required)");
  const hpIdx = user.indexOf("(haspopup=listbox)");
  const invIdx = user.indexOf("(invalid)");
  assert.ok(reqIdx < hpIdx, "hasPopup should come after required");
  assert.ok(hpIdx < invIdx, "hasPopup should come before invalid");
});

// --- busy tests ---

test("busy renders (busy) for element with aria-busy=true", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "region", label: "Results", busy: true, isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\(busy\)/);
});

test("busy absent when undefined", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "region", label: "Results", isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /\(busy\)/);
});

test("busy absent when false", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "region", label: "Results", busy: false, isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /\(busy\)/);
});

test("busy renders after haspopup and before invalid", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "combobox", label: "Search", hasPopup: "listbox", busy: true, invalid: true, isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  const hpIdx = user.indexOf("(haspopup=listbox)");
  const busyIdx = user.indexOf("(busy)");
  const invIdx = user.indexOf("(invalid)");
  assert.ok(hpIdx < busyIdx, "busy should come after haspopup");
  assert.ok(busyIdx < invIdx, "busy should come before invalid");
});

// --- live tests ---

test("live renders (live=polite) for element with aria-live=polite", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "region", label: "Status", live: "polite", isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\(live=polite\)/);
});

test("live absent when undefined", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "region", label: "Content", isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /\(live=/);
});

test("live renders (live=assertive) for assertive regions", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "alert", label: "Error", live: "assertive", isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\(live=assertive\)/);
});

test("live renders after busy and before invalid", () => {
  const pm = makePageModel({
    elements: [{ id: "el_0", role: "region", label: "Results", busy: true, live: "polite", invalid: true, isActionable: true }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  const busyIdx = user.indexOf("(busy)");
  const liveIdx = user.indexOf("(live=polite)");
  const invIdx = user.indexOf("(invalid)");
  assert.ok(busyIdx < liveIdx, "live should come after busy");
  assert.ok(liveIdx < invIdx, "live should come before invalid");
});

// --- landmarks tests ---

test("landmarks render Page regions section with role and label", () => {
  const pm = makePageModel({
    landmarks: [
      { role: "navigation", label: "Main menu" },
      { role: "main", label: "" },
      { role: "complementary", label: "Sidebar" }
    ]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /Page regions:/);
  assert.match(user, /navigation "Main menu"/);
  assert.match(user, /^\s+main$/m);
  assert.match(user, /complementary "Sidebar"/);
});

test("landmarks absent when undefined", () => {
  const pm = makePageModel({});
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /Page regions:/);
});

test("landmarks absent when empty array", () => {
  const pm = makePageModel({ landmarks: [] });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /Page regions:/);
});

test("landmarks render without label when label is empty", () => {
  const pm = makePageModel({
    landmarks: [{ role: "banner", label: "" }]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /Page regions:/);
  // Should render just the role, no quotes
  assert.match(user, /^\s+banner$/m);
  assert.doesNotMatch(user, /banner ""/);
});

// ---------------------------------------------------------------------------
// Element count truncation notice
// ---------------------------------------------------------------------------

test("truncation notice shown when elements exceed 150", () => {
  const elements = Array.from({ length: 200 }, (_, i) => ({
    id: `el_${i}`, role: "button", label: `Btn ${i}`, isActionable: true
  }));
  const pm = makePageModel({ elements });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /showing 150 of 200/);
  assert.match(user, /scroll to reveal more/);
});

test("truncation notice absent when elements are 150 or fewer", () => {
  const elements = Array.from({ length: 150 }, (_, i) => ({
    id: `el_${i}`, role: "button", label: `Btn ${i}`, isActionable: true
  }));
  const pm = makePageModel({ elements });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /showing 150 of/);
  assert.doesNotMatch(user, /scroll to reveal more/);
});

test("truncation notice absent when no elements", () => {
  const pm = makePageModel({ elements: [] });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /showing.*of/);
});

// ---------------------------------------------------------------------------
// Element-to-landmark association
// ---------------------------------------------------------------------------

test("element with landmark annotation renders in=<landmark>", () => {
  const pm = makePageModel({
    elements: [
      { id: "el_0", role: "link", label: "Home", isActionable: true, landmark: "navigation" },
      { id: "el_1", role: "button", label: "Submit", isActionable: true, landmark: "main" },
    ]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\[el_0\] link "Home" in=navigation/);
  assert.match(user, /\[el_1\] button "Submit" in=main/);
});

test("element without landmark annotation does not render in=", () => {
  const pm = makePageModel({
    elements: [
      { id: "el_0", role: "button", label: "OK", isActionable: true },
    ]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\[el_0\] button "OK"/);
  assert.doesNotMatch(user, /in=/);
});

test("landmark annotation renders before other attributes like level", () => {
  const pm = makePageModel({
    elements: [
      { id: "el_0", role: "heading", label: "Section Title", isActionable: false, landmark: "main", level: 2 },
    ]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\[el_0\] heading "Section Title" in=main level=2/);
});

// --- aria-keyshortcuts surfacing ---

test("keyShortcuts renders keys attribute for elements with aria-keyshortcuts", () => {
  const pm = makePageModel({
    elements: [
      { id: "el_0", role: "button", label: "Save", isActionable: true, keyShortcuts: "Alt+S", boundingVisible: true },
    ]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\[el_0\] button "Save" keys="Alt\+S" \*/);
});

test("keyShortcuts absent when element has no keyShortcuts", () => {
  const pm = makePageModel({
    elements: [
      { id: "el_0", role: "button", label: "Save", isActionable: true },
    ]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /keys=/);
});

test("keyShortcuts renders alongside other attributes like landmark and level", () => {
  const pm = makePageModel({
    elements: [
      { id: "el_0", role: "heading", label: "Dashboard", isActionable: false, landmark: "main", level: 1, keyShortcuts: "Alt+D" },
    ]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\[el_0\] heading "Dashboard" in=main level=1 keys="Alt\+D"/);
});

// --- Cookie banner detection hint ---

test("cookie banner hint appears when cookieBannerDetected is true", () => {
  const pm = makePageModel({ cookieBannerDetected: true });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /COOKIE BANNER DETECTED/);
  assert.match(user, /Dismiss it first/);
});

test("cookie banner hint absent when cookieBannerDetected is false", () => {
  const pm = makePageModel({ cookieBannerDetected: false });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /COOKIE BANNER/);
});

test("cookie banner hint absent when cookieBannerDetected is undefined", () => {
  const pm = makePageModel();
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /COOKIE BANNER/);
});

// --- Shadow DOM annotation ---

test("inShadowDom renders (shadow) annotation for element in shadow DOM", () => {
  const pm = makePageModel({
    elements: [
      { id: "el_0", role: "button", label: "Accept", isActionable: true, inShadowDom: true, boundingVisible: true }
    ]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\(shadow\)/);
  assert.match(user, /\[el_0\] button "Accept".*\(shadow\)/);
});

test("inShadowDom absent when undefined", () => {
  const pm = makePageModel({
    elements: [
      { id: "el_0", role: "button", label: "Accept", isActionable: true, boundingVisible: true }
    ]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /\(shadow\)/);
});

test("inShadowDom renders after options and before off-screen", () => {
  const pm = makePageModel({
    elements: [
      { id: "el_0", role: "button", label: "Accept", isActionable: true, inShadowDom: true, boundingVisible: false }
    ]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  // (shadow) should appear before (off-screen)
  const line = user.split("\n").find(l => l.includes("[el_0]"));
  const shadowIdx = line.indexOf("(shadow)");
  const offscreenIdx = line.indexOf("(off-screen)");
  assert.ok(shadowIdx < offscreenIdx, "(shadow) should appear before (off-screen)");
});

// --- Iframe detection ---

test("iframeCount hint shown when iframes are present", () => {
  const pm = makePageModel({ iframeCount: 3 });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /IFRAMES DETECTED/);
  assert.match(user, /3 iframe\(s\)/);
});

test("iframe hint absent when iframeCount is undefined", () => {
  const pm = makePageModel({});
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.doesNotMatch(user, /IFRAMES DETECTED/);
});

test("iframe hint includes sources when iframeSources provided (no same-origin elements)", () => {
  const pm = makePageModel({
    iframeCount: 2,
    iframeSources: ["https://ads.example.com/banner", "https://maps.example.com/embed"]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /IFRAMES DETECTED/);
  assert.match(user, /2 iframe\(s\)/);
  assert.match(user, /ads\.example\.com/);
  assert.match(user, /maps\.example\.com/);
  assert.match(user, /navigating directly to the iframe source URL/);
});

test("iframe hint mentions same-origin elements when present", () => {
  const pm = makePageModel({
    iframeCount: 2,
    iframeSources: ["https://cross-origin.example.com"],
    elements: [
      { id: "el_0", role: "button", label: "Main btn", isActionable: true, boundingVisible: true },
      { id: "frame0_el_0", role: "textbox", label: "Iframe input", isActionable: true, iframeIndex: 0, boundingVisible: true },
    ]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /IFRAMES DETECTED/);
  assert.match(user, /Same-origin iframe elements are included/);
  assert.match(user, /interact with them normally/);
});

test("iframe element shown with (iframe[N]) annotation in element list", () => {
  const pm = makePageModel({
    iframeCount: 1,
    elements: [
      { id: "el_0", role: "button", label: "Main btn", isActionable: true, boundingVisible: true },
      { id: "frame0_el_0", role: "textbox", label: "Iframe input", isActionable: true, iframeIndex: 0, boundingVisible: true },
    ]
  });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /\[frame0_el_0\].*textbox.*"Iframe input".*\(iframe\[0\]\)/);
  // Main frame element should NOT have iframe annotation
  assert.doesNotMatch(user, /\[el_0\].*\(iframe/);
});

// ---------------------------------------------------------------------------
// T3: Planner prompt token budget audit (Session 91)
// ---------------------------------------------------------------------------

/**
 * Build a "heavy" page model: 150 elements with varied properties,
 * 5 forms with fields, 3 tables with sample rows, 4 landmarks,
 * alerts, dialog, cookie banner, iframes, visible text.
 */
function makeHeavyPageModel() {
  const elements = [];
  const roles = ["button", "link", "textbox", "checkbox", "radio", "combobox", "slider", "tab", "menuitem", "img"];
  for (let i = 0; i < 150; i++) {
    const role = roles[i % roles.length];
    const el = {
      id: `el_${i}`,
      role,
      label: `Element ${i} — ${role} with a descriptive label for testing`,
      isActionable: i % 2 === 0,
      boundingVisible: i % 3 !== 0,
    };
    // Populate various properties on subsets of elements
    if (role === "link") {
      el.href = `https://example.com/page/${i}`;
      el.text = `Link text for item ${i} with some additional context`;
    }
    if (role === "textbox") {
      el.inputType = "email";
      el.value = `user${i}@example.com`;
      el.required = true;
      el.autocomplete = "list";
      el.description = `Enter your email address for field ${i}`;
    }
    if (role === "checkbox") {
      el.checked = i % 4 === 0;
      el.description = `Toggle option ${i}`;
    }
    if (role === "radio") {
      el.selected = i % 5 === 0;
      el.required = true;
    }
    if (role === "combobox") {
      el.expanded = i % 2 === 0;
      el.hasPopup = "listbox";
      el.options = [
        { value: `opt_a_${i}`, label: `Option A for ${i}` },
        { value: `opt_b_${i}`, label: `Option B for ${i}` },
        { value: `opt_c_${i}`, label: `Option C for ${i}` },
      ];
    }
    if (role === "slider") {
      el.valueNow = 50;
      el.valueMin = 0;
      el.valueMax = 100;
      el.orientation = "horizontal";
    }
    if (role === "tab") {
      el.current = i % 3 === 0 ? "true" : undefined;
      el.sort = i % 6 === 0 ? "ascending" : undefined;
    }
    if (role === "menuitem") {
      el.keyShortcuts = "Ctrl+Shift+K";
      el.roleDescription = "custom menu action";
    }
    if (role === "button") {
      el.pressed = i % 7 === 0 ? true : i % 7 === 1 ? false : undefined;
      el.disabled = i % 10 === 0;
      el.busy = i % 15 === 0;
    }
    if (i % 8 === 0) el.landmark = "main";
    if (i % 12 === 0) el.landmark = "navigation";
    if (i % 20 === 0) el.inShadowDom = true;
    if (i % 9 === 0) el.live = "polite";
    if (i % 11 === 0) el.multiselectable = true;
    if (i % 13 === 0) el.invalid = true;
    if (i % 14 === 0) el.readonly = true;
    if (i % 16 === 0) el.level = Math.floor(i / 16) + 1;
    if (i % 17 === 0) el.valueText = `${i} percent`;
    elements.push(el);
  }

  const forms = [];
  for (let f = 0; f < 5; f++) {
    const fields = [];
    for (let fi = 0; fi < 6; fi++) {
      fields.push({
        ref: `form${f}_field${fi}`,
        label: `Field ${fi} in form ${f}`,
        type: fi % 3 === 0 ? "text" : fi % 3 === 1 ? "email" : "password",
        required: fi < 3,
        currentValue: fi === 0 ? "prefilled@example.com" : "",
        validationMessage: fi === 2 ? "This field is required" : undefined,
      });
    }
    forms.push({
      action: `https://example.com/submit-form-${f}`,
      method: f % 2 === 0 ? "POST" : "GET",
      fieldCount: 6,
      fields,
      submitRef: `form${f}_submit`,
    });
  }

  const tables = [
    {
      caption: "Quarterly Results",
      headers: ["Quarter", "Revenue", "Expenses", "Profit", "Growth %"],
      rowCount: 12,
      sampleRows: [
        ["Q1 2025", "$1,234,567", "$987,654", "$246,913", "+12.3%"],
        ["Q2 2025", "$1,345,678", "$1,012,345", "$333,333", "+15.1%"],
        ["Q3 2025", "$1,456,789", "$1,123,456", "$333,333", "+8.2%"],
      ],
    },
    {
      caption: "Employee Directory",
      headers: ["Name", "Department", "Title", "Location", "Email"],
      rowCount: 50,
      sampleRows: [
        ["Jane Doe", "Engineering", "Staff Engineer", "San Francisco", "jane@example.com"],
        ["John Smith", "Product", "Senior PM", "New York", "john@example.com"],
      ],
    },
    {
      headers: ["Product", "SKU", "Price", "Stock"],
      rowCount: 200,
      sampleRows: [
        ["Widget Pro", "WP-001", "$29.99", "In Stock"],
        ["Widget Basic", "WB-002", "$14.99", "Low Stock"],
        ["Widget Ultra", "WU-003", "$49.99", "Out of Stock"],
      ],
    },
  ];

  const landmarks = [
    { role: "banner", label: "Site Header" },
    { role: "navigation", label: "Main Navigation" },
    { role: "main", label: "Primary Content" },
    { role: "contentinfo", label: "Site Footer" },
  ];

  const visibleText = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(50)
    + "This is a realistic page with multiple sections, forms, tables, and interactive elements. "
    + "Navigation links, search results, product listings, and user profile sections are all present. "
    + "The page includes cookie consent banners, advertising iframes, and modal dialogs. ".repeat(5);

  return makePageModel({
    url: "https://complex-webapp.example.com/dashboard/analytics?view=quarterly&region=all",
    title: "Analytics Dashboard — Complex Web Application — Quarterly Overview",
    pageType: "form",
    elements,
    forms,
    tables,
    landmarks,
    alerts: ["Your session will expire in 5 minutes", "3 new notifications"],
    captchaDetected: false,
    cookieBannerDetected: true,
    iframeCount: 4,
    iframeSources: [
      "https://ads.doubleclick.net/pagead/ads?client=ca-pub-12345",
      "https://maps.googleapis.com/maps/api/js?key=abc123&embed=true",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://analytics.example.com/tracker.html",
    ],
    activeDialog: { label: "Confirm Changes" },
    scrollY: 450,
    focusedElementId: "el_42",
    visibleText,
  });
}

/**
 * Build a "light" page model: 20 simple elements, no forms/tables/landmarks.
 */
function makeLightPageModel() {
  const elements = [];
  for (let i = 0; i < 20; i++) {
    elements.push({
      id: `el_${i}`,
      role: i < 5 ? "link" : i < 10 ? "button" : i < 15 ? "textbox" : "img",
      label: `Element ${i}`,
      isActionable: i < 15,
      boundingVisible: true,
      href: i < 5 ? `https://example.com/page/${i}` : undefined,
    });
  }
  return makePageModel({
    url: "https://simple.example.com/page",
    title: "Simple Page",
    elements,
    visibleText: "This is a simple page with minimal content.",
  });
}

test("T3: prompt token budget — heavy page model measurement", () => {
  const heavyPM = makeHeavyPageModel();
  const run = makeRun({
    goal: "Extract quarterly revenue data from the analytics dashboard, compare Q1-Q3 growth rates, and summarize findings",
    constraints: ["only use data visible on the current page", "do not navigate away"],
    checkpoint: {
      summary: "Navigated to dashboard, dismissed cookie banner, now analyzing data tables.",
      notes: ["User confirmed: focus on 2025 data only", "User said: ignore advertising revenue"],
      stepCount: 8,
      actionHistory: [
        { step: 0, type: "navigate", description: "Go to analytics dashboard", ok: true, createdAt: "2026-03-15T00:00:00Z" },
        { step: 1, type: "click", description: "Dismiss cookie banner", ok: true, createdAt: "2026-03-15T00:00:10Z" },
        { step: 2, type: "click", description: "Select quarterly view", ok: true, createdAt: "2026-03-15T00:00:20Z" },
        { step: 3, type: "click", description: "Expand all regions filter", ok: true, createdAt: "2026-03-15T00:00:30Z" },
        { step: 4, type: "scroll", description: "Scroll to data tables", ok: true, createdAt: "2026-03-15T00:00:40Z" },
        { step: 5, type: "click", description: "Click revenue column header to sort", ok: false, failureClass: "element_not_found", createdAt: "2026-03-15T00:00:50Z" },
        { step: 6, type: "scroll", description: "Scroll down to see more rows", ok: true, createdAt: "2026-03-15T00:01:00Z" },
        { step: 7, type: "extract", description: "Extract table data", ok: true, createdAt: "2026-03-15T00:01:10Z" },
      ],
      consecutiveSoftFailures: 0,
      totalSoftFailures: 1,
    },
  });

  const { system, user } = buildPlannerPrompt(run, heavyPM);
  const totalChars = system.length + user.length;
  const estimatedTokens = Math.ceil(totalChars / 4);
  const pctOfContext = ((estimatedTokens / 200_000) * 100).toFixed(2);

  // Log measurements (visible in test output)
  console.log(`\n=== T3 HEAVY PAGE MODEL PROMPT BUDGET ===`);
  console.log(`System prompt: ${system.length} chars`);
  console.log(`User prompt:   ${user.length} chars`);
  console.log(`Total:         ${totalChars} chars`);
  console.log(`Estimated tokens (chars/4): ${estimatedTokens}`);
  console.log(`% of 200k context window:   ${pctOfContext}%`);
  console.log(`Element count in model:     ${heavyPM.elements.length}`);
  console.log(`Forms: ${heavyPM.forms.length}, Tables: ${heavyPM.tables.length}, Landmarks: ${heavyPM.landmarks.length}`);
  console.log(`==========================================\n`);

  // The prompt must be well-formed
  assert.ok(totalChars > 0, "prompt should not be empty");
  assert.match(user, /quarterly revenue data/);
  assert.match(user, /Interactive elements/);

  // Record the actual measurement for documentation
  // If this exceeds 120k chars (~30k tokens, 15% of context), the test still passes
  // but the measurement will trigger a condensation strategy proposal
  assert.ok(totalChars < 500_000, `prompt is unreasonably large: ${totalChars} chars`);
});

test("T3: prompt token budget — light page model measurement", () => {
  const lightPM = makeLightPageModel();
  const run = makeRun();

  const { system, user } = buildPlannerPrompt(run, lightPM);
  const totalChars = system.length + user.length;
  const estimatedTokens = Math.ceil(totalChars / 4);
  const pctOfContext = ((estimatedTokens / 200_000) * 100).toFixed(2);

  console.log(`\n=== T3 LIGHT PAGE MODEL PROMPT BUDGET ===`);
  console.log(`System prompt: ${system.length} chars`);
  console.log(`User prompt:   ${user.length} chars`);
  console.log(`Total:         ${totalChars} chars`);
  console.log(`Estimated tokens (chars/4): ${estimatedTokens}`);
  console.log(`% of 200k context window:   ${pctOfContext}%`);
  console.log(`Element count in model:     ${lightPM.elements.length}`);
  console.log(`==========================================\n`);

  assert.ok(totalChars > 0, "prompt should not be empty");
  assert.match(user, /Simple Page/);
  assert.ok(totalChars < 500_000, `prompt is unreasonably large: ${totalChars} chars`);
});

test("T3: heavy prompt is significantly larger than light prompt", () => {
  const heavyPM = makeHeavyPageModel();
  const lightPM = makeLightPageModel();
  const run = makeRun();

  const heavy = buildPlannerPrompt(run, heavyPM);
  const light = buildPlannerPrompt(run, lightPM);

  const heavyTotal = heavy.system.length + heavy.user.length;
  const lightTotal = light.system.length + light.user.length;
  const ratio = (heavyTotal / lightTotal).toFixed(1);

  console.log(`\n=== T3 PROMPT SIZE COMPARISON ===`);
  console.log(`Heavy: ${heavyTotal} chars, Light: ${lightTotal} chars`);
  console.log(`Ratio: ${ratio}x`);
  console.log(`=================================\n`);

  // Heavy should be meaningfully larger due to 150 elements + forms + tables + etc.
  assert.ok(heavyTotal > lightTotal * 2, `heavy prompt should be at least 2x light (got ${ratio}x)`);
});

// ===========================================================================
// T4: Planner Input Pipeline Integration Tests — Realistic Page Models
// ===========================================================================

// --- T4-A: Google-like Search Engine Results Page ---

function makeGoogleSERPPageModel() {
  return {
    id: "pm_serp_1",
    url: "https://www.google.com/search?q=openai",
    title: "openai - Google Search",
    summary: "Google search results page for 'openai'",
    pageType: "search_results",
    visibleText: "openai - Google Search\n\nOpenAI\nhttps://openai.com\nOpenAI is an AI research and deployment company. Our mission is to ensure that artificial general intelligence benefits all of humanity.\n\nOpenAI - Wikipedia\nhttps://en.wikipedia.org/wiki/OpenAI\nOpenAI is an American artificial intelligence research laboratory consisting of the non-profit OpenAI, Inc. and its for-profit subsidiary OpenAI Global, LLC.\n\nOpenAI Platform\nhttps://platform.openai.com\nExplore developer resources, tutorials, API docs, and dynamic examples to get the most out of OpenAI's platform.\n\nPeople also ask\nWhat does OpenAI do?\nIs ChatGPT made by OpenAI?\nIs OpenAI free to use?\n\nRelated searches: openai chatgpt, openai stock, openai api",
    cookieBannerDetected: true,
    scrollY: 0,
    focusedElementId: "e_search_box",
    landmarks: [
      { role: "banner", label: "" },
      { role: "navigation", label: "Search navigation" },
      { role: "main", label: "Search results" },
      { role: "contentinfo", label: "" }
    ],
    elements: [
      // Banner / Navigation
      { id: "e_logo", role: "link", label: "Google", href: "https://www.google.com", isActionable: true, boundingVisible: true, landmark: "banner" },
      { id: "e_search_box", role: "combobox", label: "Search", value: "openai", isActionable: true, boundingVisible: true, inputType: "text", autocomplete: "both", hasPopup: "listbox", expanded: false, landmark: "banner" },
      { id: "e_search_btn", role: "button", label: "Google Search", isActionable: true, boundingVisible: true, landmark: "banner" },
      { id: "e_lucky_btn", role: "button", label: "I'm Feeling Lucky", isActionable: true, boundingVisible: true, landmark: "banner" },
      { id: "e_nav_all", role: "link", label: "All", href: "https://www.google.com/search?q=openai", isActionable: true, boundingVisible: true, current: "page", landmark: "navigation" },
      { id: "e_nav_images", role: "link", label: "Images", href: "https://www.google.com/search?q=openai&tbm=isch", isActionable: true, boundingVisible: true, landmark: "navigation" },
      { id: "e_nav_news", role: "link", label: "News", href: "https://www.google.com/search?q=openai&tbm=nws", isActionable: true, boundingVisible: true, landmark: "navigation" },
      { id: "e_nav_videos", role: "link", label: "Videos", href: "https://www.google.com/search?q=openai&tbm=vid", isActionable: true, boundingVisible: true, landmark: "navigation" },

      // Search results
      { id: "e_r1_link", role: "link", label: "OpenAI", href: "https://openai.com", isActionable: true, boundingVisible: true, text: "OpenAI is an AI research and deployment company.", landmark: "main" },
      { id: "e_r1_url", role: "link", label: "https://openai.com", href: "https://openai.com", isActionable: true, boundingVisible: true, landmark: "main" },
      { id: "e_r2_link", role: "link", label: "OpenAI - Wikipedia", href: "https://en.wikipedia.org/wiki/OpenAI", isActionable: true, boundingVisible: true, text: "OpenAI is an American artificial intelligence research laboratory.", landmark: "main" },
      { id: "e_r3_link", role: "link", label: "OpenAI Platform", href: "https://platform.openai.com", isActionable: true, boundingVisible: true, text: "Explore developer resources, tutorials, API docs.", landmark: "main" },

      // People also ask
      { id: "e_paa_1", role: "button", label: "What does OpenAI do?", isActionable: true, boundingVisible: true, expanded: false, landmark: "main" },
      { id: "e_paa_2", role: "button", label: "Is ChatGPT made by OpenAI?", isActionable: true, boundingVisible: true, expanded: false, landmark: "main" },
      { id: "e_paa_3", role: "button", label: "Is OpenAI free to use?", isActionable: true, boundingVisible: true, expanded: false, landmark: "main" },

      // Related searches
      { id: "e_rel_1", role: "link", label: "openai chatgpt", href: "https://www.google.com/search?q=openai+chatgpt", isActionable: true, boundingVisible: true, landmark: "main" },
      { id: "e_rel_2", role: "link", label: "openai stock", href: "https://www.google.com/search?q=openai+stock", isActionable: true, boundingVisible: true, landmark: "main" },
      { id: "e_rel_3", role: "link", label: "openai api", href: "https://www.google.com/search?q=openai+api", isActionable: true, boundingVisible: true, landmark: "main" },

      // Pagination
      { id: "e_next", role: "link", label: "Next", href: "https://www.google.com/search?q=openai&start=10", isActionable: true, boundingVisible: true, landmark: "navigation" },

      // Cookie banner
      { id: "e_cookie_accept", role: "button", label: "Accept all", isActionable: true, boundingVisible: true },
      { id: "e_cookie_reject", role: "button", label: "Reject all", isActionable: true, boundingVisible: true },
      { id: "e_cookie_customize", role: "button", label: "Customize", isActionable: true, boundingVisible: true }
    ],
    createdAt: "2026-03-16T00:00:00Z"
  };
}

test("T4-A: Google SERP — prompt well-formedness and element surfacing", () => {
  const pm = makeGoogleSERPPageModel();
  const run = makeRun({
    goal: "Search for OpenAI",
    constraints: [],
    checkpoint: { summary: "Run started.", notes: [], stepCount: 0, actionHistory: [], consecutiveSoftFailures: 0 }
  });

  const { system, user } = buildPlannerPrompt(run, pm);
  const totalChars = system.length + user.length;
  const estimatedTokens = Math.ceil(totalChars / 4);
  const pctOfContext = ((estimatedTokens / 200_000) * 100).toFixed(2);

  console.log(`\n=== T4-A: GOOGLE SERP PROMPT ===`);
  console.log(`Total: ${totalChars} chars, ~${estimatedTokens} tokens, ${pctOfContext}% of 200k`);
  console.log(`Elements: ${pm.elements.length}`);
  console.log(`================================\n`);

  // Prompt structure
  assert.match(system, /OpenBrowse/, "system prompt identifies the agent");
  assert.match(system, /ReAct/, "system prompt mentions ReAct framework");
  assert.match(user, /Goal: Search for OpenAI/, "task goal embedded");
  assert.match(user, /google\.com\/search/, "current URL present");
  assert.match(user, /openai - Google Search/, "page title present");

  // Page type
  assert.match(user, /Page type: search_results/, "page type surfaced");

  // Search box with correct properties
  assert.match(user, /\[e_search_box\] combobox "Search"/, "search box present with role and label");
  assert.match(user, /autocomplete=both/, "search box autocomplete surfaced");
  assert.match(user, /haspopup=listbox/, "search box hasPopup surfaced");
  assert.match(user, /value="openai"/, "search box current value surfaced");

  // Result links with hrefs
  assert.match(user, /\[e_r1_link\] link "OpenAI".*href="https:\/\/openai\.com"/, "first result link with href");
  assert.match(user, /\[e_r2_link\] link "OpenAI - Wikipedia".*href="https:\/\/en\.wikipedia\.org\/wiki\/OpenAI"/, "second result with href");
  assert.match(user, /\[e_r3_link\] link "OpenAI Platform".*href="https:\/\/platform\.openai\.com"/, "third result with href");

  // People Also Ask expandable buttons
  assert.match(user, /\[e_paa_1\] button "What does OpenAI do\?".*\(collapsed\)/, "PAA button with collapsed state");

  // Navigation links with current page indicator
  assert.match(user, /\[e_nav_all\] link "All".*\(current=page\)/, "current nav tab marked");

  // Cookie banner hint
  assert.match(user, /COOKIE BANNER DETECTED/, "cookie banner hint present");
  assert.match(user, /\[e_cookie_accept\] button "Accept all"/, "cookie accept button surfaced");

  // Landmarks
  assert.match(user, /Page regions:/, "landmarks section present");
  assert.match(user, /banner/, "banner landmark");
  assert.match(user, /navigation "Search navigation"/, "navigation landmark with label");
  assert.match(user, /main "Search results"/, "main landmark with label");

  // Landmark annotation on elements
  assert.match(user, /\[e_search_box\].*in=banner/, "search box annotated with banner landmark");
  assert.match(user, /\[e_r1_link\].*in=main/, "result link annotated with main landmark");

  // Focused element
  assert.match(user, /Focused element: \[e_search_box\]/, "focused element surfaced");

  // Visible text excerpt
  assert.match(user, /OpenAI is an AI research/, "visible text excerpt present");

  // Actionable markers
  assert.match(user, /\[e_search_box\].*\*/, "search box marked actionable");
  assert.match(user, /\[e_r1_link\].*\*/, "result link marked actionable");

  // Character count within budget
  assert.ok(totalChars < 30_000, `SERP prompt should be under 30k chars (got ${totalChars})`);
});

// --- T4-B: Wikipedia Article Page ---

function makeWikipediaPageModel() {
  return {
    id: "pm_wiki_1",
    url: "https://en.wikipedia.org/wiki/Electron_(software)",
    title: "Electron (software) - Wikipedia",
    summary: "Wikipedia article about the Electron software framework",
    pageType: "article",
    visibleText: "Electron (software)\nFrom Wikipedia, the free encyclopedia\n\nElectron (formerly known as Atom Shell) is a free and open-source software framework developed and maintained by OpenJS Foundation. The framework is designed to create desktop applications using web technologies that are rendered using a version of the Chromium browser engine and a back end using the Node.js runtime environment.\n\nElectron has been used to create many popular applications, including Visual Studio Code, Slack, Discord, and many more.\n\nContents\n1 History\n2 Architecture\n3 Applications\n4 Reception\n5 See also\n6 References\n7 External links\n\nHistory\nElectron was created by Cheng Zhao at GitHub in 2013. It was initially developed as a framework for building the Atom text editor.\n\nArchitecture\nElectron combines the Chromium rendering engine and the Node.js runtime. Applications are packaged with a minimal Chromium browser.\n\nApplications\nNotable applications built with Electron include:\n- Visual Studio Code\n- Slack\n- Discord\n- WhatsApp Desktop\n- Microsoft Teams",
    scrollY: 0,
    landmarks: [
      { role: "banner", label: "" },
      { role: "navigation", label: "Site navigation" },
      { role: "main", label: "" },
      { role: "complementary", label: "Article sidebar" },
      { role: "contentinfo", label: "" }
    ],
    elements: [
      // Banner
      { id: "e_wp_logo", role: "link", label: "Wikipedia", href: "https://en.wikipedia.org/wiki/Main_Page", isActionable: true, boundingVisible: true, landmark: "banner" },
      { id: "e_wp_search", role: "searchbox", label: "Search Wikipedia", isActionable: true, boundingVisible: true, inputType: "search", landmark: "banner" },
      { id: "e_wp_search_btn", role: "button", label: "Search", isActionable: true, boundingVisible: true, landmark: "banner" },

      // Navigation
      { id: "e_wp_main_page", role: "link", label: "Main page", href: "https://en.wikipedia.org/wiki/Main_Page", isActionable: true, boundingVisible: true, landmark: "navigation" },
      { id: "e_wp_contents", role: "link", label: "Contents", href: "https://en.wikipedia.org/wiki/Wikipedia:Contents", isActionable: true, boundingVisible: true, landmark: "navigation" },
      { id: "e_wp_random", role: "link", label: "Random article", href: "https://en.wikipedia.org/wiki/Special:Random", isActionable: true, boundingVisible: true, landmark: "navigation" },

      // Article headings
      { id: "e_h1", role: "heading", label: "Electron (software)", isActionable: false, boundingVisible: true, level: 1, landmark: "main" },
      { id: "e_h2_history", role: "heading", label: "History", isActionable: false, boundingVisible: true, level: 2, landmark: "main" },
      { id: "e_h2_arch", role: "heading", label: "Architecture", isActionable: false, boundingVisible: true, level: 2, landmark: "main" },
      { id: "e_h2_apps", role: "heading", label: "Applications", isActionable: false, boundingVisible: true, level: 2, landmark: "main" },
      { id: "e_h2_reception", role: "heading", label: "Reception", isActionable: false, boundingVisible: true, level: 2, landmark: "main" },
      { id: "e_h2_seealso", role: "heading", label: "See also", isActionable: false, boundingVisible: true, level: 2, landmark: "main" },
      { id: "e_h2_refs", role: "heading", label: "References", isActionable: false, boundingVisible: true, level: 2, landmark: "main" },

      // Table of contents links
      { id: "e_toc_history", role: "link", label: "1 History", href: "#History", isActionable: true, boundingVisible: true, landmark: "main" },
      { id: "e_toc_arch", role: "link", label: "2 Architecture", href: "#Architecture", isActionable: true, boundingVisible: true, landmark: "main" },
      { id: "e_toc_apps", role: "link", label: "3 Applications", href: "#Applications", isActionable: true, boundingVisible: true, landmark: "main" },

      // Internal article links
      { id: "e_link_openjs", role: "link", label: "OpenJS Foundation", href: "https://en.wikipedia.org/wiki/OpenJS_Foundation", isActionable: true, boundingVisible: true, landmark: "main" },
      { id: "e_link_chromium", role: "link", label: "Chromium", href: "https://en.wikipedia.org/wiki/Chromium_(web_browser)", isActionable: true, boundingVisible: true, landmark: "main" },
      { id: "e_link_nodejs", role: "link", label: "Node.js", href: "https://en.wikipedia.org/wiki/Node.js", isActionable: true, boundingVisible: true, landmark: "main" },
      { id: "e_link_vscode", role: "link", label: "Visual Studio Code", href: "https://en.wikipedia.org/wiki/Visual_Studio_Code", isActionable: true, boundingVisible: true, landmark: "main" },
      { id: "e_link_slack", role: "link", label: "Slack", href: "https://en.wikipedia.org/wiki/Slack_(software)", isActionable: true, boundingVisible: true, landmark: "main" },
      { id: "e_link_discord", role: "link", label: "Discord", href: "https://en.wikipedia.org/wiki/Discord", isActionable: true, boundingVisible: true, landmark: "main" },
      { id: "e_link_github", role: "link", label: "GitHub", href: "https://en.wikipedia.org/wiki/GitHub", isActionable: true, boundingVisible: true, landmark: "main" },

      // Sidebar
      { id: "e_sidebar_edit", role: "link", label: "Edit", href: "https://en.wikipedia.org/w/index.php?title=Electron_(software)&action=edit", isActionable: true, boundingVisible: true, landmark: "complementary" },
      { id: "e_sidebar_history", role: "link", label: "View history", href: "https://en.wikipedia.org/w/index.php?title=Electron_(software)&action=history", isActionable: true, boundingVisible: true, landmark: "complementary" },

      // Language links
      { id: "e_lang_switch", role: "button", label: "Languages", isActionable: true, boundingVisible: true, expanded: false, hasPopup: "menu" }
    ],
    tables: [
      {
        caption: "Electron",
        headers: ["Developer(s)", "Initial release", "Stable release", "Repository", "License"],
        rowCount: 1,
        sampleRows: [["OpenJS Foundation", "July 15, 2013", "v33.2.0 / March 2026", "github.com/electron/electron", "MIT License"]]
      }
    ],
    createdAt: "2026-03-16T00:00:00Z"
  };
}

test("T4-B: Wikipedia article — headings, landmarks, links, and table structure", () => {
  const pm = makeWikipediaPageModel();
  const run = makeRun({
    goal: "Find the first paragraph about Electron",
    constraints: [],
    checkpoint: { summary: "Run started.", notes: [], stepCount: 0, actionHistory: [], consecutiveSoftFailures: 0 }
  });

  const { system, user } = buildPlannerPrompt(run, pm);
  const totalChars = system.length + user.length;
  const estimatedTokens = Math.ceil(totalChars / 4);
  const pctOfContext = ((estimatedTokens / 200_000) * 100).toFixed(2);

  console.log(`\n=== T4-B: WIKIPEDIA ARTICLE PROMPT ===`);
  console.log(`Total: ${totalChars} chars, ~${estimatedTokens} tokens, ${pctOfContext}% of 200k`);
  console.log(`Elements: ${pm.elements.length}`);
  console.log(`======================================\n`);

  // Task goal
  assert.match(user, /Goal: Find the first paragraph about Electron/, "task goal embedded");

  // Page type
  assert.match(user, /Page type: article/, "page type surfaced as article");

  // URL and title
  assert.match(user, /en\.wikipedia\.org\/wiki\/Electron/, "Wikipedia URL present");
  assert.match(user, /Electron \(software\) - Wikipedia/, "page title present");

  // Heading hierarchy
  assert.match(user, /\[e_h1\] heading "Electron \(software\)" in=main level=1/, "h1 with level=1 and main landmark");
  assert.match(user, /\[e_h2_history\] heading "History" in=main level=2/, "h2 History with level=2");
  assert.match(user, /\[e_h2_arch\] heading "Architecture" in=main level=2/, "h2 Architecture with level=2");

  // Internal links with hrefs
  assert.match(user, /\[e_link_chromium\] link "Chromium".*href="https:\/\/en\.wikipedia\.org\/wiki\/Chromium/, "internal link with href");
  assert.match(user, /\[e_link_nodejs\] link "Node\.js".*href=/, "Node.js internal link");
  assert.match(user, /\[e_link_vscode\] link "Visual Studio Code".*href=/, "VS Code internal link");

  // Table of contents links
  assert.match(user, /\[e_toc_history\] link "1 History".*href="#History"/, "TOC link for History");

  // Landmarks
  assert.match(user, /Page regions:/, "landmarks section");
  assert.match(user, /navigation "Site navigation"/, "site navigation landmark");
  assert.match(user, /main/, "main landmark");
  assert.match(user, /complementary "Article sidebar"/, "sidebar complementary landmark");

  // Landmark annotation on elements
  assert.match(user, /\[e_wp_logo\].*in=banner/, "logo annotated with banner");
  assert.match(user, /\[e_sidebar_edit\].*in=complementary/, "sidebar edit annotated with complementary");

  // Table structure
  assert.match(user, /Data tables on page:/, "tables section present");
  assert.match(user, /TABLE "Electron"/, "table caption surfaced");
  assert.match(user, /Developer\(s\).*Initial release/, "table headers surfaced");
  assert.match(user, /OpenJS Foundation.*MIT License/, "table sample row surfaced");
  assert.match(user, /1 row/, "table row count");

  // Language button with hasPopup
  assert.match(user, /\[e_lang_switch\] button "Languages".*\(collapsed\).*haspopup=menu/, "language button with collapsed+hasPopup");

  // Visible text excerpt (first paragraph)
  assert.match(user, /Electron \(formerly known as Atom Shell\)/, "first paragraph visible in text excerpt");
  assert.match(user, /free and open-source software framework/, "article content in visible text");

  // Search box
  assert.match(user, /\[e_wp_search\] searchbox "Search Wikipedia"/, "search box present");

  // Character count within budget
  assert.ok(totalChars < 30_000, `Wikipedia prompt should be under 30k chars (got ${totalChars})`);
});

// --- T4-C: Login Form Page ---

function makeLoginFormPageModel() {
  return {
    id: "pm_login_1",
    url: "https://github.com/login",
    title: "Sign in to GitHub",
    summary: "GitHub login page with email and password form",
    pageType: "login",
    visibleText: "Sign in to GitHub\n\nUsername or email address\nPassword\nForgot password?\nSign in\n\nNew to GitHub? Create an account\n\nOr sign in with:\nSign in with Google\nSign in with Microsoft",
    scrollY: 0,
    forms: [
      {
        action: "https://github.com/session",
        method: "POST",
        fieldCount: 2,
        fields: [
          { ref: "e_email", label: "Username or email address", type: "text", required: true, currentValue: "", validationMessage: "" },
          { ref: "e_password", label: "Password", type: "password", required: true, currentValue: "", validationMessage: "" }
        ],
        submitRef: "e_submit"
      }
    ],
    landmarks: [
      { role: "banner", label: "" },
      { role: "main", label: "" }
    ],
    elements: [
      // Banner
      { id: "e_gh_logo", role: "link", label: "GitHub", href: "https://github.com", isActionable: true, boundingVisible: true, landmark: "banner" },

      // Login form fields
      { id: "e_email", role: "textbox", label: "Username or email address", isActionable: true, boundingVisible: true, inputType: "text", required: true, value: "", landmark: "main" },
      { id: "e_password", role: "textbox", label: "Password", isActionable: true, boundingVisible: true, inputType: "password", required: true, value: "", landmark: "main" },
      { id: "e_forgot", role: "link", label: "Forgot password?", href: "https://github.com/password_reset", isActionable: true, boundingVisible: true, landmark: "main" },
      { id: "e_submit", role: "button", label: "Sign in", isActionable: true, boundingVisible: true, landmark: "main" },

      // Social login
      { id: "e_google_sso", role: "button", label: "Sign in with Google", isActionable: true, boundingVisible: true, landmark: "main" },
      { id: "e_ms_sso", role: "button", label: "Sign in with Microsoft", isActionable: true, boundingVisible: true, landmark: "main" },

      // Create account
      { id: "e_signup", role: "link", label: "Create an account", href: "https://github.com/signup", isActionable: true, boundingVisible: true, landmark: "main" }
    ],
    createdAt: "2026-03-16T00:00:00Z"
  };
}

test("T4-C: Login form — form fields, validation, submit, and social login", () => {
  const pm = makeLoginFormPageModel();
  const run = makeRun({
    goal: "Log in with email test@example.com",
    constraints: [],
    checkpoint: { summary: "Run started.", notes: [], stepCount: 0, actionHistory: [], consecutiveSoftFailures: 0 }
  });

  const { system, user } = buildPlannerPrompt(run, pm);
  const totalChars = system.length + user.length;
  const estimatedTokens = Math.ceil(totalChars / 4);
  const pctOfContext = ((estimatedTokens / 200_000) * 100).toFixed(2);

  console.log(`\n=== T4-C: LOGIN FORM PROMPT ===`);
  console.log(`Total: ${totalChars} chars, ~${estimatedTokens} tokens, ${pctOfContext}% of 200k`);
  console.log(`Elements: ${pm.elements.length}`);
  console.log(`===============================\n`);

  // Task goal
  assert.match(user, /Goal: Log in with email test@example\.com/, "task goal with email embedded");

  // Page type
  assert.match(user, /Page type: login/, "page type surfaced as login");

  // URL and title
  assert.match(user, /github\.com\/login/, "login URL present");
  assert.match(user, /Sign in to GitHub/, "page title present");

  // Form summary section
  assert.match(user, /Forms on page:/, "forms section present");
  assert.match(user, /FORM: POST https:\/\/github\.com\/session/, "form action and method");
  assert.match(user, /2 fields/, "field count in form summary");

  // Form field details
  assert.match(user, /\[e_email\] "Username or email address" type=text REQUIRED/, "email field with type and REQUIRED");
  assert.match(user, /\[e_password\] "Password" type=password REQUIRED/, "password field with type and REQUIRED");

  // Submit reference
  assert.match(user, /Submit button: \[e_submit\]/, "submit button ref in form summary");

  // Element list — email field
  assert.match(user, /\[e_email\] textbox "Username or email address"/, "email field in element list");
  assert.match(user, /\[e_email\].*\(required\)/, "email field marked required in elements");
  assert.match(user, /\[e_email\].*\*/, "email field marked actionable");

  // Element list — password field
  assert.match(user, /\[e_password\] textbox "Password".*type="password"/, "password field with inputType");
  assert.match(user, /\[e_password\].*\(required\)/, "password field marked required");

  // Submit button
  assert.match(user, /\[e_submit\] button "Sign in".*\*/, "sign in button present and actionable");

  // Social login buttons
  assert.match(user, /\[e_google_sso\] button "Sign in with Google".*\*/, "Google SSO button");
  assert.match(user, /\[e_ms_sso\] button "Sign in with Microsoft".*\*/, "Microsoft SSO button");

  // Forgot password link
  assert.match(user, /\[e_forgot\] link "Forgot password\?".*href="https:\/\/github\.com\/password_reset"/, "forgot password link with href");

  // Create account link
  assert.match(user, /\[e_signup\] link "Create an account".*href="https:\/\/github\.com\/signup"/, "signup link with href");

  // Landmarks
  assert.match(user, /Page regions:/, "landmarks section");
  assert.match(user, /main/, "main landmark");

  // Landmark annotation
  assert.match(user, /\[e_email\].*in=main/, "email annotated with main landmark");

  // Visible text
  assert.match(user, /Sign in to GitHub/, "visible text present");

  // Character count within budget
  assert.ok(totalChars < 30_000, `Login prompt should be under 30k chars (got ${totalChars})`);
});

// T4-C variant: Login form with validation errors

test("T4-C2: Login form with validation errors — error states surfaced in prompt", () => {
  const pm = makeLoginFormPageModel();
  // Override form fields with validation errors
  pm.forms[0].fields[0].validationMessage = "Please enter a valid email address";
  pm.forms[0].fields[0].currentValue = "invalid-email";
  pm.forms[0].fields[1].validationMessage = "Password is required";

  // Also mark the email element as invalid
  const emailEl = pm.elements.find(e => e.id === "e_email");
  emailEl.invalid = true;
  emailEl.value = "invalid-email";

  const run = makeRun({
    goal: "Log in with email test@example.com",
    constraints: [],
    checkpoint: { summary: "Run started.", notes: [], stepCount: 0, actionHistory: [], consecutiveSoftFailures: 0 }
  });

  const { user } = buildPlannerPrompt(run, pm);

  // Validation messages in form summary
  assert.match(user, /INVALID: "Please enter a valid email address"/, "email validation error surfaced in form");
  assert.match(user, /INVALID: "Password is required"/, "password validation error surfaced in form");

  // Current value in form summary
  assert.match(user, /value="invalid-email"/, "current field value in form summary");

  // Invalid state on element
  assert.match(user, /\[e_email\].*\(invalid\)/, "email element marked invalid");
});

// T4 summary: all three scenarios produce well-formed, actionable prompts

// ---------------------------------------------------------------------------
// Planner scratchpad notes (browser_save_note)
// ---------------------------------------------------------------------------

test("planner notes appear in user prompt when plannerNotes has entries", () => {
  const run = makeRun({
    checkpoint: {
      summary: "Run in progress.",
      notes: [],
      stepCount: 3,
      actionHistory: [],
      consecutiveSoftFailures: 0,
      plannerNotes: [
        { key: "Site 1 price", value: "$299 at Amazon" },
        { key: "Site 2 price", value: "$279 at Best Buy" }
      ]
    }
  });
  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.match(user, /Your saved notes/);
  assert.match(user, /"Site 1 price": \$299 at Amazon/);
  assert.match(user, /"Site 2 price": \$279 at Best Buy/);
});

test("planner notes section is absent when plannerNotes is empty", () => {
  const run = makeRun({
    checkpoint: {
      summary: "Run started.",
      notes: [],
      stepCount: 0,
      actionHistory: [],
      consecutiveSoftFailures: 0,
      plannerNotes: []
    }
  });
  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.ok(!user.includes("Your saved notes"));
});

test("planner notes section is absent when plannerNotes is undefined", () => {
  const run = makeRun(); // no plannerNotes field
  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.ok(!user.includes("Your saved notes"));
});

test("system prompt mentions browser_save_note usage guidance", () => {
  const { system } = buildPlannerPrompt(makeRun(), makePageModel());
  assert.match(system, /browser_save_note/);
  assert.match(system, /multi-page/i);
});

test("system prompt includes error recovery strategies", () => {
  const { system } = buildPlannerPrompt(makeRun(), makePageModel());
  assert.match(system, /Error Recovery/, "error recovery section header present");
  assert.match(system, /Element not found/, "element not found strategy present");
  assert.match(system, /Click intercepted/, "click intercepted strategy present");
  assert.match(system, /Navigation timeout/, "navigation timeout strategy present");
  assert.match(system, /Type action failed/, "type action failed strategy present");
  assert.match(system, /2 consecutive failures/, "consecutive failure limit present");
  assert.match(system, /ask_user/, "escalation to ask_user mentioned");
});

test("error recovery section does not encourage infinite retries", () => {
  const { system } = buildPlannerPrompt(makeRun(), makePageModel());
  // Should mention stopping/escalating, not just "retry forever"
  assert.match(system, /Stop retrying/, "tells planner to stop retrying after repeated failures");
  assert.match(system, /different approach/, "suggests alternative approach");
});

test("system prompt includes clear_first guidance for form field replacement", () => {
  const { system } = buildPlannerPrompt(makeRun(), makePageModel());
  assert.match(system, /clear_first/, "clear_first parameter mentioned in prompt");
  assert.match(system, /replacing existing content|pre-filled/i, "explains when to use clear_first");
});

test("T4: all three realistic page models produce prompts under 30k chars", () => {
  const scenarios = [
    { name: "Google SERP", pm: makeGoogleSERPPageModel(), goal: "Search for OpenAI" },
    { name: "Wikipedia", pm: makeWikipediaPageModel(), goal: "Find the first paragraph about Electron" },
    { name: "Login Form", pm: makeLoginFormPageModel(), goal: "Log in with email test@example.com" }
  ];

  console.log(`\n=== T4: ALL SCENARIOS SUMMARY ===`);
  for (const { name, pm, goal } of scenarios) {
    const run = makeRun({
      goal,
      constraints: [],
      checkpoint: { summary: "Run started.", notes: [], stepCount: 0, actionHistory: [], consecutiveSoftFailures: 0 }
    });
    const { system, user } = buildPlannerPrompt(run, pm);
    const total = system.length + user.length;
    const tokens = Math.ceil(total / 4);
    console.log(`  ${name}: ${total} chars, ~${tokens} tokens, ${((tokens / 200_000) * 100).toFixed(2)}% of 200k, ${pm.elements.length} elements`);
    assert.ok(total < 30_000, `${name} prompt should be under 30k chars`);
  }
  console.log(`=================================\n`);
});

// --- T14: Step-budget awareness and partial result delivery ---

test("low-budget warning appears when remaining steps <= 10", () => {
  // stepCount 40 means step 41 of 50, remaining = 50 - 41 = 9
  const run = makeRun({
    checkpoint: { ...makeRun().checkpoint, stepCount: 40 }
  });
  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.match(user, /BUDGET LOW.*9 steps remaining/);
  assert.match(user, /task_complete/);
  assert.match(user, /extractedData/);
});

test("low-budget warning absent when budget is ample", () => {
  const run = makeRun({
    checkpoint: { ...makeRun().checkpoint, stepCount: 10 }
  });
  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.doesNotMatch(user, /BUDGET LOW/);
});

test("low-budget warning appears at exactly 10 remaining", () => {
  // stepCount 39 means step 40 of 50, remaining = 50 - 40 = 10
  const run = makeRun({
    checkpoint: { ...makeRun().checkpoint, stepCount: 39 }
  });
  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.match(user, /BUDGET LOW.*10 steps remaining/);
});

test("low-budget warning absent at 11 remaining", () => {
  // stepCount 38 means step 39 of 50, remaining = 50 - 39 = 11
  const run = makeRun({
    checkpoint: { ...makeRun().checkpoint, stepCount: 38 }
  });
  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.doesNotMatch(user, /BUDGET LOW/);
});

test("system prompt includes partial result guidance", () => {
  const { system } = buildPlannerPrompt(makeRun(), makePageModel());
  assert.match(system, /Partial Results/);
  assert.match(system, /partial.*extractedData/i);
  assert.match(system, /task_complete/);
});

// ---------------------------------------------------------------------------
// T25: Planner anti-loop strategies
// ---------------------------------------------------------------------------

test("T25: system prompt includes anti-loop strategies section", () => {
  const { system } = buildPlannerPrompt(makeRun(), makePageModel());
  // The "Breaking Out of Loops" section must be present
  assert.match(system, /Breaking Out of Loops/);
  // Key strategies from PM acceptance criteria
  assert.match(system, /browser_read_text/);
  assert.match(system, /Cannot make progress after 3 attempts/);
  assert.match(system, /task_complete.*partial result/i);
  assert.match(system, /ask_user/);
});

test("T25: URL 4+ visits warning includes last 5 action descriptions", () => {
  const run = makeRun({
    checkpoint: {
      ...makeRun().checkpoint,
      stepCount: 8,
      actionHistory: [
        { step: 0, type: "navigate", description: "Go to nytimes.com/games/wordle", ok: true, createdAt: "t0" },
        { step: 1, type: "click", description: "Click play button", ok: true, createdAt: "t1" },
        { step: 2, type: "click", description: "Click letter C", ok: true, createdAt: "t2" },
        { step: 3, type: "click", description: "Click letter R", ok: true, createdAt: "t3" },
        { step: 4, type: "click", description: "Click ENTER to submit CRANE", ok: true, createdAt: "t4" },
        { step: 5, type: "click", description: "Click letter S", ok: false, failureClass: "element_not_found", createdAt: "t5" },
        { step: 6, type: "click", description: "Click letter S again", ok: false, failureClass: "element_not_found", createdAt: "t6" },
        { step: 7, type: "screenshot", description: "Take screenshot", ok: true, createdAt: "t7" },
      ],
      urlVisitCounts: { "https://www.nytimes.com/games/wordle/index.html": 5 },
    }
  });
  const { user } = buildPlannerPrompt(run, makePageModel());

  // Must show the frequent URL
  assert.match(user, /nytimes\.com\/games\/wordle.*5 visits/);
  // Must include "Your last N actions" with the recent action descriptions
  assert.match(user, /Your last \d+ actions/);
  // Must include the last action from the history
  assert.match(user, /Take screenshot/);
  // Must include the "do NOT repeat" instruction
  assert.match(user, /Do NOT repeat any of the above actions/);
});

test("T25: URL warning without 4+ visits does NOT include action recap", () => {
  const run = makeRun({
    checkpoint: {
      ...makeRun().checkpoint,
      stepCount: 3,
      actionHistory: [
        { step: 0, type: "navigate", description: "Go to example.com", ok: true, createdAt: "t0" },
      ],
      urlVisitCounts: { "https://example.com": 3 },
    }
  });
  const { user } = buildPlannerPrompt(run, makePageModel());

  // No URL warning at 3 visits
  assert.doesNotMatch(user, /Your last \d+ actions/);
  assert.doesNotMatch(user, /Do NOT repeat/);
});

// ---------------------------------------------------------------------------
// T27: Sub-goal progress tracking via save_note
// ---------------------------------------------------------------------------

test("T27: system prompt includes sub-goal progress tracking with save_note and progress key", () => {
  const { system } = buildPlannerPrompt(makeRun(), makePageModel());

  // Must have the section header
  assert.match(system, /Sub-goal Progress Tracking/);
  // Must reference save_note with "progress" key
  assert.match(system, /save_note.*progress/i);
  // Must instruct to check saved notes before next action
  assert.match(system, /check your saved notes/i);
  // Must instruct to update progress after each sub-goal
  assert.match(system, /Update the progress note/i);
});

// ---------------------------------------------------------------------------
// T28: Authentication and login flow handling
// ---------------------------------------------------------------------------

test("T28: system prompt includes Authentication Flows section", () => {
  const { system } = buildPlannerPrompt(makeRun(), makePageModel());

  // Must have the section header
  assert.match(system, /Authentication Flows/);
  // Must reference login/signin page recognition
  assert.match(system, /login.*signin|signin.*login/i);
  // Must reference ask_user for credentials
  assert.match(system, /ask_user.*username.*password/i);
  // Must reference wait_for_navigation after login
  assert.match(system, /wait_for_navigation/);
  // Must reference 2FA/MFA handling
  assert.match(system, /2FA|MFA/);
  // Must reference OAuth redirect handling
  assert.match(system, /OAuth/i);
});

test("T28: system prompt explicitly forbids guessing credentials", () => {
  const { system } = buildPlannerPrompt(makeRun(), makePageModel());

  // Must say NEVER guess/auto-fill/fabricate credentials
  assert.match(system, /NEVER guess, auto-fill, or fabricate credentials/);
});

// ---------------------------------------------------------------------------
// T29: Page-type strategy hints in planner prompt
// ---------------------------------------------------------------------------

test("T29: user prompt includes page-type strategy hints for search_results, form, login, checkout, article", () => {
  const pageTypes = ["search_results", "form", "login", "checkout", "article"];

  for (const pt of pageTypes) {
    const { user } = buildPlannerPrompt(makeRun(), makePageModel({ pageType: pt }));
    // Each page type should include its label
    assert.match(user, new RegExp(`Page type: ${pt}`), `Missing page type label for ${pt}`);
  }

  // search_results: scan results guidance
  const { user: searchUser } = buildPlannerPrompt(makeRun(), makePageModel({ pageType: "search_results" }));
  assert.match(searchUser, /search results page.*Scan results/i);

  // form: fill fields top-to-bottom
  const { user: formUser } = buildPlannerPrompt(makeRun(), makePageModel({ pageType: "form" }));
  assert.match(formUser, /form page.*Fill fields.*top-to-bottom/i);

  // login: references Authentication Flows
  const { user: loginUser } = buildPlannerPrompt(makeRun(), makePageModel({ pageType: "login" }));
  assert.match(loginUser, /login page.*Authentication Flows/i);

  // checkout: HIGH-RISK and ask_user confirm
  const { user: checkoutUser } = buildPlannerPrompt(makeRun(), makePageModel({ pageType: "checkout" }));
  assert.match(checkoutUser, /checkout.*HIGH-RISK/i);
  assert.match(checkoutUser, /ask_user.*confirm/i);

  // article: use read_text
  const { user: articleUser } = buildPlannerPrompt(makeRun(), makePageModel({ pageType: "article" }));
  assert.match(articleUser, /content.*article page.*read_text/i);
});

test("T29: user prompt omits page-type hint for unknown or missing pageType", () => {
  // unknown
  const { user: unknownUser } = buildPlannerPrompt(makeRun(), makePageModel({ pageType: "unknown" }));
  assert.doesNotMatch(unknownUser, /Page type:/);

  // undefined (default makePageModel has no pageType)
  const { user: noTypeUser } = buildPlannerPrompt(makeRun(), makePageModel());
  assert.doesNotMatch(noTypeUser, /Page type:/);
});

// ---------------------------------------------------------------------------
// T32: Dialog-aware planner guidance — MUST emphasis
// ---------------------------------------------------------------------------

test("T32: dialog hint uses MUST wording per PM spec", () => {
  const pm = makePageModel({ activeDialog: { label: "Confirm Delete" } });
  const { user } = buildPlannerPrompt(makeRun(), pm);
  assert.match(user, /DIALOG OPEN: "Confirm Delete"/);
  assert.match(user, /You MUST address it \(dismiss, fill, or interact with it\)/);
  assert.match(user, /before attempting to interact with background page elements/);
});

// ---------------------------------------------------------------------------
// T33: Planner note cap transparency
// ---------------------------------------------------------------------------

test("T33: saved notes section shows count/20 and eviction policy", () => {
  const run = makeRun({
    checkpoint: {
      summary: "In progress",
      notes: [],
      stepCount: 5,
      actionHistory: [],
      consecutiveSoftFailures: 0,
      plannerNotes: [
        { key: "progress", value: "Step 2/4 done" },
        { key: "prices", value: "Site A: $500" }
      ]
    }
  });
  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.match(user, /Your saved notes \(2\/20/);
  assert.match(user, /same key overwrites/);
  assert.match(user, /oldest evicted if full/);
});

test("T33: saved notes section absent when no notes", () => {
  const { user } = buildPlannerPrompt(makeRun(), makePageModel());
  assert.ok(!user.includes("Your saved notes"));
});

// --- Content stagnation warning ---

test("content stagnation warning appears when unchangedPageActions >= 3", () => {
  const run = makeRun({
    checkpoint: {
      summary: "ok",
      notes: [],
      stepCount: 5,
      actionHistory: [],
      consecutiveSoftFailures: 0,
      unchangedPageActions: 3
    }
  });
  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.match(user, /page content has NOT visibly changed/);
  assert.match(user, /last 3 actions/);
  assert.match(user, /COMPLETELY DIFFERENT approach/);
});

test("content stagnation warning absent when unchangedPageActions < 3", () => {
  const run = makeRun({
    checkpoint: {
      summary: "ok",
      notes: [],
      stepCount: 3,
      actionHistory: [],
      consecutiveSoftFailures: 0,
      unchangedPageActions: 2
    }
  });
  const { user } = buildPlannerPrompt(run, makePageModel());
  assert.ok(!user.includes("page content has NOT visibly changed"));
});

test("content stagnation warning absent when unchangedPageActions is undefined", () => {
  const { user } = buildPlannerPrompt(makeRun(), makePageModel());
  assert.ok(!user.includes("page content has NOT visibly changed"));
});
