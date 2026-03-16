import test from "node:test";
import assert from "node:assert/strict";

import { ScriptedPlannerGateway } from "../packages/planner/dist/ScriptedPlannerGateway.js";

function makePlannerInput(overrides = {}) {
  return {
    run: {
      id: "run_test",
      taskIntentId: "intent_test",
      status: "running",
      goal: "Test goal",
      source: "desktop",
      constraints: [],
      metadata: {},
      createdAt: "2026-03-16T00:00:00.000Z",
      updatedAt: "2026-03-16T00:00:00.000Z",
      checkpoint: {
        summary: "",
        notes: []
      },
      ...overrides
    },
    pageModel: {
      id: "page_test",
      url: "https://test.local",
      title: "Test Page",
      summary: "A test page",
      elements: [],
      visibleText: "",
      createdAt: "2026-03-16T00:00:00.000Z"
    }
  };
}

function makeScenario(steps) {
  return {
    id: "test-scenario",
    label: "Test Scenario",
    steps
  };
}

test("ScriptedPlannerGateway", async (t) => {
  await t.test("getCurrentStep starts at 0", () => {
    const gw = new ScriptedPlannerGateway(makeScenario([]));
    assert.equal(gw.getCurrentStep(), 0);
  });

  await t.test("getCurrentStep starts at initialStepIndex", () => {
    const gw = new ScriptedPlannerGateway(makeScenario([]), { initialStepIndex: 5 });
    assert.equal(gw.getCurrentStep(), 5);
  });

  await t.test("decide advances step index", async () => {
    const steps = [
      { decision: { type: "browser_action", reasoning: "Step 1", action: { type: "navigate", value: "https://a.com", description: "Go to A" } } },
      { decision: { type: "browser_action", reasoning: "Step 2", action: { type: "click", targetId: "el_1", description: "Click" } } }
    ];
    const gw = new ScriptedPlannerGateway(makeScenario(steps));
    assert.equal(gw.getCurrentStep(), 0);

    await gw.decide(makePlannerInput());
    assert.equal(gw.getCurrentStep(), 1);

    await gw.decide(makePlannerInput());
    assert.equal(gw.getCurrentStep(), 2);
  });

  await t.test("decide returns correct decision for each step", async () => {
    const steps = [
      { decision: { type: "browser_action", reasoning: "Nav", action: { type: "navigate", value: "https://a.com", description: "Nav" } } },
      { decision: { type: "task_complete", reasoning: "Done", completionSummary: "All done" } }
    ];
    const gw = new ScriptedPlannerGateway(makeScenario(steps));

    const d1 = await gw.decide(makePlannerInput());
    assert.equal(d1.type, "browser_action");
    assert.equal(d1.action?.type, "navigate");

    const d2 = await gw.decide(makePlannerInput());
    assert.equal(d2.type, "task_complete");
    assert.equal(d2.completionSummary, "All done");
  });

  await t.test("decide auto-completes when steps exhausted", async () => {
    const steps = [
      { decision: { type: "browser_action", reasoning: "Only step", action: { type: "click", targetId: "el_1", description: "Click" } } }
    ];
    const gw = new ScriptedPlannerGateway(makeScenario(steps));

    await gw.decide(makePlannerInput()); // consume only step
    const d = await gw.decide(makePlannerInput());

    assert.equal(d.type, "task_complete");
    assert.match(d.reasoning, /completed all scripted steps/);
    assert.match(d.completionSummary, /completed successfully after 1 steps/);
  });

  await t.test("auto-complete includes scenario label", async () => {
    const scenario = { id: "custom", label: "My Custom Demo", steps: [] };
    const gw = new ScriptedPlannerGateway(scenario);

    const d = await gw.decide(makePlannerInput());
    assert.match(d.reasoning, /My Custom Demo/);
    assert.match(d.completionSummary, /My Custom Demo/);
  });

  await t.test("decide with function-based decision receives PlannerInput", async () => {
    let capturedInput = null;
    const steps = [
      {
        decision: (input) => {
          capturedInput = input;
          return { type: "task_complete", reasoning: "done", completionSummary: "done" };
        }
      }
    ];
    const gw = new ScriptedPlannerGateway(makeScenario(steps));
    const input = makePlannerInput({ id: "run_captured" });

    await gw.decide(input);

    assert.notEqual(capturedInput, null);
    assert.equal(capturedInput.run.id, "run_captured");
    assert.equal(capturedInput.pageModel.url, "https://test.local");
  });

  await t.test("function decision can read checkpoint notes", async () => {
    const steps = [
      {
        decision: (input) => ({
          type: "browser_action",
          reasoning: `Notes: ${input.run.checkpoint.notes.join(",")}`,
          action: { type: "type", targetId: "el_1", value: input.run.checkpoint.notes[0] ?? "", description: "Type answer" }
        })
      }
    ];
    const gw = new ScriptedPlannerGateway(makeScenario(steps));
    const input = makePlannerInput({ checkpoint: { summary: "", notes: ["Oct 10-24"] } });

    const d = await gw.decide(input);
    assert.match(d.reasoning, /Oct 10-24/);
    assert.equal(d.action?.value, "Oct 10-24");
  });

  await t.test("reset sets step index back to 0", async () => {
    const steps = [
      { decision: { type: "browser_action", reasoning: "S1", action: { type: "click", targetId: "el_1", description: "C" } } },
      { decision: { type: "task_complete", reasoning: "Done", completionSummary: "Done" } }
    ];
    const gw = new ScriptedPlannerGateway(makeScenario(steps));

    await gw.decide(makePlannerInput());
    await gw.decide(makePlannerInput());
    assert.equal(gw.getCurrentStep(), 2);

    gw.reset();
    assert.equal(gw.getCurrentStep(), 0);
  });

  await t.test("reset allows replaying from the beginning", async () => {
    const steps = [
      { decision: { type: "browser_action", reasoning: "First", action: { type: "navigate", value: "https://a.com", description: "Nav" } } }
    ];
    const gw = new ScriptedPlannerGateway(makeScenario(steps));

    const d1 = await gw.decide(makePlannerInput());
    assert.equal(d1.type, "browser_action");

    gw.reset();

    const d2 = await gw.decide(makePlannerInput());
    assert.equal(d2.type, "browser_action");
    assert.equal(d2.reasoning, "First");
  });

  await t.test("initialStepIndex skips earlier steps", async () => {
    const steps = [
      { decision: { type: "browser_action", reasoning: "Step 0", action: { type: "navigate", value: "https://a.com", description: "S0" } } },
      { decision: { type: "browser_action", reasoning: "Step 1", action: { type: "click", targetId: "el_1", description: "S1" } } },
      { decision: { type: "task_complete", reasoning: "Step 2", completionSummary: "Done" } }
    ];
    const gw = new ScriptedPlannerGateway(makeScenario(steps), { initialStepIndex: 2 });

    const d = await gw.decide(makePlannerInput());
    assert.equal(d.type, "task_complete");
    assert.equal(d.reasoning, "Step 2");
  });

  await t.test("empty scenario auto-completes immediately", async () => {
    const gw = new ScriptedPlannerGateway(makeScenario([]));
    const d = await gw.decide(makePlannerInput());
    assert.equal(d.type, "task_complete");
    assert.match(d.completionSummary, /after 0 steps/);
  });

  await t.test("mixed static and function decisions", async () => {
    const steps = [
      { decision: { type: "browser_action", reasoning: "Static", action: { type: "navigate", value: "https://a.com", description: "Nav" } } },
      { decision: () => ({ type: "clarification_request", reasoning: "Dynamic", clarificationRequest: { id: "c1", runId: "r1", question: "Q?", contextSummary: "", options: [], createdAt: new Date().toISOString() } }) },
      { decision: { type: "task_complete", reasoning: "Final", completionSummary: "Done" } }
    ];
    const gw = new ScriptedPlannerGateway(makeScenario(steps));

    const d1 = await gw.decide(makePlannerInput());
    assert.equal(d1.type, "browser_action");

    const d2 = await gw.decide(makePlannerInput());
    assert.equal(d2.type, "clarification_request");

    const d3 = await gw.decide(makePlannerInput());
    assert.equal(d3.type, "task_complete");
  });
});
