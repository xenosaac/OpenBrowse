import test from "node:test";
import assert from "node:assert/strict";

import {
  ScriptedPlannerGateway,
  createTravelSearchScenario
} from "../packages/planner/dist/index.js";

function makePlannerInput() {
  return {
    run: {
      id: "run_travel_demo",
      taskIntentId: "travel_demo",
      status: "running",
      goal: "Search flights to Tokyo",
      source: "desktop",
      constraints: [],
      metadata: {
        demo: "travel-search"
      },
      createdAt: "2026-03-12T08:00:00.000Z",
      updatedAt: "2026-03-12T08:00:00.000Z",
      checkpoint: {
        summary: "Waiting for next step.",
        notes: ["Oct 10-24"]
      }
    },
    pageModel: {
      id: "page_demo",
      url: "https://demo.local",
      title: "Demo",
      summary: "Demo page model",
      elements: [],
      visibleText: "",
      createdAt: "2026-03-12T08:00:00.000Z"
    }
  };
}

test("scripted planner can resume from a stored step index", async () => {
  const gateway = new ScriptedPlannerGateway(createTravelSearchScenario(), {
    initialStepIndex: 4
  });

  const decision = await gateway.decide(makePlannerInput());

  assert.equal(decision.type, "browser_action");
  assert.equal(decision.action?.targetId, "el_3");
  assert.match(decision.reasoning, /User selected dates/i);
});

test("scripted planner completes when resumed beyond the scripted steps", async () => {
  const gateway = new ScriptedPlannerGateway(createTravelSearchScenario(), {
    initialStepIndex: 20
  });

  const decision = await gateway.decide(makePlannerInput());

  assert.equal(decision.type, "task_complete");
  assert.match(decision.completionSummary ?? "", /completed successfully/i);
});
