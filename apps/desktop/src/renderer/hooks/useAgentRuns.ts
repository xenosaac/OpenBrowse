import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RuntimeEvent } from "../lib/eventBus";
import { runtimeEventBus } from "../lib/eventBus";
import type { BrowserProfile, TaskRun, WorkflowEvent } from "@openbrowse/contracts";
import type { ReplayStep } from "@openbrowse/observability";
import type {
  RecoverySummary,
  RuntimeDescriptor,
  RuntimeSettings
} from "../../shared/runtime";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mergeEvents(persisted: WorkflowEvent[], streamed: WorkflowEvent[]): WorkflowEvent[] {
  const deduped = new Map<string, WorkflowEvent>();
  for (const event of [...persisted, ...streamed]) {
    deduped.set(event.id, event);
  }

  return [...deduped.values()].sort((a, b) =>
    a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt)
  );
}

function upsertRun(current: TaskRun[], nextRun: TaskRun): TaskRun[] {
  const next = current.filter((run) => run.id !== nextRun.id);
  next.unshift(nextRun);
  next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return next;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAgentRuns() {
  // ---- state ----
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [profiles, setProfiles] = useState<BrowserProfile[]>([]);
  const [runtime, setRuntime] = useState<RuntimeDescriptor | null>(null);
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [logs, setLogs] = useState<WorkflowEvent[]>([]);
  const [replaySteps, setReplaySteps] = useState<ReplayStep[]>([]);
  const [foregroundRunEvents, setForegroundRunEvents] = useState<WorkflowEvent[]>([]);
  const [globalActionEvents, setGlobalActionEvents] = useState<WorkflowEvent[]>([]);
  const [inspectedRunId, setInspectedRunId] = useState<string | null>(null);
  const [foregroundRunId, setForegroundRunId] = useState<string | null>(null);

  // ---- refs ----
  const inspectedRunIdRef = useRef<string | null>(null);
  const foregroundRunIdRef = useRef<string | null>(null);
  const liveEventsRef = useRef<Record<string, WorkflowEvent[]>>({});
  const runtimeRef = useRef<RuntimeDescriptor | null>(null);

  // ---- derived ----
  const suspendedRuns = useMemo(
    () =>
      runs.filter(
        (run) => run.status === "suspended_for_clarification" || run.status === "suspended_for_approval"
      ),
    [runs]
  );

  // ---- methods ----

  const refresh = useCallback(async () => {
    const [allRuns, allProfiles, runtimeStatus, recoveryReport, runtimeSettings] = await Promise.allSettled([
      window.openbrowse.listRuns(),
      window.openbrowse.listProfiles(),
      window.openbrowse.describeRuntime(),
      window.openbrowse.getLastRecoveryReport(),
      window.openbrowse.getSettings()
    ]);

    if (allRuns.status === "fulfilled") setRuns(allRuns.value);
    if (allProfiles.status === "fulfilled") setProfiles(allProfiles.value);
    if (runtimeStatus.status === "fulfilled") setRuntime(runtimeStatus.value);
    if (runtimeSettings.status === "fulfilled") setSettings(runtimeSettings.value);
    if (recoveryReport.status === "fulfilled") {
      setNotice(
        recoveryReport.value
          ? `Recovered ${recoveryReport.value.resumed} run(s), ${recoveryReport.value.awaitingInput} waiting for input, ${recoveryReport.value.failed} recovery failure(s).`
          : null
      );
    }

    const failures = [allRuns, allProfiles, runtimeStatus, recoveryReport, runtimeSettings].filter(
      (result) => result.status === "rejected"
    );
    setErrorNotice(
      failures.length > 0
        ? "Some runtime panels failed to load. Open Settings or restart the app if this persists."
        : null
    );
  }, []);

  const refreshRunAudit = useCallback(
    async (runId: string | null) => {
      if (!runId) {
        setLogs([]);
        setReplaySteps([]);
        return;
      }

      try {
        const [workflowLogs, replay] = await Promise.all([
          window.openbrowse.listLogs(runId),
          window.openbrowse.replayLogs(runId)
        ]);
        setLogs(mergeEvents(workflowLogs, liveEventsRef.current[runId] ?? []));
        setReplaySteps(replay);
      } catch {
        setLogs(liveEventsRef.current[runId] ?? []);
        setReplaySteps([]);
      }
    },
    []
  );

  const saveSettings = useCallback(
    async (next: RuntimeSettings): Promise<{ settings: RuntimeSettings; descriptor: RuntimeDescriptor }> => {
      const result = await window.openbrowse.saveSettings(next) as {
        settings: RuntimeSettings;
        descriptor: RuntimeDescriptor;
      };
      setSettings(result.settings);
      setRuntime(result.descriptor);
      return result;
    },
    []
  );

  // ---- keep refs in sync ----

  useEffect(() => {
    inspectedRunIdRef.current = inspectedRunId;
  }, [inspectedRunId]);

  useEffect(() => {
    foregroundRunIdRef.current = foregroundRunId;
    // Seed foregroundRunEvents from the live buffer when foregroundRunId changes.
    const buffer = foregroundRunId ? liveEventsRef.current[foregroundRunId] ?? [] : [];
    setForegroundRunEvents(
      buffer.filter((e) => e.type === "browser_action_executed").slice(-8)
    );
  }, [foregroundRunId]);

  useEffect(() => {
    runtimeRef.current = runtime;
  }, [runtime]);

  // ---- audit log follows inspectedRunId ----

  useEffect(() => {
    void refreshRunAudit(inspectedRunId);
  }, [refreshRunAudit, inspectedRunId]);

  // ---- event subscriptions & initialization ----

  useEffect(() => {
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retries = 0;

    const tryRefresh = async () => {
      await refresh();
      retries++;
      // Use runtimeRef (not the stale closure value) so the retry loop stops as soon as
      // the runtime descriptor arrives, without needing this effect to re-run.
      if (!runtimeRef.current && retries < 10) {
        retryTimer = setTimeout(() => void tryRefresh(), 500);
      }
    };

    void tryRefresh();

    const unsub = runtimeEventBus.subscribe((event: RuntimeEvent) => {
      if (event.type === "runtime_ready" && event.descriptor) {
        setRuntime(event.descriptor);
        setErrorNotice(null);
        void refresh();
        return;
      }

      if (event.type === "recovery_complete" && event.report) {
        setNotice(
          `Recovered ${event.report.resumed} run(s), ${event.report.awaitingInput} waiting for input, ${event.report.failed} recovery failure(s).`
        );
        void refresh();
        return;
      }

      if (event.type === "run_updated" && event.run) {
        setRuns((current) => upsertRun(current, event.run!));
        // Only refresh the audit log when the updated run is the one currently being inspected.
        if (event.run.id === inspectedRunIdRef.current) {
          void refreshRunAudit(event.run.id);
        }
        return;
      }

      if (event.type === "workflow_event" && event.event) {
        const eventRunId = event.event.runId;
        const nextBuffered = mergeEvents(liveEventsRef.current[eventRunId] ?? [], [event.event]).slice(-80);
        liveEventsRef.current = {
          ...liveEventsRef.current,
          [eventRunId]: nextBuffered
        };

        if (inspectedRunIdRef.current === eventRunId) {
          setLogs((current) => mergeEvents(current, [event.event!]));
        }

        if (
          foregroundRunIdRef.current === eventRunId &&
          event.event.type === "browser_action_executed"
        ) {
          setForegroundRunEvents((current) =>
            mergeEvents(current, [event.event!]).slice(-8)
          );
        }

        if (event.event.type === "browser_action_executed") {
          setGlobalActionEvents((current) =>
            mergeEvents(current, [event.event!]).slice(-40)
          );
        }
      }
    });

    return () => {
      unsub();
      if (retryTimer) clearTimeout(retryTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, refreshRunAudit]);

  // ---- public API ----

  return {
    // state
    runs,
    profiles,
    runtime,
    settings,
    notice,
    errorNotice,
    logs,
    replaySteps,
    foregroundRunEvents,
    globalActionEvents,
    inspectedRunId,
    foregroundRunId,
    suspendedRuns,

    // methods
    refresh,
    refreshRunAudit,
    saveSettings,
    setInspectedRunId,
    setForegroundRunId,
  };
}
