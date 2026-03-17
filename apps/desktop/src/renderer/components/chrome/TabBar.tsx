import React, { useCallback, useRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { TaskRun } from "@openbrowse/contracts";
import type { BrowserShellTabDescriptor } from "../../../shared/runtime";
import { colors, radii, glass, shadows } from "../../styles/tokens";

interface Props {
  shellTabs: BrowserShellTabDescriptor[];
  activeBrowserTab: BrowserShellTabDescriptor | null;
  runs: TaskRun[];
  tabFavicons: Record<string, string>;
  pinnedTabs: Set<string>;
  sidebarVisible: boolean;
  mainPanel: string;
  onSelectTab: (tab: BrowserShellTabDescriptor) => void;
  onCloseTab: (tab: BrowserShellTabDescriptor) => void;
  onNewTab: () => void;
  onToggleSidebar: () => void;
  onPinTab: (groupId: string) => void;
  onUnpinTab: (groupId: string) => void;
  onMoveTab: (fromGroupId: string, toGroupId: string) => void;
}

function getTabStatusDot(tab: BrowserShellTabDescriptor, runs: TaskRun[]): { color: string; animate: boolean; title: string } {
  const run = runs.find((r) => r.id === tab.runId);
  if (!run) return { color: colors.emerald, animate: false, title: "Standalone tab" };
  switch (run.status) {
    case "running": return { color: colors.statusRunning, animate: true, title: "Agent running" };
    case "suspended_for_clarification":
    case "suspended_for_approval": return { color: colors.statusWaiting, animate: false, title: "Awaiting input" };
    case "completed": return { color: colors.statusRunning, animate: false, title: "Completed" };
    case "failed":
    case "cancelled": return { color: colors.statusFailed, animate: false, title: "Failed" };
    default: return { color: colors.emerald, animate: false, title: run.status };
  }
}

export function TabBar(props: Props) {
  const {
    shellTabs, activeBrowserTab, runs, tabFavicons, pinnedTabs, sidebarVisible, mainPanel,
    onSelectTab, onCloseTab, onNewTab, onToggleSidebar, onPinTab, onUnpinTab, onMoveTab
  } = props;

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tab: BrowserShellTabDescriptor } | null>(null);
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
  const [dropTargetGroupId, setDropTargetGroupId] = useState<string | null>(null);

  // Close context menu on any click
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  const tabsContainerRef = useRef<HTMLDivElement | null>(null);
  const [tabScroll, setTabScroll] = useState({ canScrollLeft: false, canScrollRight: false });

  const updateTabScroll = useCallback(() => {
    const el = tabsContainerRef.current;
    if (!el) return;
    setTabScroll({
      canScrollLeft: el.scrollLeft > 0,
      canScrollRight: el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    });
  }, []);

  useEffect(() => { updateTabScroll(); }, [shellTabs.length, updateTabScroll]);

  return (
    <div style={{ ...styles.tabBar, paddingLeft: sidebarVisible ? 10 : 82 } as React.CSSProperties}>
      <button
        className="ob-btn"
        onClick={onToggleSidebar}
        style={{ ...styles.iconButton, WebkitAppRegion: "no-drag" } as React.CSSProperties}
        title={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
      >
        ☰
      </button>
      <div
        ref={tabsContainerRef}
        onScroll={updateTabScroll}
        style={{
          ...styles.headerTabs,
          ...(tabScroll.canScrollLeft || tabScroll.canScrollRight
            ? {
                maskImage: `linear-gradient(to right, ${tabScroll.canScrollLeft ? "transparent" : "black"}, black 30px, black calc(100% - 30px), ${tabScroll.canScrollRight ? "transparent" : "black"})`,
                WebkitMaskImage: `linear-gradient(to right, ${tabScroll.canScrollLeft ? "transparent" : "black"}, black 30px, black calc(100% - 30px), ${tabScroll.canScrollRight ? "transparent" : "black"})`
              }
            : {})
        } as React.CSSProperties}
      >
        {shellTabs.map((tab) => {
          const active = mainPanel === "browser" && activeBrowserTab?.groupId === tab.groupId;
          const pinned = pinnedTabs.has(tab.groupId);
          const dot = getTabStatusDot(tab, runs);
          const favicon = tabFavicons[tab.id];
          return (
            <div
              key={tab.groupId}
              className="ob-tab"
              draggable
              style={{
                ...styles.headerTabWrap,
                ...(active ? styles.headerTabWrapActive : {}),
                ...(pinned ? styles.headerTabWrapPinned : {}),
                ...(draggedGroupId === tab.groupId ? { opacity: 0.4 } : {}),
                ...(dropTargetGroupId === tab.groupId && draggedGroupId !== tab.groupId
                  ? { borderLeft: `2px solid ${colors.emerald}` } : {})
              }}
              onDragStart={(e) => {
                setDraggedGroupId(tab.groupId);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (draggedGroupId && draggedGroupId !== tab.groupId) {
                  setDropTargetGroupId(tab.groupId);
                }
              }}
              onDragLeave={() => {
                if (dropTargetGroupId === tab.groupId) setDropTargetGroupId(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (draggedGroupId && draggedGroupId !== tab.groupId) {
                  onMoveTab(draggedGroupId, tab.groupId);
                }
                setDraggedGroupId(null);
                setDropTargetGroupId(null);
              }}
              onDragEnd={() => {
                setDraggedGroupId(null);
                setDropTargetGroupId(null);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, tab });
              }}
            >
              <button
                onClick={() => onSelectTab(tab)}
                style={{
                  ...styles.headerTabInner,
                  ...(pinned ? { padding: "8px 8px" } : {}),
                  WebkitAppRegion: "no-drag"
                } as React.CSSProperties}
                title={pinned ? tab.title : undefined}
              >
                {favicon ? (
                  <img src={favicon} alt="" width={16} height={16}
                    style={{ flexShrink: 0, borderRadius: 2 }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <span style={{
                    ...styles.headerTabDot, background: dot.color,
                    ...(dot.animate ? { animation: "ob-pulse 1.5s ease-in-out infinite" } : {})
                  }} title={dot.title} />
                )}
                {!pinned && <span style={styles.headerTabTitle}>{tab.title}</span>}
              </button>
              {!pinned && (
                <button
                  className="ob-tab-close"
                  style={{ ...styles.headerTabClose, WebkitAppRegion: "no-drag" } as React.CSSProperties}
                  onClick={() => onCloseTab(tab)}
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
        <button
          className="ob-btn"
          style={{ ...styles.addTabButton, WebkitAppRegion: "no-drag" } as React.CSSProperties}
          onClick={onNewTab}
        >
          +
        </button>
      </div>
      {contextMenu && createPortal(
        <div style={{
          position: "fixed",
          top: contextMenu.y,
          left: contextMenu.x,
          ...glass.panel,
          border: `1px solid ${colors.borderGlass}`,
          borderRadius: 8,
          padding: "4px 0",
          minWidth: 160,
          boxShadow: shadows.glassElevated,
          zIndex: 9999
        } as React.CSSProperties}>
          <button
            className="ob-dropdown-item"
            style={styles.ctxItem}
            onClick={() => {
              const gid = contextMenu.tab.groupId;
              if (pinnedTabs.has(gid)) onUnpinTab(gid); else onPinTab(gid);
              setContextMenu(null);
            }}
          >
            {pinnedTabs.has(contextMenu.tab.groupId) ? "Unpin Tab" : "Pin Tab"}
          </button>
          <div style={{ height: 1, background: colors.borderSubtle, margin: "3px 0" }} />
          <button
            className="ob-dropdown-item"
            style={styles.ctxItem}
            onClick={() => { onCloseTab(contextMenu.tab); setContextMenu(null); }}
          >
            Close Tab
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  tabBar: {
    display: "flex", alignItems: "center", gap: 8,
    padding: "10px 10px 0",
    background: "transparent",
    WebkitAppRegion: "drag",
  } as React.CSSProperties,
  headerTabs: {
    display: "flex", alignItems: "center", gap: 6,
    overflowX: "auto", flex: 1, WebkitAppRegion: "no-drag"
  } as React.CSSProperties,
  iconButton: {
    ...glass.control, color: colors.textSecondary, border: `1px solid ${colors.borderControl}`,
    borderRadius: radii.md, minWidth: 30, height: 30,
    display: "grid", placeItems: "center", cursor: "pointer", fontSize: "0.88rem"
  } as React.CSSProperties,
  headerTabWrap: {
    display: "flex", alignItems: "center", minWidth: 100, maxWidth: 200,
    borderRadius: radii.md, background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.06)", color: colors.textSecondary
  },
  headerTabWrapPinned: {
    minWidth: 36, maxWidth: 36
  },
  headerTabWrapActive: {
    ...glass.emerald,
    backdropFilter: "blur(16px) saturate(180%)",
    WebkitBackdropFilter: "blur(16px) saturate(180%)",
    borderRadius: radii.md,
    color: colors.textWhite,
    boxShadow: shadows.glassSubtle
  } as React.CSSProperties,
  headerTabInner: {
    flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 7,
    background: "transparent", border: "none", color: "inherit",
    padding: "8px 6px 8px 10px", cursor: "pointer", fontSize: "0.82rem"
  },
  headerTabDot: { width: 6, height: 6, borderRadius: "50%", background: colors.emerald, flexShrink: 0 },
  headerTabTitle: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  headerTabClose: {
    width: 22, height: 22, marginRight: 5, borderRadius: 5,
    background: "transparent", border: "none",
    cursor: "pointer", fontSize: "0.72rem", display: "grid", placeItems: "center"
  },
  addTabButton: {
    ...glass.control, width: 28, height: 28, borderRadius: 7,
    border: `1px solid ${colors.borderControl}`,
    color: colors.textSecondary, cursor: "pointer", fontSize: "1rem"
  } as React.CSSProperties,
  ctxItem: {
    display: "block", width: "100%", background: "none", border: "none",
    color: colors.textPrimary, fontSize: "0.82rem", padding: "7px 14px",
    textAlign: "left" as const, cursor: "pointer", borderRadius: 0
  }
};
