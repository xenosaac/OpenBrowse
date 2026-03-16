import { useCallback, useEffect, useMemo, useState } from "react";
import type { TaskRun } from "@openbrowse/contracts";
import type { BrowserShellTabDescriptor } from "../../shared/runtime";
import type { MainPanel } from "../types/chat";

export function useSelection(
  runs: TaskRun[],
  shellTabs: BrowserShellTabDescriptor[]
) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [foregroundRunId, setForegroundRunId] = useState<string | null>(null);
  const [mainPanel, setMainPanel] = useState<MainPanel>("home");

  const activeBrowserTab = useMemo(() => {
    return (
      (selectedGroupId ? shellTabs.find((tab) => tab.groupId === selectedGroupId) : null) ??
      (foregroundRunId ? shellTabs.find((tab) => tab.groupId === foregroundRunId) : null) ??
      shellTabs[0] ??
      null
    );
  }, [foregroundRunId, selectedGroupId, shellTabs]);

  const activeTabRun = useMemo(
    () => (activeBrowserTab ? runs.find((r) => r.id === activeBrowserTab.runId) ?? null : null),
    [activeBrowserTab, runs]
  );

  const selectRun = useCallback((id: string | null) => setSelectedRunId(id), []);
  const selectGroup = useCallback((id: string | null) => setSelectedGroupId(id), []);
  const focusRun = useCallback((run: TaskRun, options?: { openBrowser?: boolean }) => {
    setSelectedRunId(run.id);
    setSelectedGroupId(run.id);
    setForegroundRunId(run.id);
    return { openBrowser: Boolean(options?.openBrowser && run.checkpoint.browserSessionId) };
  }, []);

  const clearGroupSelection = useCallback((groupId: string) => {
    setSelectedRunId((prev) => (groupId === prev ? null : prev));
    setSelectedGroupId((prev) => (groupId === prev ? null : prev));
    setForegroundRunId((prev) => (groupId === prev ? null : prev));
  }, []);

  // Sync stale selections
  useEffect(() => {
    if (selectedRunId && !runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(null);
    }
    if (selectedGroupId && !shellTabs.some((tab) => tab.groupId === selectedGroupId)) {
      setSelectedGroupId(null);
      if (foregroundRunId === selectedGroupId) setForegroundRunId(null);
    }
    if (!selectedGroupId && foregroundRunId) {
      const match = shellTabs.find((tab) => tab.groupId === foregroundRunId);
      if (match) setSelectedGroupId(match.groupId);
    }
  }, [foregroundRunId, runs, selectedGroupId, selectedRunId, shellTabs]);

  // Auto-select preferred run
  useEffect(() => {
    if (selectedRunId) return;
    const isRealRun = (id: string | undefined): id is string =>
      !!id && runs.some((r) => r.id === id);
    const fromGroup = selectedGroupId
      ? shellTabs.find((tab) => tab.groupId === selectedGroupId)?.runId
      : undefined;
    const fromForeground = foregroundRunId
      ? shellTabs.find((tab) => tab.groupId === foregroundRunId)?.runId
      : undefined;
    const preferredRunId =
      (isRealRun(fromGroup) ? fromGroup : undefined) ??
      (isRealRun(fromForeground) ? fromForeground : undefined) ??
      runs.find((run) => run.status === "running")?.id ??
      runs[0]?.id;
    if (preferredRunId) setSelectedRunId(preferredRunId);
  }, [foregroundRunId, runs, selectedGroupId, selectedRunId, shellTabs]);

  return {
    selectedRunId, selectedGroupId, foregroundRunId, mainPanel,
    activeBrowserTab, activeTabRun,
    selectRun, selectGroup, focusRun, setForegroundRunId, setMainPanel, clearGroupSelection
  };
}
