import type { TaskIntent } from "@openbrowse/contracts";
import { ScriptedPlannerGateway, createTravelSearchScenario } from "@openbrowse/planner";
import type { DemoDescriptor, DemoExecutionContext } from "./DemoRegistry.js";

export const TRAVEL_SEARCH_DEMO: DemoDescriptor = {
  id: "travel-search",
  label: "Travel Search",
  category: "research",
  description: "Search for round-trip flights and summarize the best options. Exercises clarification for date preferences.",
  supportsWatch: false
};

export function createTravelSearchIntent(): TaskIntent {
  return {
    id: `travel_search_${Date.now()}`,
    source: "desktop",
    goal: "Search for round-trip flights from San Francisco to Tokyo in October 2026. Find the best options under $1500 and summarize the top 3 results. Ask the user for date preferences if needed.",
    constraints: ["macOS only", "managed browser profile", "ask for clarification on travel dates", "do not book or purchase anything"],
    metadata: { demo: "travel-search", category: "research" }
  };
}

function buildTravelSearchPageSequence() {
  const scenario = createTravelSearchScenario();
  const pageModels = scenario.steps.filter((step) => step.simulatedPageModel).map((step) => step.simulatedPageModel!);
  const [searchPage, resultsPage] = pageModels;
  return [searchPage, searchPage, searchPage, searchPage, searchPage, searchPage, resultsPage, resultsPage].filter(Boolean);
}

export function createTravelSearchDemoPlanner(
  context: DemoExecutionContext = { plannerDecisionCount: 0, pageObservationCount: 0 }
) {
  const scenario = createTravelSearchScenario();
  const planner = new ScriptedPlannerGateway(scenario, {
    initialStepIndex: context.plannerDecisionCount
  });
  const pageSequence = buildTravelSearchPageSequence();
  let observationIndex = context.pageObservationCount;

  return {
    planner,
    pageModelOverride: () => {
      if (observationIndex < pageSequence.length) {
        return pageSequence[observationIndex++];
      }
      return undefined;
    }
  };
}
