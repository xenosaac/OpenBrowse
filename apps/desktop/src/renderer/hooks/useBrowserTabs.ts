import { useCallback, useEffect, useState } from "react";
import type { TaskRun } from "@openbrowse/contracts";
import type { BrowserShellTabDescriptor } from "../../shared/runtime";
import { runtimeEventBus, type RuntimeEvent } from "../lib/eventBus";

export function useBrowserTabs() {
  const [shellTabs, setShellTabs] = useState<BrowserShellTabDescriptor[]>([]);
  const [loadingTabs, setLoadingTabs] = useState<Record<string, boolean>>({});
  const [tabFavicons, setTabFavicons] = useState<Record<string, string>>({});
  const [pinnedTabs, setPinnedTabs] = useState<Set<string>>(new Set());

  const refreshTabs = useCallback(async () => {
    try {
      const tabs = await window.openbrowse.listTabs();
      setShellTabs(tabs);
      // Initialize pin state from restored tabs
      const restoredPins = new Set(tabs.filter((t) => t.pinned).map((t) => t.groupId));
      if (restoredPins.size > 0) {
        setPinnedTabs(restoredPins);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const unsub = runtimeEventBus.subscribe((event: RuntimeEvent) => {
      if (event.type === "run_updated" && event.run?.checkpoint.browserSessionId) {
        const run = event.run;
        setShellTabs((current) => {
          const sessionId = run.checkpoint.browserSessionId!;
          const next = current.filter((tab) => tab.groupId !== run.id && tab.id !== sessionId);
          next.push({
            id: run.checkpoint.browserSessionId!,
            runId: run.id,
            groupId: run.id,
            title: run.goal,
            url: run.checkpoint.lastKnownUrl || "about:blank",
            profileId: run.profileId || "managed-default",
            source: run.source,
            status: run.status,
            isBackground: run.source === "scheduler",
            closable: true
          });
          return next;
        });
      }
      if (event.type === "tab_navigated" && event.sessionId) {
        setShellTabs((current) =>
          current.map((tab) =>
            tab.id === event.sessionId
              ? { ...tab, url: event.url ?? tab.url, title: event.title ?? tab.title }
              : tab
          )
        );
      }
      if (event.type === "standalone_tab_created" && event.tab) {
        setShellTabs((current) => [...current, event.tab!]);
        if (event.tab!.pinned) {
          setPinnedTabs((prev) => { const next = new Set(prev); next.add(event.tab!.groupId); return next; });
        }
      }
      if (event.type === "standalone_tab_closed" && event.tabId) {
        setShellTabs((current) => current.filter((tab) => tab.id !== event.tabId));
      }
      if (event.type === "tab_loading" && event.sessionId != null) {
        setLoadingTabs((current) => ({ ...current, [event.sessionId!]: !!event.isLoading }));
      }
      if (event.type === "tab_favicon" && event.sessionId && event.faviconUrl) {
        setTabFavicons((current) => ({ ...current, [event.sessionId!]: event.faviconUrl! }));
      }
    });
    return unsub;
  }, []);

  const newTab = useCallback(async (url?: string) => {
    return window.openbrowse.browserNewTab(url);
  }, []);

  const closeTab = useCallback(async (groupId: string) => {
    return window.openbrowse.closeBrowserGroup(groupId);
  }, []);

  const navigate = useCallback(async (sessionId: string, url: string) => {
    await window.openbrowse.browserNavigate(sessionId, url);
  }, []);

  const goBack = useCallback(async (sessionId: string) => {
    await window.openbrowse.browserBack(sessionId);
  }, []);

  const goForward = useCallback(async (sessionId: string) => {
    await window.openbrowse.browserForward(sessionId);
  }, []);

  const reload = useCallback(async (sessionId: string) => {
    await window.openbrowse.browserReload(sessionId);
  }, []);

  const pinTab = useCallback((groupId: string) => {
    setPinnedTabs(prev => { const next = new Set(prev); next.add(groupId); return next; });
    window.openbrowse.setTabPinned(groupId, true).catch(() => {});
  }, []);

  const unpinTab = useCallback((groupId: string) => {
    setPinnedTabs(prev => { const next = new Set(prev); next.delete(groupId); return next; });
    window.openbrowse.setTabPinned(groupId, false).catch(() => {});
  }, []);

  const togglePinTab = useCallback((groupId: string) => {
    setPinnedTabs(prev => {
      const next = new Set(prev);
      const pinned = !next.has(groupId);
      if (pinned) next.add(groupId); else next.delete(groupId);
      window.openbrowse.setTabPinned(groupId, pinned).catch(() => {});
      return next;
    });
  }, []);

  const moveTab = useCallback((fromGroupId: string, toGroupId: string) => {
    setShellTabs(prev => {
      const fromIdx = prev.findIndex(t => t.groupId === fromGroupId);
      const toIdx = prev.findIndex(t => t.groupId === toGroupId);
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      // Persist standalone tab order
      const standaloneIds = next.filter(t => t.source === "desktop").map(t => t.groupId);
      window.openbrowse.setTabOrder(standaloneIds).catch(() => {});
      return next;
    });
  }, []);

  // Sorted tabs: pinned first (preserving relative order), then unpinned
  const sortedTabs = [...shellTabs].sort((a, b) => {
    const ap = pinnedTabs.has(a.groupId) ? 0 : 1;
    const bp = pinnedTabs.has(b.groupId) ? 0 : 1;
    return ap - bp;
  });

  return {
    shellTabs: sortedTabs, loadingTabs, tabFavicons, pinnedTabs,
    refreshTabs, newTab, closeTab, navigate, goBack, goForward, reload,
    pinTab, unpinTab, togglePinTab, moveTab
  };
}
