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

export function createTravelSearchScenario(): DemoScenario {
  const steps: DemoScenarioStep[] = [
    // Step 1: Navigate to Google Flights
    {
      decision: {
        type: "browser_action",
        reasoning: "Navigating to Google Flights to search for round-trip flights from San Francisco to Tokyo.",
        action: {
          type: "navigate",
          value: "https://www.google.com/travel/flights",
          description: "Navigate to Google Flights"
        }
      },
      simulatedPageModel: makePageModel(
        "https://www.google.com/travel/flights",
        "Google Flights",
        "Flight search engine with departure and destination fields.",
        "Google Flights\nWhere from? Where to?\nDeparture Return\nSearch flights\nExplore destinations",
        [
          { id: "el_1", role: "textbox", label: "Where from?", value: "", isActionable: true },
          { id: "el_2", role: "textbox", label: "Where to?", value: "", isActionable: true },
          { id: "el_3", role: "textbox", label: "Departure", value: "", isActionable: true },
          { id: "el_4", role: "textbox", label: "Return", value: "", isActionable: true },
          { id: "el_5", role: "button", label: "Search", isActionable: true }
        ]
      )
    },

    // Step 2: Type departure city
    {
      decision: {
        type: "browser_action",
        reasoning: "Entering San Francisco as the departure city.",
        action: {
          type: "type",
          targetId: "el_1",
          value: "San Francisco (SFO)",
          description: "Type departure city: San Francisco"
        }
      }
    },

    // Step 3: Type destination city
    {
      decision: {
        type: "browser_action",
        reasoning: "Entering Tokyo as the destination city.",
        action: {
          type: "type",
          targetId: "el_2",
          value: "Tokyo (NRT)",
          description: "Type destination: Tokyo"
        }
      }
    },

    // Step 4: Ask clarification for exact travel dates
    {
      decision: (input: PlannerInput): PlannerDecision<BrowserAction> => ({
        type: "clarification_request",
        reasoning: "The user's goal mentions October 2026 but doesn't specify exact dates. Asking for preferred departure and return dates.",
        clarificationRequest: {
          id: `clarify_${input.run.id}_dates`,
          runId: input.run.id,
          question: "What are your preferred travel dates in October 2026? Please specify departure and return dates.",
          contextSummary: "I've set up a flight search from San Francisco (SFO) to Tokyo (NRT). I need exact dates to search for the best fares under $1,500.",
          options: [
            { id: "opt_1", label: "Oct 1–15", summary: "First half of October" },
            { id: "opt_2", label: "Oct 10–24", summary: "Mid October" },
            { id: "opt_3", label: "Oct 15–31", summary: "Second half of October" }
          ],
          createdAt: new Date().toISOString()
        }
      })
    },

    // Step 5 (after clarification): Type dates and search
    {
      decision: (input: PlannerInput): PlannerDecision<BrowserAction> => {
        const dateAnswer = input.run.checkpoint.notes.at(-1) ?? "Oct 10-24";
        return {
          type: "browser_action",
          reasoning: `User selected dates: "${dateAnswer}". Entering departure date and searching.`,
          action: {
            type: "type",
            targetId: "el_3",
            value: dateAnswer.split("–")[0]?.trim() ?? dateAnswer.split("-")[0]?.trim() ?? "Oct 10",
            description: `Enter departure date based on user preference: ${dateAnswer}`
          }
        };
      }
    },

    // Step 6: Click search button
    {
      decision: {
        type: "browser_action",
        reasoning: "Clicking the search button to find flights.",
        action: {
          type: "click",
          targetId: "el_5",
          description: "Click Search to find flights"
        }
      },
      simulatedPageModel: makePageModel(
        "https://www.google.com/travel/flights/search?q=SFO+to+NRT",
        "Flights from San Francisco to Tokyo – Google Flights",
        "Search results showing round-trip flights from SFO to NRT in October.",
        "Best departing flights\n\n1. Japan Airlines JAL — $1,245 round-trip\n   Departure: Oct 10, 7:30 AM → Arrival: Oct 11, 3:15 PM (nonstop)\n   Return: Oct 24, 5:00 PM → Oct 24, 10:30 AM\n   Duration: 11h 45m / 9h 30m\n\n2. ANA All Nippon Airways — $1,310 round-trip\n   Departure: Oct 10, 11:00 AM → Arrival: Oct 11, 4:45 PM (nonstop)\n   Return: Oct 24, 6:30 PM → Oct 24, 11:15 AM\n   Duration: 11h 45m / 9h 45m\n\n3. United Airlines — $1,425 round-trip\n   Departure: Oct 10, 1:15 PM → Arrival: Oct 11, 5:00 PM (1 stop, LAX)\n   Return: Oct 24, 8:00 PM → Oct 25, 12:30 PM\n   Duration: 14h 45m / 11h 30m\n\nShowing 47 more results\nSort by: Best Price Duration",
        [
          { id: "el_10", role: "link", label: "Japan Airlines $1,245", isActionable: true },
          { id: "el_11", role: "link", label: "ANA $1,310", isActionable: true },
          { id: "el_12", role: "link", label: "United Airlines $1,425", isActionable: true },
          { id: "el_13", role: "button", label: "Sort by: Best", isActionable: true },
          { id: "el_14", role: "button", label: "Show more results", isActionable: true }
        ]
      )
    },

    // Step 7: Extract results
    {
      decision: {
        type: "browser_action",
        reasoning: "Extracting the flight search results to compile a summary for the user.",
        action: {
          type: "extract",
          description: "Extract flight search results from the page"
        }
      }
    },

    // Step 8: Complete with summary
    {
      decision: {
        type: "task_complete",
        reasoning: "Found 3 flight options under $1,500 as requested. Compiling summary.",
        completionSummary: "Found 3 round-trip flights from San Francisco (SFO) to Tokyo (NRT) under $1,500:\n\n1. **Japan Airlines** — $1,245 (nonstop, 11h 45m)\n2. **ANA** — $1,310 (nonstop, 11h 45m)\n3. **United Airlines** — $1,425 (1 stop via LAX, 14h 45m)\n\nThe best value option is Japan Airlines at $1,245 with a nonstop flight."
      }
    }
  ];

  return {
    id: "travel-search",
    label: "Travel Search Demo",
    steps
  };
}
