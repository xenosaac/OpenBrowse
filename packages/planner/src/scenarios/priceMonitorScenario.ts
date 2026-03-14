import type { BrowserAction, PlannerDecision } from "@openbrowse/contracts";
import type { PlannerInput } from "../PlannerGateway.js";
import type { DemoScenario, DemoScenarioStep } from "../ScriptedPlannerGateway.js";

function makePageModel(url: string, title: string, summary: string, visibleText: string, elements: Array<{ id: string; role: string; label: string; value?: string; isActionable: boolean }>) {
  return {
    id: `page_demo_${Date.now()}`,
    url,
    title,
    summary,
    elements,
    visibleText,
    createdAt: new Date().toISOString()
  };
}

export function createPriceMonitorScenario(): DemoScenario {
  const steps: DemoScenarioStep[] = [
    // Step 1: Ask clarification for product URL and target price
    {
      decision: (input: PlannerInput): PlannerDecision<BrowserAction> => ({
        type: "clarification_request",
        reasoning: "The price monitor task needs a specific product URL and target price to watch. Asking the user for these details.",
        clarificationRequest: {
          id: `clarify_${input.run.id}_product`,
          runId: input.run.id,
          question: "Which product would you like me to monitor? Please provide the Amazon product URL and your target price.",
          contextSummary: "I'll navigate to the product page, extract the current price, and let you know if it's at or below your target.",
          options: [
            { id: "opt_1", label: "Example: AirPods Pro ($199 target)", summary: "https://www.amazon.com/dp/B0D1XD1ZV3 at $199" },
            { id: "opt_2", label: "I'll type a URL and price", summary: "Custom product and target" }
          ],
          createdAt: new Date().toISOString()
        }
      })
    },

    // Step 2 (after clarification): Navigate to the product URL
    {
      decision: (input: PlannerInput): PlannerDecision<BrowserAction> => {
        const answer = input.run.checkpoint.notes.at(-1) ?? "AirPods Pro at $199";
        // Extract URL if present, otherwise use a demo URL
        const urlMatch = answer.match(/https?:\/\/[^\s]+/);
        const url = urlMatch ? urlMatch[0] : "https://www.amazon.com/dp/B0D1XD1ZV3";

        return {
          type: "browser_action",
          reasoning: `User specified: "${answer}". Navigating to the product page.`,
          action: {
            type: "navigate",
            value: url,
            description: `Navigate to product page: ${url}`
          }
        };
      },
      simulatedPageModel: makePageModel(
        "https://www.amazon.com/dp/B0D1XD1ZV3",
        "Apple AirPods Pro (2nd Generation) – Amazon.com",
        "Amazon product page for Apple AirPods Pro showing price, ratings, and purchase options.",
        "Apple AirPods Pro (2nd Generation)\nwith MagSafe Case (USB-C)\n\n★★★★☆ 4.7 out of 5 stars (72,341 ratings)\n\n$189.99\nList Price: $249.00\nYou Save: $59.01 (24%)\n\nFREE Returns\nFREE delivery Tomorrow\nOr fastest delivery Today\n\nColor: White\nConnectivity: Bluetooth 5.3\nNoise Control: Active Noise Cancellation\n\n[Add to Cart]\n[Buy Now]",
        [
          { id: "el_1", role: "heading", label: "Apple AirPods Pro (2nd Generation)", isActionable: false },
          { id: "el_2", role: "text", label: "Price: $189.99", isActionable: false },
          { id: "el_3", role: "text", label: "List Price: $249.00", isActionable: false },
          { id: "el_4", role: "text", label: "You Save: $59.01 (24%)", isActionable: false },
          { id: "el_5", role: "button", label: "Add to Cart", isActionable: true },
          { id: "el_6", role: "button", label: "Buy Now", isActionable: true }
        ]
      )
    },

    // Step 3: Extract the page to capture price data
    {
      decision: {
        type: "browser_action",
        reasoning: "Extracting product page data to capture the current price.",
        action: {
          type: "extract",
          description: "Extract current price from the Amazon product page"
        }
      }
    },

    // Step 4: Complete with price report
    {
      decision: (input: PlannerInput): PlannerDecision<BrowserAction> => {
        const answer = input.run.checkpoint.notes.at(-1) ?? "$199";
        const priceMatch = answer.match(/\$(\d+)/);
        const targetPrice = priceMatch ? parseInt(priceMatch[1], 10) : 199;
        const currentPrice = 189.99;
        const belowTarget = currentPrice <= targetPrice;

        return {
          type: "task_complete",
          reasoning: `Current price ($${currentPrice}) is ${belowTarget ? "at or below" : "above"} the target price ($${targetPrice}).`,
          completionSummary: `**Price Monitor Report**\n\n• **Product:** Apple AirPods Pro (2nd Generation)\n• **Current Price:** $${currentPrice}\n• **List Price:** $249.00\n• **Your Target:** $${targetPrice}\n• **Savings:** $59.01 (24% off)\n\n${belowTarget ? "🟢 **ALERT: The current price is at or below your target!** This is a good time to buy." : "🔴 The current price is above your target. I'll check again on the next scheduled run."}`
        };
      }
    }
  ];

  return {
    id: "price-monitor",
    label: "Price Monitor Demo",
    steps
  };
}
