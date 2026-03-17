import test from "node:test";
import assert from "node:assert/strict";

import { buildPlannerPrompt, MAX_PLANNER_STEPS } from "../packages/planner/dist/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRun(overrides = {}) {
  return {
    id: "run_snap_1",
    taskIntentId: "intent_snap_1",
    status: "running",
    goal: "Search for the best espresso machine",
    source: "desktop",
    constraints: [],
    metadata: {},
    createdAt: "2026-03-17T00:00:00Z",
    updatedAt: "2026-03-17T00:00:00Z",
    checkpoint: {
      summary: "Run started.",
      notes: [],
      stepCount: 0,
      actionHistory: [],
      consecutiveSoftFailures: 0,
    },
    ...overrides,
  };
}

function makePageModel(overrides = {}) {
  return {
    id: "pm_snap_1",
    url: "https://www.google.com",
    title: "Google",
    summary: "Search engine home page",
    elements: [],
    visibleText: "Search the web",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Budget ceilings
// ---------------------------------------------------------------------------

/** The system prompt is the stable part — must stay under this ceiling. */
const SYSTEM_PROMPT_CEILING = 10_000;

/**
 * Per-scenario combined (system + user) ceilings.
 * Simple scenario has almost no variable content.
 * Complex scenarios include action history, warnings, recovery context — expected growth.
 */
const SIMPLE_COMBINED_CEILING = 10_000;
const COMPLEX_COMBINED_CEILING = 12_000;

// ===========================================================================
// Scenario 1: Simple search — fresh run, minimal page, no warnings
// ===========================================================================

test("T63 snapshot: simple search — system prompt under ceiling", () => {
  const { system } = buildPlannerPrompt(makeRun(), makePageModel());
  assert.ok(
    system.length < SYSTEM_PROMPT_CEILING,
    `System prompt is ${system.length} chars, ceiling is ${SYSTEM_PROMPT_CEILING}`,
  );
});

test("T63 snapshot: simple search — combined prompt under ceiling", () => {
  const { system, user } = buildPlannerPrompt(makeRun(), makePageModel());
  const combined = system.length + user.length;
  assert.ok(
    combined < SIMPLE_COMBINED_CEILING,
    `Combined prompt is ${combined} chars, ceiling is ${SIMPLE_COMBINED_CEILING}`,
  );
});

test("T63 snapshot: simple search — contains required system sections", () => {
  const { system } = buildPlannerPrompt(makeRun(), makePageModel());

  // Core sections that must always be present
  assert.match(system, /Visual Context/);
  assert.match(system, /MANDATORY: Think Before You Act/);
  assert.match(system, /Task Decomposition/);
  assert.match(system, /Sub-goal Progress Tracking/);
  assert.match(system, /Anti-Loop Rules/);
  assert.match(system, /Browser Guidelines/);
  assert.match(system, /Authentication Flows/);
  assert.match(system, /Error Recovery/);
  assert.match(system, /Breaking Out of Loops/);
  assert.match(system, /Partial Results/);
  assert.match(system, /Step budget/);
});

test("T63 snapshot: simple search — user prompt contains goal and page context", () => {
  const { user } = buildPlannerPrompt(makeRun(), makePageModel());

  assert.match(user, /Goal: Search for the best espresso machine/);
  assert.match(user, /Steps taken: 0\/50/);
  assert.match(user, /URL: https:\/\/www\.google\.com/);
  assert.match(user, /Title: Google/);
  // No warnings should be present on a fresh run
  assert.ok(!user.includes("WARNING"), "Fresh run should have no warnings");
  assert.ok(!user.includes("BUDGET LOW"), "Fresh run should have no budget warning");
  assert.ok(!user.includes("RECOVERY MODE"), "Fresh run should have no recovery context");
});

// ===========================================================================
// Scenario 2: Multi-step with anti-loop warnings
// ===========================================================================

const multiStepRun = makeRun({
  goal: "Compare laptop prices across 3 stores",
  constraints: ["under $1000"],
  checkpoint: {
    summary: "In progress",
    notes: ["User said: yes, include refurbished options"],
    stepCount: 15,
    actionHistory: [
      { step: 10, type: "navigate", description: "Navigate to store A", ok: true, createdAt: "2026-03-17T00:10:00Z", targetUrl: "https://store-a.example.com" },
      { step: 11, type: "click", description: "Click laptop category", ok: true, createdAt: "2026-03-17T00:11:00Z", targetId: "el_5" },
      { step: 12, type: "navigate", description: "Navigate to store B", ok: false, failureClass: "navigation_timeout", createdAt: "2026-03-17T00:12:00Z", targetUrl: "https://store-b.example.com" },
      { step: 13, type: "navigate", description: "Retry store B", ok: true, createdAt: "2026-03-17T00:13:00Z", targetUrl: "https://store-b.example.com" },
      { step: 14, type: "click", description: "Click search results", ok: false, failureClass: "element_not_found", createdAt: "2026-03-17T00:14:00Z", targetId: "el_22" },
    ],
    consecutiveSoftFailures: 1,
    totalSoftFailures: 3,
    urlVisitCounts: { "https://store-a.example.com": 5, "https://store-b.example.com": 2 },
    plannerNotes: [
      { key: "progress", value: "Step 1/3: Found laptops on Store A ($899, $950)" },
      { key: "store_a_prices", value: "ThinkPad X1: $899, Dell XPS: $950" },
    ],
  },
});

const multiStepPage = makePageModel({
  url: "https://store-b.example.com/laptops",
  title: "Store B - Laptops",
  visibleText: "Browse our laptop selection",
  pageType: "search_results",
});

test("T63 snapshot: multi-step — system prompt under ceiling", () => {
  const { system } = buildPlannerPrompt(multiStepRun, multiStepPage);
  assert.ok(
    system.length < SYSTEM_PROMPT_CEILING,
    `System prompt is ${system.length} chars, ceiling is ${SYSTEM_PROMPT_CEILING}`,
  );
});

test("T63 snapshot: multi-step — combined prompt under ceiling", () => {
  const { system, user } = buildPlannerPrompt(multiStepRun, multiStepPage);
  const combined = system.length + user.length;
  assert.ok(
    combined < COMPLEX_COMBINED_CEILING,
    `Combined prompt is ${combined} chars, ceiling is ${COMPLEX_COMBINED_CEILING}`,
  );
});

test("T63 snapshot: multi-step — contains expected warnings and sections", () => {
  const { user } = buildPlannerPrompt(multiStepRun, multiStepPage);

  // URL visit warning should fire (store-a has 5 visits)
  assert.match(user, /WARNING.*visited these URLs too many times/);
  assert.match(user, /store-a\.example\.com.*5 visits/);

  // Soft failure warning (consecutiveSoftFailures = 1)
  assert.match(user, /WARNING.*last 1 action\(s\) failed/);

  // Action history should be present
  assert.match(user, /Actions already taken/);
  assert.match(user, /Step 10.*Navigate to store A.*OK/);
  assert.match(user, /Step 12.*Navigate to store B.*FAILED/);

  // Failed URLs section
  assert.match(user, /FAILED URLs.*do NOT revisit/);

  // Planner notes
  assert.match(user, /Your saved notes/);
  assert.match(user, /store_a_prices/);

  // User answers
  assert.match(user, /User answers so far/);

  // Page type hint for search_results
  assert.match(user, /Page type: search_results/);
});

// ===========================================================================
// Scenario 3: Low-budget with recovery context
// ===========================================================================

const lowBudgetRun = makeRun({
  goal: "Fill out the registration form",
  checkpoint: {
    summary: "Recovered from interruption",
    notes: [],
    stepCount: 46,
    actionHistory: [
      { step: 45, type: "type", description: "Type email address", ok: true, createdAt: "2026-03-17T00:45:00Z" },
    ],
    consecutiveSoftFailures: 0,
    plannerNotes: [
      { key: "progress", value: "Step 3/4: Main fields filled, need to submit" },
    ],
    recoveryContext: {
      preInterruptionPageTitle: "Registration Form",
      preInterruptionPageSummary: "A form with 5 fields, 3 were filled",
      preInterruptionFormValues: { el_1: "John Doe", el_2: "john@example.com", el_3: "password123" },
      preInterruptionScrollY: 500,
    },
  },
});

const lowBudgetPage = makePageModel({
  url: "https://app.example.com/register",
  title: "Register",
  visibleText: "Create your account",
  pageType: "form",
  elements: [
    { id: "el_1", role: "textbox", label: "Full Name", isActionable: true, boundingVisible: true, value: "John Doe" },
    { id: "el_2", role: "textbox", label: "Email", isActionable: true, boundingVisible: true, inputType: "email", value: "john@example.com" },
    { id: "el_3", role: "textbox", label: "Password", isActionable: true, boundingVisible: true, inputType: "password" },
    { id: "el_4", role: "button", label: "Create Account", isActionable: true, boundingVisible: true },
  ],
  forms: [{
    method: "POST",
    action: "/register",
    fieldCount: 3,
    fields: [
      { ref: "el_1", label: "Full Name", type: "text", required: true, currentValue: "John Doe" },
      { ref: "el_2", label: "Email", type: "email", required: true, currentValue: "john@example.com" },
      { ref: "el_3", label: "Password", type: "password", required: true },
    ],
    submitRef: "el_4",
  }],
});

test("T63 snapshot: low-budget — system prompt under ceiling", () => {
  const { system } = buildPlannerPrompt(lowBudgetRun, lowBudgetPage);
  assert.ok(
    system.length < SYSTEM_PROMPT_CEILING,
    `System prompt is ${system.length} chars, ceiling is ${SYSTEM_PROMPT_CEILING}`,
  );
});

test("T63 snapshot: low-budget — combined prompt under ceiling", () => {
  const { system, user } = buildPlannerPrompt(lowBudgetRun, lowBudgetPage);
  const combined = system.length + user.length;
  assert.ok(
    combined < COMPLEX_COMBINED_CEILING,
    `Combined prompt is ${combined} chars, ceiling is ${COMPLEX_COMBINED_CEILING}`,
  );
});

test("T63 snapshot: low-budget — contains budget warning and recovery context", () => {
  const { system, user } = buildPlannerPrompt(lowBudgetRun, lowBudgetPage);

  // Low budget warning in user prompt
  assert.match(user, /BUDGET LOW/);
  const remaining = MAX_PLANNER_STEPS - 47; // step 46+1 = 47th step
  assert.match(user, new RegExp(`${remaining} step`));

  // Recovery context
  assert.match(user, /RECOVERY MODE/);
  assert.match(user, /Registration Form/);
  assert.match(user, /el_1="John Doe"/);
  assert.match(user, /el_2="john@example.com"/);
  assert.match(user, /scrolled to Y=500px/);

  // Step budget in system prompt
  assert.match(system, /step 47 of 50/);

  // Form section
  assert.match(user, /Forms on page/);
  assert.match(user, /POST \/register/);
  assert.match(user, /Full Name.*REQUIRED/);

  // Page type hint for form
  assert.match(user, /Page type: form/);

  // Self-assessment should trigger (stepCount >= 25)
  assert.match(user, /PROGRESS CHECK/);
});

// ===========================================================================
// Cross-scenario: system prompt stability
// ===========================================================================

test("T63 snapshot: system prompt is identical across scenarios (except step count)", () => {
  const s1 = buildPlannerPrompt(makeRun(), makePageModel()).system;
  const s2 = buildPlannerPrompt(multiStepRun, multiStepPage).system;
  const s3 = buildPlannerPrompt(lowBudgetRun, lowBudgetPage).system;

  // Remove the step count line to compare the stable portion
  const normalize = (s) => s.replace(/Step budget: You are on step \d+ of \d+\. Plan efficiently\./, "STEP_LINE");
  assert.equal(normalize(s1), normalize(s2), "System prompt should be stable across simple and multi-step");
  assert.equal(normalize(s2), normalize(s3), "System prompt should be stable across multi-step and low-budget");
});
