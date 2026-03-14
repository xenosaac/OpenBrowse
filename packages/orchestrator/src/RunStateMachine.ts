import type { TaskStatus } from "@openbrowse/contracts";

const allowedTransitions: Record<TaskStatus, TaskStatus[]> = {
  queued: ["running", "cancelled", "failed"],
  running: [
    "running",
    "suspended_for_clarification",
    "suspended_for_approval",
    "completed",
    "failed",
    "cancelled"
  ],
  suspended_for_clarification: ["running", "cancelled", "failed"],
  suspended_for_approval: ["running", "cancelled", "failed"],
  completed: [],
  failed: [],
  cancelled: []
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return allowedTransitions[from].includes(to);
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid task-run transition: ${from} -> ${to}`);
  }
}

