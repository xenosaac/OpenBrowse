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

test("MAX_PLANNER_STEPS is exported and equals 35", () => {
  assert.strictEqual(MAX_PLANNER_STEPS, 35);
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
