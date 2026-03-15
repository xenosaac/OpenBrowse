import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BrowserProfile, TaskRun, WorkflowEvent } from "@openbrowse/contracts";
import type { ReplayStep } from "@openbrowse/observability";
import type {
  BrowserShellTabDescriptor,
  RecoverySummary,
  RuntimeDescriptor,
  RuntimeSettings
} from "../../shared/runtime";

type RuntimeEvent =
  | { type: "runtime_ready"; descriptor?: RuntimeDescriptor }
  | { type: "run_updated"; run?: TaskRun }
  | { type: "recovery_complete"; report?: RecoverySummary }
  | { type: "workflow_event"; event?: WorkflowEvent }
  | { type: "tab_navigated"; sessionId?: string; url?: string; title?: string }
  | { type: "standalone_tab_created"; tab?: BrowserShellTabDescriptor }
  | { type: "standalone_tab_closed"; tabId?: string };

export function useRuntimeStore() {
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [profiles, setProfiles] = useState<BrowserProfile[]>([]);
  const [shellTabs, setShellTabs] = useState<BrowserShellTabDescriptor[]>([]);
  const [runtime, setRuntime] = useState<RuntimeDescriptor | null>(null);
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [logs, setLogs] = useState<WorkflowEvent[]>([]);
  const [replaySteps, setReplaySteps] = useState<ReplayStep[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [foregroundRunId, setForegroundRunId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  const selectedRunIdRef = useRef<string | null>(null);
  const liveEventsRef = useRef<Record<string, WorkflowEvent[]>>({});
  const runtimeRef = useRef<RuntimeDescriptor | null>(null);

  const mergeEvents = useCallback((persisted: WorkflowEvent[], streamed: WorkflowEvent[]): WorkflowEvent[] => {
    const deduped = new Map<string, WorkflowEvent>();
    for (const event of [...persisted, ...streamed]) {
      deduped.set(event.id, event);
    }

    return [...deduped.values()].sort((a, b) =>
      a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt)
    );
  }, []);

  const upsertRun = useCallback((current: TaskRun[], nextRun: TaskRun): TaskRun[] => {
    const next = current.filter((run) => run.id !== nextRun.id);
    next.unshift(nextRun);
    next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return next;
  }, []);

  const refresh = useCallback(async () => {
    const [allRuns, allProfiles, allTabs, runtimeStatus, recoveryReport, runtimeSettings] = await Promise.allSettled([
      window.openbrowse.listRuns(),
      window.openbrowse.listProfiles(),
      window.openbrowse.listTabs(),
      window.openbrowse.describeRuntime(),
      window.openbrowse.getLastRecoveryReport(),
      window.openbrowse.getSettings()
    ]);

    if (allRuns.status === "fulfilled") setRuns(allRuns.value);
    if (allProfiles.status === "fulfilled") setProfiles(allProfiles.value);
    if (allTabs.status === "fulfilled") setShellTabs(allTabs.value);
    if (runtimeStatus.status === "fulfilled") setRuntime(runtimeStatus.value);
    if (runtimeSettings.status === "fulfilled") setSettings(runtimeSettings.value);
    if (recoveryReport.status === "fulfilled") {
      setNotice(
        recoveryReport.value
          ? `Recovered ${recoveryReport.value.resumed} run(s), ${recoveryReport.value.awaitingInput} waiting for input, ${recoveryReport.value.failed} recovery failure(s).`
          : null
      );
    }

    const failures = [allRuns, allProfiles, allTabs, runtimeStatus, recoveryReport, runtimeSettings].filter(
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
    [mergeEvents]
  );

  const focusRun = useCallback((run: TaskRun, options?: { openBrowser?: boolean }) => {
    setSelectedRunId(run.id);
    setSelectedGroupId(run.id);
    setForegroundRunId(run.id);
    return {
      openBrowser: Boolean(options?.openBrowser && run.checkpoint.browserSessionId)
    };
  }, []);

  const clearGroupSelection = useCallback((groupId: string, selectedRunIdValue: string | null) => {
    if (groupId === selectedRunIdValue) {
      setSelectedRunId(null);
    }
    if (groupId === selectedGroupId) {
      setSelectedGroupId(null);
    }
    if (groupId === foregroundRunId) {
      setForegroundRunId(null);
    }
  }, [foregroundRunId, selectedGroupId]);

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

  useEffect(() => {
    runtimeRef.current = runtime;
  }, [runtime]);

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

    const unsub = window.openbrowse.onRuntimeEvent((event) => {
      const runtimeEvent = event as RuntimeEvent;
      if (runtimeEvent.type === "runtime_ready" && runtimeEvent.descriptor) {
        setRuntime(runtimeEvent.descriptor);
        setErrorNotice(null);
        void refresh();
        return;
      }

      if (runtimeEvent.type === "recovery_complete" && runtimeEvent.report) {
        setNotice(
          `Recovered ${runtimeEvent.report.resumed} run(s), ${runtimeEvent.report.awaitingInput} waiting for input, ${runtimeEvent.report.failed} recovery failure(s).`
        );
        void refresh();
        return;
      }

      if (runtimeEvent.type === "run_updated" && runtimeEvent.run) {
        setRuns((current) => upsertRun(current, runtimeEvent.run!));
        if (runtimeEvent.run.checkpoint.browserSessionId) {
          setShellTabs((current) => {
            const next = current.filter((tab) => tab.groupId !== runtimeEvent.run!.id);
            next.unshift({
              id: runtimeEvent.run!.checkpoint.browserSessionId!,
              runId: runtimeEvent.run!.id,
              groupId: runtimeEvent.run!.id,
              title: runtimeEvent.run!.goal,
              url: runtimeEvent.run!.checkpoint.lastKnownUrl || "about:blank",
              profileId: runtimeEvent.run!.profileId || "managed-default",
              source: runtimeEvent.run!.source,
              status: runtimeEvent.run!.status,
              isBackground: runtimeEvent.run!.source === "scheduler",
              closable: true
            });
            return next;
          });
        }
        // Only refresh the audit log when the updated run is the one currently being viewed.
        // Calling refreshRunAudit for a different run would overwrite the displayed logs.
        if (runtimeEvent.run.id === selectedRunIdRef.current) {
          void refreshRunAudit(runtimeEvent.run.id);
        }
        return;
      }

      if (runtimeEvent.type === "tab_navigated" && runtimeEvent.sessionId) {
        setShellTabs((current) =>
          current.map((tab) =>
            tab.id === runtimeEvent.sessionId
              ? { ...tab, url: runtimeEvent.url ?? tab.url, title: runtimeEvent.title ?? tab.title }
              : tab
          )
        );
        return;
      }

      if (runtimeEvent.type === "standalone_tab_created" && runtimeEvent.tab) {
        setShellTabs((current) => [runtimeEvent.tab!, ...current]);
        return;
      }

      if (runtimeEvent.type === "standalone_tab_closed" && runtimeEvent.tabId) {
        setShellTabs((current) => current.filter((tab) => tab.id !== runtimeEvent.tabId));
        return;
      }

      if (runtimeEvent.type === "workflow_event" && runtimeEvent.event) {
        const eventRunId = runtimeEvent.event.runId;
        const nextBuffered = mergeEvents(liveEventsRef.current[eventRunId] ?? [], [runtimeEvent.event]).slice(-80);
        liveEventsRef.current = {
          ...liveEventsRef.current,
          [eventRunId]: nextBuffered
        };

        if (selectedRunIdRef.current === eventRunId) {
          setLogs((current) => mergeEvents(current, [runtimeEvent.event!]));
        }
      }
    });

    return () => {
      unsub();
      if (retryTimer) clearTimeout(retryTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergeEvents, refresh, refreshRunAudit, upsertRun]);

  useEffect(() => {
    void refreshRunAudit(selectedRunId);
  }, [refreshRunAudit, selectedRunId]);

  useEffect(() => {
    if (selectedRunId && !runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(null);
    }
    if (selectedGroupId && !shellTabs.some((tab) => tab.groupId === selectedGroupId)) {
      setSelectedGroupId(null);
      if (foregroundRunId === selectedGroupId) {
        setForegroundRunId(null);
      }
    }
    if (!selectedGroupId && foregroundRunId) {
      const matchingGroup = shellTabs.find((tab) => tab.groupId === foregroundRunId);
      if (matchingGroup) {
        setSelectedGroupId(matchingGroup.groupId);
      }
    }
  }, [foregroundRunId, runs, selectedGroupId, selectedRunId, shellTabs]);

  useEffect(() => {
    if (selectedRunId) return;
    const preferredRunId =
      (selectedGroupId ? shellTabs.find((tab) => tab.groupId === selectedGroupId)?.runId : null) ??
      (foregroundRunId ? shellTabs.find((tab) => tab.groupId === foregroundRunId)?.runId : null) ??
      shellTabs[0]?.runId ??
      runs.find((run) => run.status === "running")?.id ??
      runs[0]?.id;
    if (preferredRunId) {
      setSelectedRunId(preferredRunId);
    }
  }, [foregroundRunId, runs, selectedGroupId, selectedRunId, shellTabs]);

  const suspendedRuns = useMemo(
    () =>
      runs.filter(
        (run) => run.status === "suspended_for_clarification" || run.status === "suspended_for_approval"
      ),
    [runs]
  );

  return {
    errorNotice,
    focusRun,
    foregroundRunId,
    logs,
    notice,
    profiles,
    refresh,
    replaySteps,
    runs,
    runtime,
    selectedGroupId,
    selectedRunId,
    setForegroundRunId,
    setSelectedGroupId,
    setSelectedRunId,
    settings,
    shellTabs,
    suspendedRuns,
    clearGroupSelection
  };
}
