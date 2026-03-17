/**
 * Pure analytics computation for task runs.
 * No React/DOM dependencies — extracted for testability.
 */

export interface RunAnalytics {
  totalRuns: number;
  completed: number;
  failed: number;
  cancelled: number;
  running: number;
  other: number;
  completionRate: number;   // 0-100 percentage
  failureRate: number;      // 0-100 percentage
  avgStepsCompleted: number; // average stepCount for completed runs (0 if none)
  failureBreakdown: Record<string, number>; // category → count for failed runs
  recentRuns: Array<{
    id: string;
    goal: string;
    status: string;
    stepCount: number;
    updatedAt: string;
  }>;
}

interface MinimalRun {
  id: string;
  goal: string;
  status: string;
  updatedAt: string;
  checkpoint: { stepCount?: number };
  outcome?: { summary?: string };
}

export type FailureClassifierFn = (summary: string) => { category: string };

export function computeRunAnalytics(
  runs: MinimalRun[],
  classifyFailureFn?: FailureClassifierFn,
): RunAnalytics {
  const totalRuns = runs.length;
  let completed = 0;
  let failed = 0;
  let cancelled = 0;
  let running = 0;
  let other = 0;
  let completedStepSum = 0;

  for (const run of runs) {
    switch (run.status) {
      case "completed":
        completed++;
        completedStepSum += run.checkpoint.stepCount ?? 0;
        break;
      case "failed":
        failed++;
        break;
      case "cancelled":
        cancelled++;
        break;
      case "running":
      case "suspended_for_clarification":
      case "suspended_for_approval":
      case "queued":
        running++;
        break;
      default:
        other++;
        break;
    }
  }

  const completionRate = totalRuns > 0 ? Math.round((completed / totalRuns) * 100) : 0;
  const failureRate = totalRuns > 0 ? Math.round((failed / totalRuns) * 100) : 0;
  const avgStepsCompleted = completed > 0 ? Math.round((completedStepSum / completed) * 10) / 10 : 0;

  // Classify failed runs by failure category (requires classifier function)
  const failureBreakdown: Record<string, number> = {};
  if (classifyFailureFn) {
    for (const run of runs) {
      if (run.status === "failed") {
        const summary = run.outcome?.summary ?? "";
        const { category } = classifyFailureFn(summary);
        failureBreakdown[category] = (failureBreakdown[category] ?? 0) + 1;
      }
    }
  }

  const recentRuns = runs.slice(0, 10).map((r) => ({
    id: r.id,
    goal: r.goal,
    status: r.status,
    stepCount: r.checkpoint.stepCount ?? 0,
    updatedAt: r.updatedAt,
  }));

  return {
    totalRuns,
    completed,
    failed,
    cancelled,
    running,
    other,
    completionRate,
    failureRate,
    avgStepsCompleted,
    failureBreakdown,
    recentRuns,
  };
}
