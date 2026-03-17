import React, { useCallback, useRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { TaskRun } from "@openbrowse/contracts";
import type { BrowserShellTabDescriptor } from "../../../shared/runtime";
import { colors, radii, glass, shadows } from "../../styles/tokens";
import { TAB_GROUP_COLORS, type TabGroupDef } from "../../hooks/useBrowserTabs";

interface Props {
  shellTabs: BrowserShellTabDescriptor[];
  activeBrowserTab: BrowserShellTabDescriptor | null;
  runs: TaskRun[];
  tabFavicons: Record<string, string>;
  pinnedTabs: Set<string>;
  sidebarVisible: boolean;
  mainPanel: string;
  tabGroups: TabGroupDef[];
  groupAssignments: Record<string, string>;
  onSelectTab: (tab: BrowserShellTabDescriptor) => void;
  onCloseTab: (tab: BrowserShellTabDescriptor) => void;
  onNewTab: () => void;
  onToggleSidebar: () => void;
  onPinTab: (groupId: string) => void;
  onUnpinTab: (groupId: string) => void;
  onDuplicateTab: (groupId: string) => void;
  onMoveTab: (fromGroupId: string, toGroupId: string) => void;
  onCreateTabGroup: (tabGroupId: string) => void;
  onAddTabToGroup: (tabGroupId: string, tgId: string) => void;
  onRemoveTabFromGroup: (tabGroupId: string) => void;
  onRenameTabGroup: (tgId: string, name: string) => void;
  onSetTabGroupColor: (tgId: string, colorId: string) => void;
  onToggleCollapseTabGroup: (tgId: string) => void;
  onDeleteTabGroup: (tgId: string) => void;
}

function getGroupColor(colorId: string): string {
  return TAB_GROUP_COLORS.find(c => c.id === colorId)?.value ?? TAB_GROUP_COLORS[0].value;
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
    tabGroups, groupAssignments,
    onSelectTab, onCloseTab, onNewTab, onToggleSidebar, onPinTab, onUnpinTab, onDuplicateTab, onMoveTab,
    onCreateTabGroup, onAddTabToGroup, onRemoveTabFromGroup,
    onRenameTabGroup, onSetTabGroupColor, onToggleCollapseTabGroup, onDeleteTabGroup
  } = props;

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tab: BrowserShellTabDescriptor } | null>(null);
  const [groupContextMenu, setGroupContextMenu] = useState<{ x: number; y: number; group: TabGroupDef } | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
  const [dropTargetGroupId, setDropTargetGroupId] = useState<string | null>(null);

  // Close context menus on any click
  useEffect(() => {
    if (!contextMenu && !groupContextMenu) return;
    const close = () => { setContextMenu(null); setGroupContextMenu(null); };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu, groupContextMenu]);

  const tabsContainerRef = useRef<HTMLDivElement | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);
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

  // Focus input when editing a group name
  useEffect(() => {
    if (editingGroupId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingGroupId]);

  // Build render items: interleave group headers with tabs
  const renderItems: Array<
    | { type: "group-header"; group: TabGroupDef; tabCount: number }
    | { type: "tab"; tab: BrowserShellTabDescriptor }
  > = [];

  let lastGroupId: string | undefined;
  for (const tab of shellTabs) {
    const tgId = groupAssignments[tab.groupId];
    const group = tgId ? tabGroups.find(g => g.id === tgId) : undefined;

    if (group && group.id !== lastGroupId) {
      const tabCount = shellTabs.filter(t => groupAssignments[t.groupId] === group.id).length;
      renderItems.push({ type: "group-header", group, tabCount });
      lastGroupId = group.id;
    } else if (!group) {
      lastGroupId = undefined;
    }

    // Skip tabs in collapsed groups
    if (group?.collapsed) continue;

    renderItems.push({ type: "tab", tab });
  }

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
        {renderItems.map((item) => {
          if (item.type === "group-header") {
            const { group, tabCount } = item;
            const groupColor = getGroupColor(group.colorId);
            return (
              <div
                key={`gh-${group.id}`}
                style={{
                  display: "flex", alignItems: "center", gap: 0,
                  cursor: "pointer", flexShrink: 0,
                  WebkitAppRegion: "no-drag",
                } as React.CSSProperties}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleCollapseTabGroup(group.id);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setGroupContextMenu({ x: e.clientX, y: e.clientY, group });
                }}
              >
                <div style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "4px 8px",
                  borderRadius: 6,
                  background: `${groupColor}22`,
                  border: `1px solid ${groupColor}44`,
                  fontSize: "0.75rem",
                  color: groupColor,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}>
                  <span style={{
                    display: "inline-block",
                    width: 0, height: 0,
                    borderLeft: "4px solid currentColor",
                    borderTop: "3px solid transparent",
                    borderBottom: "3px solid transparent",
                    transform: group.collapsed ? "rotate(0deg)" : "rotate(90deg)",
                    transition: "transform 0.15s ease",
                  }} />
                  {editingGroupId === group.id ? (
                    <input
                      ref={editInputRef}
                      value={editingGroupName}
                      onChange={(e) => setEditingGroupName(e.target.value)}
                      onBlur={() => {
                        onRenameTabGroup(group.id, editingGroupName);
                        setEditingGroupId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          onRenameTabGroup(group.id, editingGroupName);
                          setEditingGroupId(null);
                        }
                        if (e.key === "Escape") setEditingGroupId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        background: "transparent", border: "none", outline: "none",
                        color: "inherit", fontSize: "inherit", fontWeight: "inherit",
                        width: Math.max(20, editingGroupName.length * 7),
                        padding: 0,
                      }}
                    />
                  ) : (
                    group.name || `${tabCount} tabs`
                  )}
                  {group.collapsed && (
                    <span style={{
                      background: groupColor,
                      color: "#000",
                      borderRadius: 8,
                      padding: "0 5px",
                      fontSize: "0.68rem",
                      fontWeight: 700,
                      marginLeft: 2,
                      lineHeight: "15px",
                    }}>{tabCount}</span>
                  )}
                </div>
              </div>
            );
          }

          // tab item
          const { tab } = item;
          const active = mainPanel === "browser" && activeBrowserTab?.groupId === tab.groupId;
          const pinned = pinnedTabs.has(tab.groupId);
          const dot = getTabStatusDot(tab, runs);
          const favicon = tabFavicons[tab.id];
          const tgId = groupAssignments[tab.groupId];
          const tg = tgId ? tabGroups.find(g => g.id === tgId) : undefined;
          const groupColor = tg ? getGroupColor(tg.colorId) : undefined;
          return (
            <div
              key={tab.groupId}
              className="ob-tab"
              draggable
              style={{
                ...styles.headerTabWrap,
                ...(active ? styles.headerTabWrapActive : {}),
                ...(pinned ? styles.headerTabWrapPinned : {}),
                ...(groupColor && !active ? {
                  borderBottom: `2px solid ${groupColor}`,
                } : {}),
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
                {favicon && !dot.animate ? (
                  <img src={favicon} alt="" width={16} height={16}
                    style={{ flexShrink: 0, borderRadius: 2 }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <span style={{
                    ...styles.headerTabDot, background: dot.color,
                    ...(dot.animate ? { width: 8, height: 8, animation: "ob-pulse 1.5s ease-in-out infinite" } : {})
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

      {/* Tab context menu */}
      {contextMenu && createPortal(
        <div style={{
          position: "fixed",
          top: contextMenu.y,
          left: contextMenu.x,
          ...glass.panel,
          border: `1px solid ${colors.borderGlass}`,
          borderRadius: 8,
          padding: "4px 0",
          minWidth: 180,
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
          <button
            className="ob-dropdown-item"
            style={styles.ctxItem}
            onClick={() => { onDuplicateTab(contextMenu.tab.groupId); setContextMenu(null); }}
          >
            Duplicate Tab
          </button>
          <div style={{ height: 1, background: colors.borderSubtle, margin: "3px 0" }} />
          {/* Tab grouping options */}
          {!groupAssignments[contextMenu.tab.groupId] && (
            <button
              className="ob-dropdown-item"
              style={styles.ctxItem}
              onClick={() => {
                onCreateTabGroup(contextMenu.tab.groupId);
                setContextMenu(null);
              }}
            >
              Add to New Group
            </button>
          )}
          {!groupAssignments[contextMenu.tab.groupId] && tabGroups.length > 0 && (
            <>
              {tabGroups.map(tg => (
                <button
                  key={tg.id}
                  className="ob-dropdown-item"
                  style={styles.ctxItem}
                  onClick={() => {
                    onAddTabToGroup(contextMenu.tab.groupId, tg.id);
                    setContextMenu(null);
                  }}
                >
                  <span style={{
                    display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                    background: getGroupColor(tg.colorId), marginRight: 8, verticalAlign: "middle"
                  }} />
                  Add to "{tg.name || "Group"}"
                </button>
              ))}
            </>
          )}
          {groupAssignments[contextMenu.tab.groupId] && (
            <button
              className="ob-dropdown-item"
              style={styles.ctxItem}
              onClick={() => {
                onRemoveTabFromGroup(contextMenu.tab.groupId);
                setContextMenu(null);
              }}
            >
              Remove from Group
            </button>
          )}
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

      {/* Group header context menu */}
      {groupContextMenu && createPortal(
        <div style={{
          position: "fixed",
          top: groupContextMenu.y,
          left: groupContextMenu.x,
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
            onClick={(e) => {
              e.stopPropagation();
              setEditingGroupId(groupContextMenu.group.id);
              setEditingGroupName(groupContextMenu.group.name);
              setGroupContextMenu(null);
            }}
          >
            Rename Group
          </button>
          <div style={{
            padding: "6px 14px",
            display: "flex", gap: 6, flexWrap: "wrap"
          }}>
            {TAB_GROUP_COLORS.map(c => (
              <button
                key={c.id}
                title={c.label}
                style={{
                  width: 16, height: 16, borderRadius: "50%",
                  background: c.value, border: groupContextMenu.group.colorId === c.id
                    ? "2px solid white" : "1px solid rgba(255,255,255,0.2)",
                  cursor: "pointer", padding: 0,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSetTabGroupColor(groupContextMenu.group.id, c.id);
                  setGroupContextMenu(null);
                }}
              />
            ))}
          </div>
          <div style={{ height: 1, background: colors.borderSubtle, margin: "3px 0" }} />
          <button
            className="ob-dropdown-item"
            style={styles.ctxItem}
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapseTabGroup(groupContextMenu.group.id);
              setGroupContextMenu(null);
            }}
          >
            {groupContextMenu.group.collapsed ? "Expand Group" : "Collapse Group"}
          </button>
          <button
            className="ob-dropdown-item"
            style={{ ...styles.ctxItem, color: colors.statusFailed }}
            onClick={(e) => {
              e.stopPropagation();
              onDeleteTabGroup(groupContextMenu.group.id);
              setGroupContextMenu(null);
            }}
          >
            Ungroup All
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
