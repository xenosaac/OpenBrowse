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
    return {
      type: "clarification_request",
      reasoning: "Planner stub asks for clarification until a real planner is wired.",
      clarificationRequest: {
        id: `clarify_${input.run.id}`,
        runId: input.run.id,
        question: "What should the agent do next?",
        contextSummary: input.pageModel.summary,
        options: [],
        createdAt: new Date().toISOString()
      }
    };
  }
}

