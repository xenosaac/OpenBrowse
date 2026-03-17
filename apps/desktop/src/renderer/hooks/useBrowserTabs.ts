import { useCallback, useEffect, useRef, useState } from "react";
import type { TaskRun } from "@openbrowse/contracts";
import type { BrowserShellTabDescriptor } from "../../shared/runtime";
import { runtimeEventBus, type RuntimeEvent } from "../lib/eventBus";

interface ClosedTabEntry {
  url: string;
  title: string;
}

const MAX_CLOSED_TAB_STACK = 20;

export const TAB_GROUP_COLORS = [
  { id: "grey", label: "Grey", value: "#6b7280" },
  { id: "blue", label: "Blue", value: "#3b82f6" },
  { id: "red", label: "Red", value: "#ef4444" },
  { id: "yellow", label: "Yellow", value: "#eab308" },
  { id: "green", label: "Green", value: "#22c55e" },
  { id: "pink", label: "Pink", value: "#ec4899" },
  { id: "purple", label: "Purple", value: "#a855f7" },
  { id: "cyan", label: "Cyan", value: "#06b6d4" },
] as const;

export interface TabGroupDef {
  id: string;
  name: string;
  colorId: string;
  collapsed: boolean;
}

let groupIdCounter = 0;

export function useBrowserTabs() {
  const [shellTabs, setShellTabs] = useState<BrowserShellTabDescriptor[]>([]);
  const [loadingTabs, setLoadingTabs] = useState<Record<string, boolean>>({});
  const [tabFavicons, setTabFavicons] = useState<Record<string, string>>({});
  const [pinnedTabs, setPinnedTabs] = useState<Set<string>>(new Set());
  const [closedTabStack, setClosedTabStack] = useState<ClosedTabEntry[]>([]);

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
    // Push to closed tab stack before closing (for undo)
    setShellTabs(current => {
      const tab = current.find(t => t.groupId === groupId);
      if (tab && tab.url && tab.url !== "about:blank") {
        setClosedTabStack(stack => {
          const next = [{ url: tab.url, title: tab.title || tab.url }, ...stack];
          return next.slice(0, MAX_CLOSED_TAB_STACK);
        });
      }
      return current;
    });
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

  const duplicateTab = useCallback(async (groupId: string): Promise<BrowserShellTabDescriptor | null> => {
    const tab = shellTabs.find(t => t.groupId === groupId);
    if (!tab || !tab.url || tab.url === "about:blank") return null;
    return window.openbrowse.browserNewTab(tab.url);
  }, [shellTabs]);

  const reopenClosedTab = useCallback(async (): Promise<BrowserShellTabDescriptor | null> => {
    let entry: ClosedTabEntry | undefined;
    setClosedTabStack(stack => {
      if (stack.length === 0) return stack;
      [entry] = stack;
      return stack.slice(1);
    });
    if (!entry) return null;
    return window.openbrowse.browserNewTab(entry.url);
  }, []);

  // ---- Tab Groups ----
  const [tabGroups, setTabGroups] = useState<TabGroupDef[]>([]);
  const [groupAssignments, setGroupAssignments] = useState<Record<string, string>>({}); // tabGroupId -> tabGroup.id
  const groupsInitialized = useRef(false);

  // Load tab groups from persistence on mount
  useEffect(() => {
    window.openbrowse.getTabGroups().then(({ tabGroups: restored, groupAssignments: restoredAssignments }) => {
      if (restored.length > 0) {
        setTabGroups(restored);
        setGroupAssignments(restoredAssignments);
        // Initialize groupIdCounter from restored groups to avoid ID collisions
        for (const g of restored) {
          const match = g.id.match(/^tg_(\d+)_/);
          if (match) {
            const num = parseInt(match[1], 10);
            if (num >= groupIdCounter) groupIdCounter = num + 1;
          }
        }
      }
      groupsInitialized.current = true;
    }).catch(() => { groupsInitialized.current = true; });
  }, []);

  const createTabGroup = useCallback((tabGroupId: string, name?: string): string => {
    const id = `tg_${++groupIdCounter}_${Date.now()}`;
    const colorIdx = tabGroups.length % TAB_GROUP_COLORS.length;
    const newGroup: TabGroupDef = {
      id,
      name: name || "",
      colorId: TAB_GROUP_COLORS[colorIdx].id,
      collapsed: false,
    };
    setTabGroups(prev => [...prev, newGroup]);
    setGroupAssignments(prev => ({ ...prev, [tabGroupId]: id }));
    return id;
  }, [tabGroups.length]);

  const addTabToGroup = useCallback((tabGroupId: string, tgId: string) => {
    setGroupAssignments(prev => ({ ...prev, [tabGroupId]: tgId }));
  }, []);

  const removeTabFromGroup = useCallback((tabGroupId: string) => {
    setGroupAssignments(prev => {
      const next = { ...prev };
      delete next[tabGroupId];
      return next;
    });
  }, []);

  const renameTabGroup = useCallback((tgId: string, name: string) => {
    setTabGroups(prev => prev.map(g => g.id === tgId ? { ...g, name } : g));
  }, []);

  const setTabGroupColor = useCallback((tgId: string, colorId: string) => {
    setTabGroups(prev => prev.map(g => g.id === tgId ? { ...g, colorId } : g));
  }, []);

  const toggleCollapseTabGroup = useCallback((tgId: string) => {
    setTabGroups(prev => prev.map(g => g.id === tgId ? { ...g, collapsed: !g.collapsed } : g));
  }, []);

  const deleteTabGroup = useCallback((tgId: string) => {
    setTabGroups(prev => prev.filter(g => g.id !== tgId));
    setGroupAssignments(prev => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (next[key] === tgId) delete next[key];
      }
      return next;
    });
  }, []);

  // Clean up group assignments when tabs are closed
  useEffect(() => {
    const tabIds = new Set(shellTabs.map(t => t.groupId));
    setGroupAssignments(prev => {
      const next = { ...prev };
      let changed = false;
      for (const key of Object.keys(next)) {
        if (!tabIds.has(key)) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // Delete empty groups
    setTabGroups(prev => {
      const usedGroups = new Set(Object.values(groupAssignments));
      const next = prev.filter(g => usedGroups.has(g.id));
      return next.length !== prev.length ? next : prev;
    });
  }, [shellTabs, groupAssignments]);

  // Debounced save of tab group state to persistence
  useEffect(() => {
    if (!groupsInitialized.current) return;
    const timer = setTimeout(() => {
      window.openbrowse.saveTabGroups(tabGroups, groupAssignments).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [tabGroups, groupAssignments]);

  // Sorted tabs: pinned first, then grouped tabs (grouped together by group), then ungrouped
  const sortedTabs = [...shellTabs].sort((a, b) => {
    const ap = pinnedTabs.has(a.groupId) ? 0 : 1;
    const bp = pinnedTabs.has(b.groupId) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    // Both unpinned: group membership
    const aGroup = groupAssignments[a.groupId];
    const bGroup = groupAssignments[b.groupId];
    if (aGroup && bGroup && aGroup !== bGroup) {
      // Sort by group creation order
      const aIdx = tabGroups.findIndex(g => g.id === aGroup);
      const bIdx = tabGroups.findIndex(g => g.id === bGroup);
      return aIdx - bIdx;
    }
    if (aGroup && !bGroup) return -1;
    if (!aGroup && bGroup) return 1;
    return 0;
  });

  return {
    shellTabs: sortedTabs, loadingTabs, tabFavicons, pinnedTabs, closedTabStack,
    tabGroups, groupAssignments,
    refreshTabs, newTab, closeTab, navigate, goBack, goForward, reload,
    pinTab, unpinTab, togglePinTab, moveTab, duplicateTab, reopenClosedTab,
    createTabGroup, addTabToGroup, removeTabFromGroup, renameTabGroup,
    setTabGroupColor, toggleCollapseTabGroup, deleteTabGroup
  };
}
