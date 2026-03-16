import React, { useCallback, useRef, useEffect, useState } from "react";
import type { TaskRun } from "@openbrowse/contracts";
import type { BrowserShellTabDescriptor } from "../../../shared/runtime";

interface Props {
  shellTabs: BrowserShellTabDescriptor[];
  activeBrowserTab: BrowserShellTabDescriptor | null;
  runs: TaskRun[];
  tabFavicons: Record<string, string>;
  sidebarVisible: boolean;
  mainPanel: string;
  onSelectTab: (tab: BrowserShellTabDescriptor) => void;
  onCloseTab: (tab: BrowserShellTabDescriptor) => void;
  onNewTab: () => void;
  onToggleSidebar: () => void;
}

function getTabStatusDot(tab: BrowserShellTabDescriptor, runs: TaskRun[]): { color: string; animate: boolean; title: string } {
  const run = runs.find((r) => r.id === tab.runId);
  if (!run) return { color: "#8b5cf6", animate: false, title: "Standalone tab" };
  switch (run.status) {
    case "running": return { color: "#22c55e", animate: true, title: "Agent running" };
    case "suspended_for_clarification":
    case "suspended_for_approval": return { color: "#f59e0b", animate: false, title: "Awaiting input" };
    case "completed": return { color: "#22c55e", animate: false, title: "Completed" };
    case "failed":
    case "cancelled": return { color: "#ef4444", animate: false, title: "Failed" };
    default: return { color: "#8b5cf6", animate: false, title: run.status };
  }
}

export function TabBar(props: Props) {
  const {
    shellTabs, activeBrowserTab, runs, tabFavicons, sidebarVisible, mainPanel,
    onSelectTab, onCloseTab, onNewTab, onToggleSidebar
  } = props;

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
          const dot = getTabStatusDot(tab, runs);
          const favicon = tabFavicons[tab.id];
          return (
            <div key={tab.groupId} style={{ ...styles.headerTabWrap, ...(active ? styles.headerTabWrapActive : {}) }}>
              <button
                onClick={() => onSelectTab(tab)}
                style={{ ...styles.headerTabInner, WebkitAppRegion: "no-drag" } as React.CSSProperties}
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
                <span style={styles.headerTabTitle}>{tab.title}</span>
              </button>
              <button
                style={{ ...styles.headerTabClose, WebkitAppRegion: "no-drag" } as React.CSSProperties}
                onClick={() => onCloseTab(tab)}
              >
                ✕
              </button>
            </div>
          );
        })}
        <button
          style={{ ...styles.addTabButton, WebkitAppRegion: "no-drag" } as React.CSSProperties}
          onClick={onNewTab}
        >
          +
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  tabBar: {
    display: "flex", alignItems: "center", gap: 8,
    padding: "10px 10px 0", background: "#0f0f18",
    WebkitAppRegion: "drag", borderBottom: "1px solid #1f2030"
  } as React.CSSProperties,
  headerTabs: {
    display: "flex", alignItems: "center", gap: 6,
    overflowX: "auto", flex: 1, WebkitAppRegion: "no-drag"
  } as React.CSSProperties,
  iconButton: {
    background: "#1a1a26", color: "#cbd5e1", border: "1px solid #2a2a3e",
    borderRadius: 9, minWidth: 30, height: 30,
    display: "grid", placeItems: "center", cursor: "pointer", fontSize: "0.88rem"
  },
  headerTabWrap: {
    display: "flex", alignItems: "center", minWidth: 100, maxWidth: 200,
    borderRadius: "9px 9px 0 0", background: "#0a0a12",
    border: "1px solid #1f2030", borderBottom: "none", color: "#9090a8"
  },
  headerTabWrapActive: {
    background: "#16162a", borderColor: "#4a4a7a",
    borderTopColor: "#8b5cf6", color: "#ffffff"
  },
  headerTabInner: {
    flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 7,
    background: "transparent", border: "none", color: "inherit",
    padding: "8px 6px 8px 10px", cursor: "pointer", fontSize: "0.82rem"
  },
  headerTabDot: { width: 6, height: 6, borderRadius: "50%", background: "#8b5cf6", flexShrink: 0 },
  headerTabTitle: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  headerTabClose: {
    width: 22, height: 22, marginRight: 5, borderRadius: 5,
    background: "transparent", border: "none", color: "#9090a8",
    cursor: "pointer", fontSize: "0.72rem", display: "grid", placeItems: "center"
  },
  addTabButton: {
    width: 28, height: 28, borderRadius: 7,
    background: "#141422", border: "1px solid #2a2a3e",
    color: "#cbd5e1", cursor: "pointer", fontSize: "1rem"
  }
};
