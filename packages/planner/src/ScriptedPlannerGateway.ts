import type { BrowserAction, PageModel, PlannerDecision } from "@openbrowse/contracts";
import type { PlannerGateway, PlannerInput } from "./PlannerGateway.js";

/**
 * Optional callback that can generate simulated page models
 * keyed by the URL the stub browser is currently on.
 */
export type PageModelProvider = (url: string, stepIndex: number) => PageModel | undefined;

export interface DemoScenarioStep {
  /**
   * The planner decision to return for this step.
   * If this is a function, it receives the current PlannerInput so scenarios
   * can adapt decisions based on prior clarification answers.
   */
  decision: PlannerDecision<BrowserAction> | ((input: PlannerInput) => PlannerDecision<BrowserAction>);

  /**
   * Optional simulated page model to inject into the stub browser kernel
   * before the planner loop captures the page. Only used when the demo
   * is running against a StubBrowserKernel.
   */
  simulatedPageModel?: PageModel;
}

export interface DemoScenario {
  id: string;
  label: string;
  steps: DemoScenarioStep[];
  pageModelProvider?: PageModelProvider;
}

export interface ScriptedPlannerGatewayOptions {
  initialStepIndex?: number;
}

/**
 * A planner gateway that follows a pre-defined sequence of decisions.
 *
 * Each call to `decide()` advances through the scenario script.
 * When the script includes a `clarification_request`, the runtime will
 * suspend. On resume, the next `decide()` call receives the clarification
 * answer in `run.checkpoint.notes` so post-clarification steps can adapt.
 *
 * If the script runs out of steps, it returns `task_complete`.
 */
export class ScriptedPlannerGateway implements PlannerGateway {
  private stepIndex = 0;
  private readonly scenario: DemoScenario;

  constructor(scenario: DemoScenario, options: ScriptedPlannerGatewayOptions = {}) {
    this.scenario = scenario;
    this.stepIndex = options.initialStepIndex ?? 0;
  }

  async decide(input: PlannerInput): Promise<PlannerDecision<BrowserAction>> {
    if (this.stepIndex >= this.scenario.steps.length) {
      return {
        type: "task_complete",
        reasoning: `Demo scenario "${this.scenario.label}" completed all scripted steps.`,
        completionSummary: `Demo "${this.scenario.label}" completed successfully after ${this.stepIndex} steps.`
      };
    }

    const step = this.scenario.steps[this.stepIndex];
    this.stepIndex++;

    const decision = typeof step.decision === "function"
      ? step.decision(input)
      : step.decision;

    return decision;
  }

  /** Reset the gateway so it can be reused for another run. */
  reset(): void {
    this.stepIndex = 0;
  }

  /** Returns the current step index for diagnostics. */
  getCurrentStep(): number {
    return this.stepIndex;
  }
}
