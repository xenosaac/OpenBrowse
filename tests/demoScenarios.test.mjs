import test from "node:test";
import assert from "node:assert/strict";

import {
  createTravelSearchScenario,
  createAppointmentBookingScenario,
  createPriceMonitorScenario
} from "../packages/planner/dist/scenarios/index.js";

// Shared helper to validate a scenario step's decision structure
function assertValidDecision(decision, stepLabel) {
  const d = typeof decision === "function" ? decision(makePlannerInput()) : decision;
  assert.ok(d.type, `${stepLabel}: decision must have a type`);
  assert.ok(d.reasoning, `${stepLabel}: decision must have reasoning`);
  assert.ok(
    ["browser_action", "task_complete", "task_failed", "clarification_request", "approval_request"].includes(d.type),
    `${stepLabel}: unexpected decision type "${d.type}"`
  );
  if (d.type === "browser_action") {
    assert.ok(d.action, `${stepLabel}: browser_action must have an action`);
    assert.ok(d.action.type, `${stepLabel}: action must have a type`);
    assert.ok(d.action.description, `${stepLabel}: action must have a description`);
  }
  if (d.type === "task_complete") {
    assert.ok(d.completionSummary, `${stepLabel}: task_complete must have completionSummary`);
  }
  if (d.type === "clarification_request") {
    assert.ok(d.clarificationRequest, `${stepLabel}: must have clarificationRequest`);
    assert.ok(d.clarificationRequest.question, `${stepLabel}: clarification must have question`);
  }
  if (d.type === "approval_request") {
    assert.ok(d.approvalRequest, `${stepLabel}: must have approvalRequest`);
    assert.ok(d.action, `${stepLabel}: approval_request must have an action`);
  }
  return d;
}

function makePlannerInput() {
  return {
    run: {
      id: "run_test",
      taskIntentId: "intent_test",
      status: "running",
      goal: "Test",
      source: "desktop",
      constraints: [],
      metadata: {},
      createdAt: "2026-03-16T00:00:00.000Z",
      updatedAt: "2026-03-16T00:00:00.000Z",
      checkpoint: { summary: "", notes: ["Oct 10-24"] }
    },
    pageModel: {
      id: "page_test",
      url: "https://test.local",
      title: "Test",
      summary: "Test",
      elements: [],
      visibleText: "",
      createdAt: "2026-03-16T00:00:00.000Z"
    }
  };
}

test("Travel Search Scenario", async (t) => {
  const scenario = createTravelSearchScenario();

  await t.test("has correct metadata", () => {
    assert.equal(scenario.id, "travel-search");
    assert.equal(scenario.label, "Travel Search Demo");
  });

  await t.test("has 8 steps", () => {
    assert.equal(scenario.steps.length, 8);
  });

  await t.test("step 1 is navigate to Google Flights", () => {
    const d = assertValidDecision(scenario.steps[0].decision, "travel step 1");
    assert.equal(d.type, "browser_action");
    assert.equal(d.action.type, "navigate");
    assert.match(d.action.value, /google\.com\/travel\/flights/);
  });

  await t.test("step 1 has a simulated page model", () => {
    assert.ok(scenario.steps[0].simulatedPageModel);
    assert.ok(scenario.steps[0].simulatedPageModel.elements.length > 0);
  });

  await t.test("steps 2-3 are type actions for departure/destination", () => {
    const d2 = assertValidDecision(scenario.steps[1].decision, "travel step 2");
    assert.equal(d2.action.type, "type");
    assert.match(d2.action.value, /San Francisco/);

    const d3 = assertValidDecision(scenario.steps[2].decision, "travel step 3");
    assert.equal(d3.action.type, "type");
    assert.match(d3.action.value, /Tokyo/);
  });

  await t.test("step 4 is a clarification request for dates", () => {
    const d = assertValidDecision(scenario.steps[3].decision, "travel step 4");
    assert.equal(d.type, "clarification_request");
    assert.match(d.clarificationRequest.question, /dates/i);
    assert.ok(d.clarificationRequest.options.length >= 2);
  });

  await t.test("step 5 is a function that uses clarification answer", () => {
    assert.equal(typeof scenario.steps[4].decision, "function");
    const d = assertValidDecision(scenario.steps[4].decision, "travel step 5");
    assert.equal(d.type, "browser_action");
    assert.equal(d.action.type, "type");
  });

  await t.test("last step is task_complete", () => {
    const d = assertValidDecision(scenario.steps[7].decision, "travel last step");
    assert.equal(d.type, "task_complete");
    assert.match(d.completionSummary, /Japan Airlines/);
  });

  await t.test("all steps have valid decisions", () => {
    for (let i = 0; i < scenario.steps.length; i++) {
      assertValidDecision(scenario.steps[i].decision, `travel step ${i + 1}`);
    }
  });
});

