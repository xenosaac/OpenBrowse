import type { WorkflowEvent } from "@openbrowse/contracts";

export interface WorkflowLogReader {
  listByRun(runId: string): Promise<WorkflowEvent[]>;
}

export interface ReplayStep {
  index: number;
  event: WorkflowEvent;
  elapsed: number;
}

export class LogReplayer {
  constructor(private readonly logReader: WorkflowLogReader) {}

  async replay(runId: string): Promise<ReplayStep[]> {
    const events = await this.logReader.listByRun(runId);

    if (events.length === 0) {
      return [];
    }

    const startTime = new Date(events[0].createdAt).getTime();

    return events.map((event, index) => ({
      index,
      event,
      elapsed: new Date(event.createdAt).getTime() - startTime
    }));
  }

  async replayFormatted(runId: string): Promise<string> {
    const steps = await this.replay(runId);

    if (steps.length === 0) {
      return `No events found for run ${runId}`;
    }

    return steps
      .map(
        (step) =>
          `[+${(step.elapsed / 1000).toFixed(1)}s] ${step.event.type}: ${step.event.summary}`
      )
      .join("\n");
  }
}
