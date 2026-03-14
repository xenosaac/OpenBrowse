import type { TaskIntent } from "@openbrowse/contracts";
import { ScriptedPlannerGateway, createPriceMonitorScenario } from "@openbrowse/planner";
import type { RuntimeServices } from "@openbrowse/runtime-core";
import type { DemoDescriptor, DemoExecutionContext } from "./DemoRegistry.js";

export const PRICE_MONITOR_DEMO: DemoDescriptor = {
  id: "price-monitor",
  label: "Price Monitor",
  category: "monitor",
  description: "Monitor a product price on Amazon. Exercises the scheduler path with periodic re-checks.",
  supportsWatch: true
};

export function createPriceMonitorIntent(): TaskIntent {
  return {
    id: `price_monitor_${Date.now()}`,
    source: "desktop",
    goal: "Monitor the price of a specific product on Amazon. Navigate to the product page, extract the current price, and report it. If the price has dropped below the user's target, notify them.",
    constraints: [
      "managed browser profile",
      "extract only - do not add to cart or purchase",
      "ask for product URL and target price on first run"
    ],
    metadata: { demo: "price-monitor", category: "monitor" }
  };
}

function buildPriceMonitorPageSequence() {
  const scenario = createPriceMonitorScenario();
  const pageModels = scenario.steps.filter((step) => step.simulatedPageModel).map((step) => step.simulatedPageModel!);
  const [productPage] = pageModels;
  return [undefined, undefined, productPage, productPage];
}

export function createPriceMonitorDemoPlanner(
  context: DemoExecutionContext = { plannerDecisionCount: 0, pageObservationCount: 0 }
) {
  const scenario = createPriceMonitorScenario();
  const planner = new ScriptedPlannerGateway(scenario, {
    initialStepIndex: context.plannerDecisionCount
  });
  const pageSequence = buildPriceMonitorPageSequence();
  let observationIndex = context.pageObservationCount;

  return {
    planner,
    pageModelOverride: () => {
      const pageModel = pageSequence[observationIndex];
      observationIndex += 1;
      return pageModel;
    }
  };
}

const DEFAULT_INTERVAL_MINUTES = 30;

export async function registerPriceMonitorWatch(
  services: RuntimeServices,
  intervalMinutes: number = DEFAULT_INTERVAL_MINUTES
): Promise<string> {
  const intent = createPriceMonitorIntent();
  return services.scheduler.registerWatch(intent, intervalMinutes);
}
