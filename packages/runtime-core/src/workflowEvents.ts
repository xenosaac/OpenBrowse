import { randomUUID } from "node:crypto";
import type { WorkflowEvent } from "@openbrowse/contracts";
import type { EventBus } from "@openbrowse/observability";
import type { WorkflowLogStore } from "@openbrowse/memory-store";

export function createWorkflowEventId(runId: string): string {
  try {
    return `event_${runId}_${randomUUID()}`;
  } catch {
    return `event_${runId}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function createWorkflowEvent(
  runId: string,
  type: WorkflowEvent["type"],
  summary: string,
  payload: Record<string, string>
): WorkflowEvent {
  return {
    id: createWorkflowEventId(runId),
    runId,
    type,
    summary,
    createdAt: new Date().toISOString(),
    payload
  };
}

export async function appendWorkflowEvent(
  workflowLogStore: WorkflowLogStore,
  eventBus: EventBus<{ workflow: WorkflowEvent }>,
  event: WorkflowEvent
): Promise<void> {
  await workflowLogStore.append(event);
  await eventBus.publish("workflow", event);
}
