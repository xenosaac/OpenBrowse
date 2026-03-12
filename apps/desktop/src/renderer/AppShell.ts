export interface TaskConsoleSection {
  title: string;
  description: string;
}

export const taskConsoleSections: TaskConsoleSection[] = [
  {
    title: "Live Tasks",
    description: "Shows active runs, their current state, and whether they are waiting on clarification."
  },
  {
    title: "Remote Questions",
    description: "Shows clarification prompts routed to Telegram or other chat channels."
  },
  {
    title: "Workflow Log",
    description: "Shows local append-only run events for replay and debugging."
  },
  {
    title: "Managed Profiles",
    description: "Shows the browser profiles owned by OpenBrowse."
  }
];

