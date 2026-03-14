import type { TaskIntent } from "@openbrowse/contracts";

export interface TaskPack {
  id: string;
  label: string;
  category: "travel" | "shopping" | "research" | "productivity";
  description: string;
  requiresLivePlanner: true;
  createIntent: () => TaskIntent;
}

const packs: TaskPack[] = [
  {
    id: "flight-search",
    label: "Flight Search",
    category: "travel",
    description: "Search Google Flights for round-trip options, compare prices, and summarize the best deals.",
    requiresLivePlanner: true,
    createIntent: () => ({
      id: `flight_search_${Date.now()}`,
      source: "desktop",
      goal: "Go to Google Flights and search for round-trip flights. Ask me for origin, destination, and dates. Compare the top 5 cheapest options and summarize them with airline, price, and duration.",
      constraints: [
        "use Google Flights at https://www.google.com/travel/flights",
        "ask for trip details before searching",
        "do not book or purchase anything",
        "summarize results clearly"
      ],
      metadata: { taskpack: "flight-search", category: "travel" }
    })
  },
  {
    id: "amazon-price-check",
    label: "Amazon Price Check",
    category: "shopping",
    description: "Navigate to an Amazon product page, extract the current price and availability, and report back.",
    requiresLivePlanner: true,
    createIntent: () => ({
      id: `amazon_price_${Date.now()}`,
      source: "desktop",
      goal: "Go to Amazon.com and look up a product. Ask me for the product name or URL. Extract the current price, availability, seller, and any active deals. Report the findings.",
      constraints: [
        "use https://www.amazon.com",
        "ask for product details first",
        "extract only — do not add to cart or purchase",
        "report price, availability, and seller"
      ],
      metadata: { taskpack: "amazon-price-check", category: "shopping" }
    })
  },
  {
    id: "web-research",
    label: "Web Research",
    category: "research",
    description: "Research a topic across multiple websites, collect key findings, and produce a summary.",
    requiresLivePlanner: true,
    createIntent: () => ({
      id: `web_research_${Date.now()}`,
      source: "desktop",
      goal: "Research a topic on the web. Ask me what topic to research. Visit relevant websites, read content, extract key facts, and produce a concise summary of findings with source URLs.",
      constraints: [
        "ask for the research topic first",
        "visit at least 2-3 relevant sources",
        "extract key facts and quotes",
        "produce a structured summary"
      ],
      metadata: { taskpack: "web-research", category: "research" }
    })
  },
  {
    id: "form-fill-assist",
    label: "Form Fill Assistant",
    category: "productivity",
    description: "Navigate to a web form, read the fields, ask for user input, and fill it out step by step.",
    requiresLivePlanner: true,
    createIntent: () => ({
      id: `form_fill_${Date.now()}`,
      source: "desktop",
      goal: "Help me fill out a web form. Ask me for the URL of the form. Navigate there, read all the fields, ask me for each piece of information needed, and fill them in. Require my approval before submitting.",
      constraints: [
        "ask for the form URL first",
        "read all fields before asking for input",
        "ask for each field value individually if complex",
        "require approval before any submit action",
        "do not enter payment or sensitive credentials without explicit approval"
      ],
      metadata: { taskpack: "form-fill-assist", category: "productivity", approval_mode: "strict" }
    })
  },
  {
    id: "restaurant-lookup",
    label: "Restaurant Lookup",
    category: "research",
    description: "Search for restaurants on Google Maps, compare ratings, and summarize the best options nearby.",
    requiresLivePlanner: true,
    createIntent: () => ({
      id: `restaurant_lookup_${Date.now()}`,
      source: "desktop",
      goal: "Search for restaurants near a location. Ask me for the location and cuisine preference. Go to Google Maps, search for restaurants, and summarize the top 5 options with name, rating, price range, and distance.",
      constraints: [
        "use Google Maps at https://www.google.com/maps",
        "ask for location and cuisine preference",
        "compare at least 5 options",
        "include rating, price range, and distance in summary"
      ],
      metadata: { taskpack: "restaurant-lookup", category: "research" }
    })
  }
];

export function listTaskPacks(): TaskPack[] {
  return packs;
}

export function getTaskPack(id: string): TaskPack | undefined {
  return packs.find((p) => p.id === id);
}
