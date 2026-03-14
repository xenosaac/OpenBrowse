import type { WorkflowEvent } from "@openbrowse/contracts";
import type { WorkflowLogReader } from "./LogReplayer.js";

export interface RunAuditSummary {
  runId: string;
  status: string;
  goal: string;
  durationMs: number;
  totalSteps: number;
  browserActions: number;
  clarificationsRequested: number;
  clarificationsAnswered: number;
  approvalsRequested: number;
  approvalsAnswered: number;
  pagesModeled: number;
  failureReason?: string;
  recoveryEvents: number;
  startedAt: string;
  endedAt: string;
}

/**
 * Builds structured run history summaries and formatted timelines
 * from workflow event logs. Extends the LogReplayer's raw replay
 * with higher-level analysis.
 */
export class AuditTrail {
  constructor(private readonly logReader: WorkflowLogReader) {}

  async generateRunSummary(runId: string): Promise<RunAuditSummary> {
    const events = await this.logReader.listByRun(runId);

    if (events.length === 0) {
      return {
        runId,
        status: "unknown",
        goal: "",
        durationMs: 0,
        totalSteps: events.length,
        browserActions: 0,
        clarificationsRequested: 0,
        clarificationsAnswered: 0,
        approvalsRequested: 0,
        approvalsAnswered: 0,
        pagesModeled: 0,
        recoveryEvents: 0,
        startedAt: "",
        endedAt: ""
      };
    }

    const startTime = new Date(events[0].createdAt).getTime();
    const endTime = new Date(events[events.length - 1].createdAt).getTime();
    const durationMs = endTime - startTime;

    // Count event types
    let browserActions = 0;
    let clarificationsRequested = 0;
    let clarificationsAnswered = 0;
    let approvalsRequested = 0;
    let approvalsAnswered = 0;
    let pagesModeled = 0;
    let recoveryEvents = 0;
    let status = "unknown";
    let goal = "";
    let failureReason: string | undefined;

    for (const event of events) {
      switch (event.type) {
        case "run_created":
          goal = event.summary.replace("Task started: ", "");
          status = "running";
          break;
        case "browser_action_executed":
          browserActions++;
          break;
        case "clarification_requested":
          clarificationsRequested++;
          break;
        case "clarification_answered":
          clarificationsAnswered++;
          break;
        case "approval_requested":
          approvalsRequested++;
          break;
        case "approval_answered":
          approvalsAnswered++;
          break;
        case "page_modeled":
          pagesModeled++;
          break;
        case "run_completed":
          status = "completed";
          break;
        case "run_failed":
          status = "failed";
          failureReason = event.summary;
          break;
        case "run_cancelled":
          status = "cancelled";
          break;
        case "run_recovered":
        case "recovery_failed":
        case "recovery_skipped":
          recoveryEvents++;
          break;
      }
    }

    return {
      runId,
      status,
      goal,
      durationMs,
      totalSteps: events.length,
      browserActions,
      clarificationsRequested,
      clarificationsAnswered,
      approvalsRequested,
      approvalsAnswered,
      pagesModeled,
      failureReason,
      recoveryEvents,
      startedAt: events[0].createdAt,
      endedAt: events[events.length - 1].createdAt
    };
  }

  async generateRunTimeline(runId: string): Promise<string> {
    const events = await this.logReader.listByRun(runId);

    if (events.length === 0) {
      return `No events found for run ${runId}`;
    }

    const startTime = new Date(events[0].createdAt).getTime();
    const lines: string[] = [];

    let currentPhase = "";

    for (const event of events) {
      const elapsed = new Date(event.createdAt).getTime() - startTime;
      const seconds = (elapsed / 1000).toFixed(1);

      // Detect phase transitions
      const phase = getPhaseForEvent(event);
      if (phase !== currentPhase) {
        currentPhase = phase;
        lines.push(`\n── ${phase} ──`);
      }

      lines.push(`[+${seconds}s] ${event.type}: ${event.summary}`);
    }

    return lines.join("\n").trim();
  }
}

function getPhaseForEvent(event: WorkflowEvent): string {
  switch (event.type) {
    case "run_created":
      return "Initialization";
    case "page_modeled":
    case "planner_decision":
    case "browser_action_executed":
      return "Execution";
    case "clarification_requested":
    case "clarification_answered":
      return "Clarification";
    case "approval_requested":
    case "approval_answered":
      return "Approval";
    case "run_completed":
    case "run_failed":
    case "run_cancelled":
      return "Completion";
    case "run_recovered":
    case "recovery_failed":
    case "recovery_skipped":
      return "Recovery";
    default:
      return "Other";
  }
}
