import type { BrowserAction, PageModel, PlannerDecision, TaskRun } from "@openbrowse/contracts";

export interface PlannerInput {
  run: TaskRun;
  pageModel: PageModel;
}

export interface PlannerGateway {
  decide(input: PlannerInput): Promise<PlannerDecision<BrowserAction>>;
}

export class StubPlannerGateway implements PlannerGateway {
  async decide(input: PlannerInput): Promise<PlannerDecision<BrowserAction>> {
    const latestNote = input.run.checkpoint.notes.at(-1);

    if (latestNote) {
      return {
        type: "task_complete",
        reasoning: "Phase 1 stub planner completed after receiving one clarification reply.",
        completionSummary: `Phase 1 skeleton captured the reply "${latestNote}" and proved the suspend/resume path.`
      };
    }

    return {
      type: "clarification_request",
      reasoning: "Phase 1 stub planner asks for one clarification so the desktop skeleton can prove suspend/resume.",
      clarificationRequest: {
        id: `clarify_${input.run.id}`,
        runId: input.run.id,
        question: "Phase 1 is running in skeleton mode. Reply with the next step or a URL you would eventually want OpenBrowse to use.",
        contextSummary: "This is a stub planner decision used to verify task creation, suspension, and resumption without a real model provider.",
        options: [],
        createdAt: new Date().toISOString()
      }
    };
  }
}
