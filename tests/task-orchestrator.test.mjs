import test from "node:test";
import assert from "node:assert/strict";

import { TaskOrchestrator, DefaultClarificationPolicy } from "../packages/orchestrator/dist/index.js";

test("task orchestrator preserves clarification suspend and resume semantics", () => {
  const orchestrator = new TaskOrchestrator({
    clarificationPolicy: new DefaultClarificationPolicy()
  });

  const run = orchestrator.startRun(
    orchestrator.createRun({
      id: "intent_1",
      source: "desktop",
      goal: "Book a flight",
      constraints: ["ask for preferred date"],
      metadata: {}
    })
  );

  const suspended = orchestrator.applyPlannerDecision(run, {
    type: "clarification_request",
    reasoning: "Need the preferred departure date.",
    clarificationRequest: {
      id: "clarify_1",
      runId: run.id,
      question: "Which departure date do you prefer?",
      contextSummary: "Several options are available.",
      options: [],
      createdAt: "2026-03-11T10:00:00.000Z"
    }
  });

  assert.equal(suspended.status, "suspended_for_clarification");
  assert.equal(suspended.checkpoint.pendingClarificationId, "clarify_1");
  assert.equal(suspended.suspension?.type, "clarification");

  const resumed = orchestrator.resumeFromClarification(suspended, {
    requestId: "clarify_1",
    runId: suspended.id,
    answer: "Leave on October 12.",
    respondedAt: "2026-03-11T10:01:00.000Z"
  });

  assert.equal(resumed.status, "running");
  assert.equal(resumed.checkpoint.pendingClarificationId, undefined);
  assert.equal(resumed.checkpoint.notes.at(-1), "Leave on October 12.");
  assert.equal(resumed.suspension, undefined);
});