test("Appointment Booking Scenario", async (t) => {
  const scenario = createAppointmentBookingScenario();

  await t.test("has correct metadata", () => {
    assert.equal(scenario.id, "appointment-booking");
    assert.equal(scenario.label, "Appointment Booking Demo");
  });

  await t.test("has 7 steps", () => {
    assert.equal(scenario.steps.length, 7);
  });

  await t.test("step 1 is navigate to ZocDoc", () => {
    const d = assertValidDecision(scenario.steps[0].decision, "booking step 1");
    assert.equal(d.type, "browser_action");
    assert.equal(d.action.type, "navigate");
    assert.match(d.action.value, /zocdoc\.com/);
  });

  await t.test("step 4 is a clarification request for provider", () => {
    const d = assertValidDecision(scenario.steps[3].decision, "booking step 4");
    assert.equal(d.type, "clarification_request");
    assert.match(d.clarificationRequest.question, /dentist|provider/i);
    assert.ok(d.clarificationRequest.options.length >= 3);
  });

  await t.test("step 6 is an approval request (irreversible booking)", () => {
    const d = assertValidDecision(scenario.steps[5].decision, "booking step 6");
    assert.equal(d.type, "approval_request");
    assert.ok(d.approvalRequest.irreversibleActionSummary);
    assert.match(d.approvalRequest.question, /confirm/i);
  });

  await t.test("last step is task_complete with booking confirmation", () => {
    const d = assertValidDecision(scenario.steps[6].decision, "booking last step");
    assert.equal(d.type, "task_complete");
    assert.match(d.completionSummary, /Dr\. Sarah Chen/);
  });

  await t.test("all steps have valid decisions", () => {
    for (let i = 0; i < scenario.steps.length; i++) {
      assertValidDecision(scenario.steps[i].decision, `booking step ${i + 1}`);
    }
  });
});

test("Price Monitor Scenario", async (t) => {
  const scenario = createPriceMonitorScenario();

  await t.test("has correct metadata", () => {
    assert.equal(scenario.id, "price-monitor");
    assert.equal(scenario.label, "Price Monitor Demo");
  });

  await t.test("has 4 steps", () => {
    assert.equal(scenario.steps.length, 4);
  });

  await t.test("step 1 is a clarification request for product URL", () => {
    const d = assertValidDecision(scenario.steps[0].decision, "monitor step 1");
    assert.equal(d.type, "clarification_request");
    assert.match(d.clarificationRequest.question, /product|URL/i);
  });

  await t.test("step 2 is a function-based navigate using clarification answer", () => {
    assert.equal(typeof scenario.steps[1].decision, "function");
    const d = assertValidDecision(scenario.steps[1].decision, "monitor step 2");
    assert.equal(d.type, "browser_action");
    assert.equal(d.action.type, "navigate");
  });

  await t.test("step 2 extracts URL from user answer", () => {
    const input = makePlannerInput();
    input.run.checkpoint.notes = ["https://www.amazon.com/dp/CUSTOM123 at $150"];
    const d = scenario.steps[1].decision(input);
    assert.match(d.action.value, /amazon\.com\/dp\/CUSTOM123/);
  });

  await t.test("step 2 uses fallback URL when no URL in answer", () => {
    const input = makePlannerInput();
    input.run.checkpoint.notes = ["AirPods Pro at $199"];
    const d = scenario.steps[1].decision(input);
    assert.match(d.action.value, /amazon\.com\/dp\/B0D1XD1ZV3/);
  });

  await t.test("step 3 is extract action", () => {
    const d = assertValidDecision(scenario.steps[2].decision, "monitor step 3");
    assert.equal(d.type, "browser_action");
    assert.equal(d.action.type, "extract");
  });

  await t.test("step 4 is task_complete with price comparison", () => {
    const d = assertValidDecision(scenario.steps[3].decision, "monitor step 4");
    assert.equal(d.type, "task_complete");
    assert.match(d.completionSummary, /Price Monitor Report/);
    assert.match(d.completionSummary, /\$189\.99/);
  });

  await t.test("all steps have valid decisions", () => {
    for (let i = 0; i < scenario.steps.length; i++) {
      assertValidDecision(scenario.steps[i].decision, `monitor step ${i + 1}`);
    }
  });
});

test("All scenarios have unique IDs", () => {
  const scenarios = [
    createTravelSearchScenario(),
    createAppointmentBookingScenario(),
    createPriceMonitorScenario()
  ];
  const ids = scenarios.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "Scenario IDs must be unique");
});

test("All scenarios have non-empty labels", () => {
  const scenarios = [
    createTravelSearchScenario(),
    createAppointmentBookingScenario(),
    createPriceMonitorScenario()
  ];
  for (const s of scenarios) {
    assert.ok(s.label.trim().length > 0, `Scenario "${s.id}" must have a non-empty label`);
  }
});
