import { useEffect, useMemo, useRef } from "react";
import type { TaskRun, WorkflowEvent } from "@openbrowse/contracts";
import type { BrowserShellTabDescriptor, RuntimeDescriptor } from "../../shared/runtime";

interface Props {
  tabs: BrowserShellTabDescriptor[];
  runs: TaskRun[];
  logs: WorkflowEvent[];
  selectedRunId: string | null;
  selectedGroupId: string | null;
  foregroundRunId: string | null;
  runtime: RuntimeDescriptor | null;
  plannerModel: string | null;
  onSelectRun: (runId: string) => void;
  onSelectGroup: (groupId: string | null) => void;
  onFocusRun: (run: TaskRun) => void;
  onCloseGroup: (groupId: string) => Promise<void> | void;
  onHideBrowser: () => void;
  onRefresh: () => void;
}

const statusColors: Record<string, string> = {
  queued: "#94a3b8",
  running: "#22c55e",
  suspended_for_clarification: "#eab308",
  suspended_for_approval: "#f97316",
  completed: "#6366f1",
  failed: "#ef4444",
  cancelled: "#6b7280"
};

export function BrowserPanel({
  tabs,
  runs,
  logs,
  selectedRunId,
  selectedGroupId,
  foregroundRunId,
  runtime,
  plannerModel,
  onSelectRun,
  onSelectGroup,
  onFocusRun,
  onCloseGroup,
  onHideBrowser,
  onRefresh
}: Props) {
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const activeTab = useMemo(() => {
    const bySelectedGroup = selectedGroupId ? tabs.find((tab) => tab.groupId === selectedGroupId) : null;
    if (bySelectedGroup) {
      return bySelectedGroup;
    }

    const byForeground = foregroundRunId ? tabs.find((tab) => tab.groupId === foregroundRunId) : null;
    if (byForeground) {
      return byForeground;
    }

    return tabs[0] ?? null;
  }, [foregroundRunId, selectedGroupId, tabs]);

  const currentRun = useMemo(() => {
    if (activeTab) {
      const byActiveTab = runs.find((run) => run.id === activeTab.runId);
      if (byActiveTab) {
        return byActiveTab;
      }
    }

    if (selectedRunId) {
      return runs.find((run) => run.id === selectedRunId) ?? null;
    }

    return null;
  }, [activeTab, runs, selectedRunId]);

  useEffect(() => {
    if (!activeTab) {
      void window.openbrowse.hideBrowserSession();
      void window.openbrowse.clearBrowserViewport();
      return;
    }

    onSelectGroup(activeTab.groupId);
    if (currentRun && currentRun.id !== selectedRunId) {
      onSelectRun(currentRun.id);
    }

    const showAndBindViewport = async () => {
      await window.openbrowse.showBrowserSession(activeTab.id);

      const element = viewportRef.current;
      if (!element) {
        return;
      }

      const rect = element.getBoundingClientRect();
      await window.openbrowse.setBrowserViewport({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
      });
    };

    void showAndBindViewport();

    const updateViewport = async () => {
      const element = viewportRef.current;
      if (!element) {
        return;
      }

      const rect = element.getBoundingClientRect();
      await window.openbrowse.setBrowserViewport({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
      });
    };

    const observer = new ResizeObserver(() => void updateViewport());
    if (viewportRef.current) {
      observer.observe(viewportRef.current);
    }
    window.addEventListener("resize", updateViewport);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateViewport);
    };
  }, [activeTab, currentRun, onRefresh, onSelectGroup, onSelectRun, selectedRunId]);

  const handleSelectTab = async (tab: BrowserShellTabDescriptor) => {
    onSelectGroup(tab.groupId);
    const run = runs.find((candidate) => candidate.id === tab.runId);
    if (run) {
      onFocusRun(run);
    } else {
      await window.openbrowse.showBrowserSession(tab.id);
      onRefresh();
    }
  };

  const handleHide = async () => {
    await window.openbrowse.hideBrowserSession();
    await window.openbrowse.clearBrowserViewport();
    onHideBrowser();
  };

  if (tabs.length === 0) {
    return (
      <div style={styles.emptyState}>
        <p style={styles.emptyTitle}>No browser groups are active.</p>
        <p style={styles.emptyHint}>
          Start a task to create a dedicated browser group. Each run now owns its own browser session.
        </p>
      </div>
    );
  }

  return (
    <section style={styles.workspace}>
      <div style={styles.groupBar}>
        <div style={styles.groupList}>
          {tabs.map((tab) => {
            const isActive = activeTab?.groupId === tab.groupId;
            return (
              <div
                key={tab.groupId}
                style={{
                  ...styles.groupChip,
                  ...(isActive ? styles.groupChipActive : {})
                }}
              >
                <button onClick={() => void handleSelectTab(tab)} style={styles.groupButton}>
                  <span
                    style={{
                      ...styles.statusDot,
                      background: statusColors[tab.status] ?? "#6b7280"
                    }}
                  />
                  <span style={styles.groupTitle}>{tab.title}</span>
                  <span style={styles.groupMeta}>{tab.isBackground ? "background" : "foreground"}</span>
                </button>
                {tab.closable && (
                  <button
                    onClick={() => void onCloseGroup(tab.groupId)}
                    style={styles.closeButton}
                    aria-label={`Close ${tab.title}`}
                  >
                    x
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {activeTab && (
          <button onClick={handleHide} style={styles.hideButton}>
            Hide Browser
          </button>
        )}
      </div>

      <div style={styles.activeLayout}>
        <div style={styles.viewStage}>
          <div style={styles.viewportFrame}>
            <div style={styles.viewportChrome}>
              <span style={styles.viewportDot} />
              <span style={styles.viewportDot} />
              <span style={styles.viewportDot} />
              <span style={styles.viewportTitle}>{activeTab?.title ?? "OpenBrowse Session"}</span>
            </div>
            <div ref={viewportRef} style={styles.viewportSurface}>
              <div style={styles.viewportPlaceholder}>
                Native browser view mounted here.
              </div>
            </div>
          </div>
        </div>

        <aside style={styles.debugPanel}>
          <div style={styles.debugHeader}>
            <strong>Task Debug</strong>
            <span style={styles.debugBadge}>{runtime?.planner.mode ?? "loading"}</span>
          </div>

          <div style={styles.debugBlock}>
            <div style={styles.debugLabel}>Planner</div>
            <div style={styles.debugText}>{plannerModel ?? "Not configured"}</div>
            <div style={styles.debugHint}>{runtime?.planner.detail ?? "Planner status loading..."}</div>
          </div>

          <div style={styles.debugBlock}>
            <div style={styles.debugLabel}>Storage</div>
            <div style={styles.debugText}>{runtime?.storage.mode ?? "loading"}</div>
            <div style={styles.debugHint}>{runtime?.storage.detail ?? "Storage status loading..."}</div>
          </div>

          <div style={styles.debugBlock}>
            <div style={styles.debugLabel}>Active Group</div>
            {activeTab ? (
              <>
                <div style={styles.debugText}>{activeTab.title}</div>
                <div style={styles.debugHint}>run: {activeTab.runId}</div>
                <div style={styles.debugHint}>status: {activeTab.status}</div>
                <div style={styles.debugHint}>source: {activeTab.source}</div>
                <div style={styles.debugHint}>url: {activeTab.url}</div>
              </>
            ) : (
              <div style={styles.debugHint}>No active browser group.</div>
            )}
          </div>

          <div style={styles.debugBlock}>
            <div style={styles.debugLabel}>Current Run</div>
            {currentRun ? (
              <>
                <div style={styles.debugText}>{currentRun.goal}</div>
                <div style={styles.debugHint}>status: {currentRun.status}</div>
                <div style={styles.debugHint}>
                  summary: {currentRun.checkpoint.summary || "No summary yet"}
                </div>
              </>
            ) : (
              <div style={styles.debugHint}>No run selected for this group.</div>
            )}
          </div>

          <div style={styles.debugBlock}>
            <div style={styles.debugLabel}>Recent Events</div>
            {logs.length === 0 ? (
              <div style={styles.debugHint}>No workflow events yet.</div>
            ) : (
              <div style={styles.eventList}>
                {logs.slice(-8).reverse().map((event) => (
                  <div key={event.id} style={styles.eventItem}>
                    <div style={styles.eventType}>{event.type}</div>
                    <div style={styles.eventSummary}>{event.summary}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  workspace: {
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr)",
    gap: 14,
    height: "100%",
    minHeight: 0
  },
  emptyState: {
    display: "grid",
    placeItems: "center",
    height: "100%",
    minHeight: 360,
    border: "1px dashed #d9c7ac",
    borderRadius: 14,
    background: "#f8f3ea"
  },
  emptyTitle: {
    margin: 0,
    color: "#3f372d",
    fontSize: "1rem",
    fontWeight: 600
  },
  emptyHint: {
    margin: 0,
    color: "#7c735f",
    fontSize: "0.88rem"
  },
  groupBar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    minWidth: 0
  },
  groupList: {
    display: "flex",
    gap: 8,
    minWidth: 0,
    overflowX: "auto" as const,
    paddingBottom: 2
  },
  groupChip: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    border: "1px solid #d9c7ac",
    borderRadius: 10,
    background: "#efe5d3",
    padding: "4px 6px 4px 10px",
    minWidth: 0
  },
  groupChipActive: {
    background: "#1f4d3f",
    borderColor: "#1f4d3f"
  },
  groupButton: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    border: "none",
    background: "transparent",
    padding: 0,
    margin: 0,
    cursor: "pointer",
    color: "inherit",
    minWidth: 0
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    display: "inline-block",
    flexShrink: 0
  },
  groupTitle: {
    maxWidth: 240,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    fontSize: "0.88rem",
    fontWeight: 600
  },
  groupMeta: {
    fontSize: "0.72rem",
    textTransform: "uppercase" as const,
    opacity: 0.72
  },
  closeButton: {
    border: "none",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
    fontSize: "0.8rem",
    lineHeight: 1,
    padding: "2px 4px"
  },
  hideButton: {
    marginLeft: "auto",
    background: "#b91c1c",
    color: "#fffdf9",
    border: "none",
    borderRadius: 6,
    padding: "8px 14px",
    cursor: "pointer",
    fontSize: "0.82rem",
    flexShrink: 0
  },
  activeLayout: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 340px",
    gap: 16,
    alignItems: "stretch",
    minHeight: 0,
    height: "100%"
  },
  viewStage: {
    minWidth: 0,
    minHeight: 0,
    height: "100%"
  },
  viewportFrame: {
    background: "#f6efe2",
    border: "1px solid #d9c7ac",
    borderRadius: 12,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column" as const,
    height: "100%",
    minHeight: 420
  },
  viewportChrome: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "0 14px",
    height: 42,
    flexShrink: 0,
    borderBottom: "1px solid #ddceb6",
    background: "#efe3cf"
  },
  viewportDot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: "#c9b79c",
    display: "inline-block"
  },
  viewportTitle: {
    marginLeft: 8,
    fontSize: "0.82rem",
    color: "#675d50",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const
  },
  viewportSurface: {
    position: "relative" as const,
    flex: 1,
    minHeight: 0,
    height: "100%",
    background: "#1a1a1a"
  },
  viewportPlaceholder: {
    position: "absolute" as const,
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#7c735f",
    fontSize: "0.9rem",
    pointerEvents: "none" as const
  },
  debugPanel: {
    background: "#fff9f0",
    border: "1px solid #d9c7ac",
    borderRadius: 12,
    padding: 16,
    display: "grid",
    gap: 14,
    overflow: "auto" as const,
    minHeight: 0
  },
  debugHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  debugBadge: {
    background: "#e7efe9",
    color: "#1f4d3f",
    borderRadius: 999,
    padding: "4px 10px",
    fontSize: "0.72rem",
    textTransform: "uppercase" as const
  },
  debugBlock: {
    display: "grid",
    gap: 6
  },
  debugLabel: {
    fontSize: "0.78rem",
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: "#7c735f"
  },
  debugText: {
    fontSize: "0.95rem",
    color: "#2f2821",
    fontWeight: 600
  },
  debugHint: {
    fontSize: "0.82rem",
    color: "#6d6253",
    lineHeight: 1.5
  },
  eventList: {
    display: "grid",
    gap: 8
  },
  eventItem: {
    border: "1px solid #e8dcc8",
    borderRadius: 8,
    background: "#f8f1e4",
    padding: "8px 10px"
  },
  eventType: {
    fontSize: "0.72rem",
    textTransform: "uppercase" as const,
    color: "#7c735f"
  },
  eventSummary: {
    marginTop: 3,
    fontSize: "0.84rem",
    color: "#3f372d",
    lineHeight: 1.4
  }
};
