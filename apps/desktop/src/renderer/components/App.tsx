import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BrowserProfile, TaskRun, WorkflowEvent } from "@openbrowse/contracts";
import type { ReplayStep } from "@openbrowse/observability";
import type {
  BrowserShellTabDescriptor,
  RecoverySummary,
  RuntimeDescriptor,
  RuntimeSettings
} from "../../shared/runtime";
import { AgentActivityBar } from "./AgentActivityBar";
import { BrowserPanel } from "./BrowserPanel";
import { ManagementPanel, type ManagementTab } from "./ManagementPanel";
import { RemoteQuestions } from "./RemoteQuestions";
import { useRuntimeStore } from "../store/useRuntimeStore";

declare global {
  interface Window {
    openbrowse: {
      version: string;
      startTask: (intent: unknown) => Promise<TaskRun>;
      resumeTask: (message: unknown) => Promise<TaskRun | null>;
      cancelTask: (runId: string) => Promise<TaskRun | null>;
      listRuns: () => Promise<TaskRun[]>;
      getRun: (runId: string) => Promise<TaskRun | null>;
      listProfiles: () => Promise<BrowserProfile[]>;
      listLogs: (runId: string) => Promise<WorkflowEvent[]>;
      replayLogs: (runId: string) => Promise<ReplayStep[]>;
      listTabs: () => Promise<BrowserShellTabDescriptor[]>;
      describeRuntime: () => Promise<RuntimeDescriptor>;
      getLastRecoveryReport: () => Promise<RecoverySummary | null>;
      getSettings: () => Promise<RuntimeSettings>;
      saveSettings: (
        settings: RuntimeSettings
      ) => Promise<{ settings: RuntimeSettings; descriptor: RuntimeDescriptor }>;
      listDemos: () => Promise<
        Array<{ id: string; label: string; category: string; description: string; supportsWatch: boolean }>
      >;
      runDemo: (demoId: string) => Promise<TaskRun>;
      watchDemo: (demoId: string, intervalMinutes: number) => Promise<string>;
      listTaskPacks: () => Promise<
        Array<{
          id: string;
          label: string;
          category: string;
          description: string;
          requiresLivePlanner: boolean;
          available: boolean;
          unavailableReason?: string;
        }>
      >;
      runTaskPack: (packId: string) => Promise<TaskRun>;
      showBrowserSession: (sessionId: string) => Promise<unknown>;
      hideBrowserSession: () => Promise<unknown>;
      getActiveBrowserSession: () => Promise<string | null>;
      setBrowserViewport: (bounds: { x: number; y: number; width: number; height: number }) => Promise<unknown>;
      clearBrowserViewport: () => Promise<unknown>;
      closeBrowserGroup: (groupId: string) => Promise<TaskRun | null>;
      onRuntimeEvent: (callback: (event: unknown) => void) => () => void;
      browserNewTab: (url?: string) => Promise<BrowserShellTabDescriptor>;
      browserNavigate: (sessionId: string, url: string) => Promise<void>;
      browserBack: (sessionId: string) => Promise<void>;
      browserForward: (sessionId: string) => Promise<void>;
      browserReload: (sessionId: string) => Promise<void>;
      browserNavState: (sessionId: string) => Promise<{
        canGoBack: boolean;
        canGoForward: boolean;
        url: string;
        title: string;
      } | null>;
    };
  }
}

type MainPanel = "home" | "browser";
type ChatMessage = {
  id: string;
  role: "user" | "agent";
  content: string;
  tone?: "normal" | "success" | "warning" | "error" | "action";
  timestamp: string;
};

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "about:blank";
  if (/^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed)) return trimmed;
  if (/^about:|^data:|^file:/i.test(trimmed)) return trimmed;
  if (!trimmed.includes(" ") && (trimmed.includes(".") || trimmed.startsWith("localhost"))) {
    return `https://${trimmed}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

export function App() {
  const [mainPanel, setMainPanel] = useState<MainPanel>("home");
  const [managementOpen, setManagementOpen] = useState(false);
  const [managementTab, setManagementTab] = useState<ManagementTab>("config");
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const [addressInput, setAddressInput] = useState("");
  const [addressEditing, setAddressEditing] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "agent",
      content: "Hello. I can browse, summarize, and keep long-running tasks alive. Tell me what to do.",
      timestamp: new Date().toISOString()
    }
  ]);

  const {
    errorNotice,
    focusRun,
    foregroundRunEvents,
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
  } = useRuntimeStore();

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

  const handleCancelRun = useCallback(
    async (runId: string) => {
      await window.openbrowse.cancelTask(runId);
      await refresh();
    },
    [refresh]
  );

  // Keep address bar in sync with active tab URL when not editing.
  useEffect(() => {
    if (!addressEditing) {
      setAddressInput(mainPanel === "browser" && activeBrowserTab ? activeBrowserTab.url : "");
    }
  }, [activeBrowserTab?.url, mainPanel, addressEditing]);

  // Scroll chat to bottom when messages change.
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, suspendedRuns]);

  useEffect(() => {
    document.documentElement.classList.add("dark");
    document.body.style.margin = "0";
    document.body.style.background = "#0a0a12";
    // Inject pulse animation for agent tab indicators and activity bar.
    const style = document.createElement("style");
    style.textContent = "@keyframes ob-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }";
    document.head.appendChild(style);
    return () => { style.remove(); };
  }, []);

  useEffect(() => {
    if (mainPanel !== "browser") {
      void window.openbrowse.hideBrowserSession();
      void window.openbrowse.clearBrowserViewport();
    }
  }, [mainPanel]);

  useEffect(() => {
    if (!notice) return;
    setMessages((current) =>
      current.some((m) => m.id === `notice:${notice}`)
        ? current
        : [
            ...current,
            {
              id: `notice:${notice}`,
              role: "agent",
              content: notice,
              tone: "success",
              timestamp: new Date().toISOString()
            }
          ]
    );
  }, [notice]);

  useEffect(() => {
    if (!errorNotice) return;
    setMessages((current) =>
      current.some((m) => m.id === `error:${errorNotice}`)
        ? current
        : [
            ...current,
            {
              id: `error:${errorNotice}`,
              role: "agent",
              content: errorNotice,
              tone: "error",
              timestamp: new Date().toISOString()
            }
          ]
    );
  }, [errorNotice]);

  // Step 5: Stream agent actions on the active tab to the chat.
  useEffect(() => {
    if (foregroundRunEvents.length === 0) return;
    setMessages((current) => {
      let changed = false;
      let next = current;
      for (const evt of foregroundRunEvents) {
        const msgId = `action:${evt.id}`;
        if (!next.some((m) => m.id === msgId)) {
          if (!changed) {
            next = [...next];
            changed = true;
          }
          next.push({
            id: msgId,
            role: "agent",
            content: evt.summary,
            tone: "action",
            timestamp: evt.createdAt
          });
        }
      }
      return changed ? next : current;
    });
  }, [foregroundRunEvents]);

  const handleSidebarDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      setIsDragging(true);
      document.body.style.userSelect = "none";
      const startX = e.clientX;
      const startWidth = sidebarWidth;
      const onMove = (ev: MouseEvent) => {
        const next = Math.max(240, Math.min(520, startWidth + (ev.clientX - startX)));
        setSidebarWidth(next);
      };
      const onUp = () => {
        isDraggingRef.current = false;
        setIsDragging(false);
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [sidebarWidth]
  );

  const openRunInBrowser = async (run: TaskRun) => {
    const next = focusRun(run, { openBrowser: true });
    if (run.checkpoint.browserSessionId || next.openBrowser) {
      setMainPanel("browser");
    }
  };

  const handleNewTab = async (url?: string) => {
    const tab = await window.openbrowse.browserNewTab(url);
    setSelectedGroupId(tab.groupId);
    setForegroundRunId(tab.runId);
    setMainPanel("browser");
  };

  const handleNavigate = async (input: string) => {
    const url = normalizeUrl(input);
    if (activeBrowserTab && mainPanel === "browser") {
      await window.openbrowse.browserNavigate(activeBrowserTab.id, url);
    } else {
      await handleNewTab(url);
    }
  };

  const submitChatTask = async () => {
    const goal = chatInput.trim();
    if (!goal || chatBusy) return;

    setMessages((current) => [
      ...current,
      {
        id: `user:${Date.now()}`,
        role: "user",
        content: goal,
        timestamp: new Date().toISOString()
      }
    ]);
    setChatInput("");

    if (!runtime) {
      setMessages((current) => [
        ...current,
        {
          id: `agent:runtime:${Date.now()}`,
          role: "agent",
          content: "Runtime is still loading. Wait a second and try again.",
          tone: "warning",
          timestamp: new Date().toISOString()
        }
      ]);
      return;
    }

    if (runtime.planner.mode !== "live") {
      setMessages((current) => [
        ...current,
        {
          id: `agent:planner:${Date.now()}`,
          role: "agent",
          content: "Freeform tasks need a live planner. Open Settings and add your Anthropic API key first.",
          tone: "warning",
          timestamp: new Date().toISOString()
        }
      ]);
      openManagement("config");
      return;
    }

    setChatBusy(true);
    try {
      const run = (await window.openbrowse.startTask({
        id: `task_${Date.now()}`,
        source: "desktop",
        goal,
        constraints: [],
        metadata: {}
      })) as TaskRun;
      await refresh();
      await openRunInBrowser(run);
      setMessages((current) => [
        ...current,
        {
          id: `agent:started:${run.id}`,
          role: "agent",
          content: `Started: ${run.goal}`,
          tone: "success",
          timestamp: new Date().toISOString()
        }
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMessages((current) => [
        ...current,
        {
          id: `agent:failed:${Date.now()}`,
          role: "agent",
          content: `Failed to start task: ${message}`,
          tone: "error",
          timestamp: new Date().toISOString()
        }
      ]);
    } finally {
      setChatBusy(false);
    }
  };

  const getTabStatusDot = useCallback(
    (tab: BrowserShellTabDescriptor): { color: string; animate: boolean; title: string } => {
      const run = runs.find((r) => r.id === tab.runId);
      if (!run) return { color: "#8b5cf6", animate: false, title: "Standalone tab" };
      switch (run.status) {
        case "running":
          return { color: "#22c55e", animate: true, title: "Agent running" };
        case "suspended_for_clarification":
        case "suspended_for_approval":
          return { color: "#f59e0b", animate: false, title: "Awaiting input" };
        case "completed":
          return { color: "#22c55e", animate: false, title: "Completed" };
        case "failed":
        case "cancelled":
          return { color: "#ef4444", animate: false, title: "Failed" };
        default:
          return { color: "#8b5cf6", animate: false, title: run.status };
      }
    },
    [runs]
  );

  const openManagement = (tab: ManagementTab) => {
    setManagementTab(tab);
    setManagementOpen(true);
  };

  const displayUrl = mainPanel === "browser" && activeBrowserTab ? activeBrowserTab.url : "";
  const isSecure = displayUrl.startsWith("https://");

  const runningCount = runs.filter((r) => r.status === "running").length;
  const waitingCount = suspendedRuns.length;

  return (
    <div style={styles.app}>
      {/* Agent workspace sidebar */}
      <aside
        style={{
          ...styles.sidebar,
          width: sidebarVisible ? sidebarWidth : 0,
          minWidth: sidebarVisible ? 240 : 0,
          overflow: "hidden",
          transition: isDragging ? "none" : "width 0.18s ease, min-width 0.18s ease"
        }}
      >
        {/* Traffic-light / title-bar drag zone.
            With titleBarStyle:"hiddenInset" + trafficLightPosition:{x:16,y:14} the
            macOS controls sit at ~(16,14) and span ~70px wide.  This 38px strip
            gives them a clean, unobstructed target and provides a reliable drag
            region for the window without needing content in the collision zone. */}
        <div style={styles.titleBarSpacer as React.CSSProperties} />

        {/* Sidebar header */}
        <div style={styles.sidebarHeader}>
          <div style={styles.brandMark}>✦</div>
          <div style={styles.brandInfo}>
            <div style={styles.brandName}>Agent Workspace</div>
            {(runningCount > 0 || waitingCount > 0) && (
              <div style={styles.statusRow}>
                {runningCount > 0 && (
                  <span style={{ ...styles.statusPip, color: "#22c55e" }}>
                    ● {runningCount} running
                  </span>
                )}
                {waitingCount > 0 && (
                  <span style={{ ...styles.statusPip, color: "#f59e0b" }}>
                    ◉ {waitingCount} waiting
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Conversation area — messages + inline pending questions */}
        <div style={styles.conversationArea}>
          {/* RunContextCard — shows active tab's agent run context */}
          {activeTabRun && (
            <div style={styles.runContextCard}>
              <div style={styles.runContextHeader}>
                <span
                  style={{
                    ...styles.runContextBadge,
                    background:
                      activeTabRun.status === "running"
                        ? "rgba(34,197,94,0.15)"
                        : activeTabRun.status === "completed"
                        ? "rgba(34,197,94,0.15)"
                        : activeTabRun.status === "suspended_for_clarification" ||
                          activeTabRun.status === "suspended_for_approval"
                        ? "rgba(245,158,11,0.15)"
                        : "rgba(239,68,68,0.15)",
                    color:
                      activeTabRun.status === "running" || activeTabRun.status === "completed"
                        ? "#22c55e"
                        : activeTabRun.status === "suspended_for_clarification" ||
                          activeTabRun.status === "suspended_for_approval"
                        ? "#f59e0b"
                        : "#ef4444"
                  }}
                >
                  {activeTabRun.status.replace(/_/g, " ")}
                </span>
                {activeTabRun.checkpoint.stepCount != null && activeTabRun.checkpoint.stepCount > 0 && (
                  <span style={styles.runContextStep}>Step {activeTabRun.checkpoint.stepCount}</span>
                )}
              </div>
              <div style={styles.runContextGoal}>
                {activeTabRun.goal.length > 120
                  ? activeTabRun.goal.slice(0, 120) + "..."
                  : activeTabRun.goal}
              </div>
              {foregroundRunEvents.length > 0 && (
                <div style={styles.runContextActions}>
                  {foregroundRunEvents.slice(-5).map((evt) => (
                    <div key={evt.id} style={styles.runContextActionItem}>
                      {evt.summary}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Chat messages */}
          {messages.map((message) => (
            <div
              key={message.id}
              style={{
                ...styles.chatRow,
                ...(message.role === "user" ? styles.chatRowUser : {}),
                ...(message.tone === "action" ? styles.chatRowAction : {})
              }}
            >
              {message.role === "agent" && message.tone !== "action" && (
                <div style={styles.chatAvatar}>✦</div>
              )}
              {message.tone === "action" && <div style={styles.chatActionIcon}>⚡</div>}
              <div
                style={{
                  ...styles.chatBubble,
                  ...(message.role === "user" ? styles.chatBubbleUser : {}),
                  ...(message.tone === "success" ? styles.chatBubbleSuccess : {}),
                  ...(message.tone === "warning" ? styles.chatBubbleWarning : {}),
                  ...(message.tone === "error" ? styles.chatBubbleError : {}),
                  ...(message.tone === "action" ? styles.chatBubbleAction : {})
                }}
              >
                <div>{message.content}</div>
                <div style={styles.chatTime}>
                  {new Date(message.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit"
                  })}
                </div>
              </div>
              {message.role === "user" && <div style={styles.chatAvatarUser}>•</div>}
            </div>
          ))}

          {/* Inline pending questions — integrated into the conversation workspace.
              Exclude the active tab's run since its context is shown in RunContextCard above. */}
          {(() => {
            const otherSuspended = activeTabRun
              ? suspendedRuns.filter((r) => r.id !== activeTabRun.id)
              : suspendedRuns;
            return otherSuspended.length > 0 ? (
              <div style={styles.questionsSection}>
                <div style={styles.questionsDivider}>
                  <span style={styles.questionsDividerLabel}>Awaiting your input</span>
                </div>
                <RemoteQuestions
                  runs={otherSuspended}
                  onResume={async (run) => {
                    await refresh();
                    if (!run?.id) return;
                    setSelectedRunId(run.id);
                    if (run.checkpoint.browserSessionId) {
                      setSelectedGroupId(run.id);
                      setForegroundRunId(run.id);
                      setMainPanel("browser");
                    }
                  }}
                />
              </div>
            ) : null;
          })()}

          <div ref={chatEndRef} />
        </div>

        {/* Agent task composer */}
        <div style={styles.composer}>
          <div style={styles.composerRow}>
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submitChatTask();
                }
              }}
              placeholder="Ask the agent to do something…"
              style={styles.composerInput}
            />
            <button
              onClick={() => void submitChatTask()}
              style={styles.composerButton}
              disabled={chatBusy}
            >
              {chatBusy ? "…" : "→"}
            </button>
          </div>
          <div style={styles.composerHint}>
            {runtime?.planner.mode === "live"
              ? "Live agent ready"
              : runtime
              ? "No API key — settings needed"
              : "Runtime loading…"}
          </div>
        </div>
      </aside>

      {sidebarVisible && (
        <div onMouseDown={handleSidebarDragStart} style={styles.sidebarDragHandle} />
      )}

      {/* Main browser area */}
      <section style={styles.main}>
        {/* Tab bar — window drag region.
            When the sidebar is hidden the section starts at x=0, which puts the
            first interactive element under the macOS traffic lights (~x=16–80).
            Add 82px of left padding in that state to keep all controls clear. */}
        <div style={{ ...styles.tabBar, paddingLeft: sidebarVisible ? 10 : 82 } as React.CSSProperties}>
          <button
            onClick={() => setSidebarVisible((v) => !v)}
            style={{ ...styles.iconButton, WebkitAppRegion: "no-drag" } as React.CSSProperties}
            title={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
          >
            ☰
          </button>
          <div style={styles.headerTabs}>
            {shellTabs.map((tab) => {
              const active = mainPanel === "browser" && activeBrowserTab?.groupId === tab.groupId;
              const dot = getTabStatusDot(tab);
              return (
                <div
                  key={tab.groupId}
                  style={{
                    ...styles.headerTabWrap,
                    ...(active ? styles.headerTabWrapActive : {})
                  }}
                >
                  <button
                    onClick={() => {
                      setSelectedGroupId(tab.groupId);
                      setSelectedRunId(tab.runId);
                      setForegroundRunId(tab.runId);
                      setMainPanel("browser");
                    }}
                    style={{ ...styles.headerTabInner, WebkitAppRegion: "no-drag" } as React.CSSProperties}
                  >
                    <span
                      style={{
                        ...styles.headerTabDot,
                        background: dot.color,
                        ...(dot.animate ? { animation: "ob-pulse 1.5s ease-in-out infinite" } : {})
                      }}
                      title={dot.title}
                    />
                    <span style={styles.headerTabTitle}>{tab.title}</span>
                  </button>
                  <button
                    style={{ ...styles.headerTabClose, WebkitAppRegion: "no-drag" } as React.CSSProperties}
                    onClick={async () => {
                      // Capture these from the closure BEFORE any awaits so they
                      // reflect the state at click-time (not a potentially stale later render).
                      const closingActive =
                        mainPanel === "browser" && activeBrowserTab?.groupId === tab.groupId;
                      const tabIndex = shellTabs.findIndex((t) => t.groupId === tab.groupId);
                      const remaining = shellTabs.filter((t) => t.groupId !== tab.groupId);
                      // Pick the adjacent tab (prev if available, else new first).
                      const nextTab =
                        remaining.length > 0
                          ? remaining[Math.min(tabIndex, remaining.length - 1)]
                          : null;

                      await window.openbrowse.closeBrowserGroup(tab.groupId);
                      await refresh();
                      clearGroupSelection(tab.groupId, selectedRunId);

                      if (closingActive) {
                        if (nextTab) {
                          // Auto-switch to the adjacent tab. Staying in "browser" mode
                          // avoids calling hideBrowserSession/clearBrowserViewport, which
                          // eliminates the race with any in-flight showBrowserSession IPC
                          // that the intermediate re-render may have already queued.
                          setSelectedGroupId(nextTab.groupId);
                          setSelectedRunId(nextTab.runId);
                          setForegroundRunId(nextTab.runId);
                        } else {
                          setMainPanel("home");
                        }
                      }
                    }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
            <button
              style={{ ...styles.addTabButton, WebkitAppRegion: "no-drag" } as React.CSSProperties}
              onClick={() => void handleNewTab()}
            >
              +
            </button>
          </div>
        </div>

        {/* Nav bar — window drag region */}
        <div style={styles.navBar}>
          <div style={styles.navButtons}>
            <button
              style={{ ...styles.iconButton, WebkitAppRegion: "no-drag" } as React.CSSProperties}
              onClick={() => {
                if (activeBrowserTab && mainPanel === "browser") {
                  void window.openbrowse.browserBack(activeBrowserTab.id);
                }
              }}
            >
              ←
            </button>
            <button
              style={{ ...styles.iconButton, WebkitAppRegion: "no-drag" } as React.CSSProperties}
              onClick={() => {
                if (activeBrowserTab && mainPanel === "browser") {
                  void window.openbrowse.browserForward(activeBrowserTab.id);
                }
              }}
            >
              →
            </button>
            <button
              style={{ ...styles.iconButton, WebkitAppRegion: "no-drag" } as React.CSSProperties}
              onClick={() => {
                if (activeBrowserTab && mainPanel === "browser") {
                  void window.openbrowse.browserReload(activeBrowserTab.id);
                } else {
                  void refresh();
                }
              }}
            >
              ↻
            </button>
            <button
              style={{ ...styles.iconButton, WebkitAppRegion: "no-drag" } as React.CSSProperties}
              onClick={() => setMainPanel("home")}
            >
              ⌂
            </button>
          </div>

          <div style={styles.addressBarWrap}>
            <span style={{ ...styles.addressLock, color: isSecure ? "#22c55e" : "#9090a8" }}>
              {isSecure ? "🔒" : "●"}
            </span>
            <input
              type="text"
              value={addressEditing ? addressInput : displayUrl}
              placeholder="Search or enter address"
              onChange={(e) => setAddressInput(e.target.value)}
              onFocus={() => {
                setAddressInput(displayUrl);
                setAddressEditing(true);
              }}
              onBlur={() => setAddressEditing(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleNavigate(addressInput);
                  e.currentTarget.blur();
                }
                if (e.key === "Escape") {
                  setAddressEditing(false);
                  e.currentTarget.blur();
                }
              }}
              style={{ ...styles.addressInput, WebkitAppRegion: "no-drag" } as React.CSSProperties}
            />
          </div>

          <div style={styles.headerActions}>
            {/* Demos — browser chrome action, opens management panel */}
            <button
              style={{ ...styles.headerPill, WebkitAppRegion: "no-drag" } as React.CSSProperties}
              onClick={() => openManagement("demos")}
            >
              Demos
            </button>
            {/* Waiting-input indicator — quick context clue */}
            {waitingCount > 0 && (
              <div style={styles.waitingPip}>
                <span style={styles.waitingDot} />
                {waitingCount}
              </div>
            )}
            {/* Settings — opens management panel */}
            <button
              onClick={() => openManagement("config")}
              style={{ ...styles.iconButton, WebkitAppRegion: "no-drag" } as React.CSSProperties}
              title="Settings & Management"
            >
              ⚙
            </button>
          </div>
        </div>

        {/* Main content */}
        <div style={styles.mainBody}>
          {mainPanel === "browser" ? (
            <>
              <AgentActivityBar
                run={activeTabRun}
                recentAction={foregroundRunEvents.at(-1) ?? null}
                onCancel={(runId) => void handleCancelRun(runId)}
              />
              <BrowserPanel activeTab={activeBrowserTab} covered={managementOpen} />
            </>
          ) : (
            <HomePage
              shellTabs={shellTabs}
              onOpenTab={(tab) => {
                setSelectedGroupId(tab.groupId);
                setSelectedRunId(tab.runId);
                setForegroundRunId(tab.runId);
                setMainPanel("browser");
              }}
            />
          )}
        </div>
      </section>

      {/* Management panel — bottom-sheet modal */}
      {managementOpen && (
        <ManagementPanel
          runtime={runtime}
          settings={settings}
          runs={runs}
          logs={logs}
          replaySteps={replaySteps}
          profiles={profiles}
          selectedRunId={selectedRunId}
          initialTab={managementTab}
          onSaved={async (saved) => {
            await refresh();
            // Keep the management panel open after saving — the user may want
            // to review or continue configuring.
          }}
          onSelectRun={setSelectedRunId}
          onStartDemo={async (run) => {
            setManagementOpen(false);
            await refresh();
            if (run) await openRunInBrowser(run);
          }}
          onClose={() => setManagementOpen(false)}
        />
      )}
    </div>
  );
}

// ---- Home page ----

function HomePage({
  shellTabs,
  onOpenTab
}: {
  shellTabs: BrowserShellTabDescriptor[];
  onOpenTab: (tab: BrowserShellTabDescriptor) => void;
}) {
  return (
    <div style={homeStyles.page}>
      <div style={homeStyles.recentSection}>
        <div style={homeStyles.eyebrow}>Recent</div>
        {shellTabs.length === 0 ? (
          <div style={homeStyles.emptyHint}>
            No browser tabs yet. Press <kbd style={homeStyles.kbd}>+</kbd> or type an address above.
          </div>
        ) : (
          <div style={homeStyles.recentGrid}>
            {shellTabs.map((tab) => (
              <button key={tab.groupId} onClick={() => onOpenTab(tab)} style={homeStyles.recentCard}>
                <div style={homeStyles.recentFavicon}>⊙</div>
                <div style={homeStyles.recentInfo}>
                  <div style={homeStyles.recentTitle}>{tab.title || "Untitled"}</div>
                  <div style={homeStyles.recentUrl}>{tab.url}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const homeStyles: Record<string, React.CSSProperties> = {
  page: {
    height: "100%",
    overflow: "auto",
    padding: "40px 32px 32px",
    background: "linear-gradient(180deg, #0a0a12 0%, #12121a 100%)"
  },
  recentSection: {
    maxWidth: 860,
    margin: "0 auto"
  },
  eyebrow: {
    fontSize: "0.78rem",
    color: "#9090a8",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    marginBottom: 14
  },
  emptyHint: {
    background: "#12121a",
    border: "1px solid #2a2a3e",
    borderRadius: 14,
    padding: "18px 20px",
    color: "#9090a8",
    fontSize: "0.9rem"
  },
  recentGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
    gap: 10
  },
  recentCard: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    background: "#12121a",
    border: "1px solid #2a2a3e",
    borderRadius: 14,
    padding: "12px 16px",
    cursor: "pointer",
    textAlign: "left",
    color: "#e5e7eb"
  },
  recentFavicon: {
    fontSize: "1.1rem",
    color: "#8b5cf6",
    flexShrink: 0
  },
  recentInfo: {
    minWidth: 0
  },
  recentTitle: {
    fontSize: "0.9rem",
    fontWeight: 600,
    color: "#ffffff",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap"
  },
  recentUrl: {
    fontSize: "0.78rem",
    color: "#9090a8",
    marginTop: 3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap"
  },
  kbd: {
    background: "#1e1e2e",
    border: "1px solid #2a2a3e",
    borderRadius: 4,
    padding: "1px 5px",
    fontSize: "0.82rem",
    color: "#e5e7eb"
  }
};

// ---- Shared styles ----

const styles: Record<string, React.CSSProperties> = {
  app: {
    display: "flex",
    height: "100vh",
    overflow: "hidden",
    background: "#0a0a12",
    color: "#e8e8f0",
    fontFamily: "'SF Pro Display', 'Avenir Next', sans-serif"
  },
  // Dedicated drag / traffic-light clearance strip at the top of the sidebar.
  // Height (38px) matches the tabBar so both sides form one visual chrome row.
  // Left portion is occupied by macOS window controls; the rest is a drag target.
  titleBarSpacer: {
    height: 38,
    flexShrink: 0,
    WebkitAppRegion: "drag"
  } as React.CSSProperties,
  // Sidebar
  sidebar: {
    display: "flex",
    flexDirection: "column",
    background: "#0f0f18",
    borderRight: "1px solid #2a2a3e",
    flexShrink: 0
  },
  sidebarDragHandle: {
    width: 4,
    cursor: "col-resize",
    background: "transparent",
    flexShrink: 0,
    zIndex: 10,
    boxSizing: "border-box" as const
  },
  sidebarHeader: {
    padding: "16px 16px 12px",
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    borderBottom: "1px solid #2a2a3e",
    flexShrink: 0
  },
  brandMark: {
    width: 32,
    height: 32,
    borderRadius: 10,
    display: "grid",
    placeItems: "center",
    background: "rgba(139,92,246,0.16)",
    color: "#c4b5fd",
    fontSize: 16,
    flexShrink: 0,
    marginTop: 2
  },
  brandInfo: {
    minWidth: 0
  },
  brandName: {
    fontSize: "0.9rem",
    fontWeight: 700,
    color: "#ffffff"
  },
  statusRow: {
    display: "flex",
    gap: 10,
    marginTop: 4
  },
  statusPip: {
    fontSize: "0.72rem"
  },
  conversationArea: {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    padding: "14px 14px 6px",
    display: "flex",
    flexDirection: "column",
    gap: 10
  },
  chatRow: {
    display: "flex",
    alignItems: "flex-end",
    gap: 8
  },
  chatRowUser: {
    justifyContent: "flex-end"
  },
  chatAvatar: {
    width: 26,
    height: 26,
    borderRadius: 999,
    display: "grid",
    placeItems: "center",
    background: "rgba(139,92,246,0.14)",
    color: "#c4b5fd",
    flexShrink: 0,
    fontSize: "0.7rem"
  },
  chatAvatarUser: {
    width: 26,
    height: 26,
    borderRadius: 999,
    display: "grid",
    placeItems: "center",
    background: "#334155",
    color: "#e2e8f0",
    flexShrink: 0,
    fontSize: "0.7rem"
  },
  chatBubble: {
    maxWidth: "82%",
    background: "#171726",
    border: "1px solid #2a2a3e",
    color: "#e5e7eb",
    borderRadius: 14,
    padding: "9px 12px",
    fontSize: "0.88rem",
    lineHeight: 1.45
  },
  chatBubbleUser: {
    background: "linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)",
    borderColor: "#8b5cf6",
    color: "#ffffff"
  },
  chatBubbleSuccess: { borderColor: "rgba(34,197,94,0.3)" },
  chatBubbleWarning: { borderColor: "rgba(245,158,11,0.3)" },
  chatBubbleError: { borderColor: "rgba(239,68,68,0.3)" },
  chatBubbleAction: {
    background: "transparent",
    border: "none",
    borderLeft: "2px solid #8b5cf6",
    borderRadius: 0,
    padding: "4px 10px",
    fontSize: "0.78rem",
    color: "#9090a8"
  },
  chatRowAction: {
    gap: 6
  },
  chatActionIcon: {
    width: 18,
    height: 18,
    display: "grid",
    placeItems: "center",
    color: "#8b5cf6",
    flexShrink: 0,
    fontSize: "0.65rem"
  },
  // RunContextCard — agent context for the active browser tab
  runContextCard: {
    background: "#171726",
    border: "1px solid #2a2a3e",
    borderRadius: 12,
    padding: "10px 12px",
    marginBottom: 4
  },
  runContextHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 6
  },
  runContextBadge: {
    fontSize: "0.68rem",
    fontWeight: 600,
    borderRadius: 999,
    padding: "2px 8px",
    textTransform: "capitalize"
  },
  runContextStep: {
    fontSize: "0.68rem",
    color: "#6b6b82"
  },
  runContextGoal: {
    fontSize: "0.82rem",
    color: "#e5e7eb",
    lineHeight: 1.4,
    marginBottom: 6
  },
  runContextActions: {
    display: "flex",
    flexDirection: "column",
    gap: 3
  },
  runContextActionItem: {
    fontSize: "0.72rem",
    color: "#9090a8",
    paddingLeft: 8,
    borderLeft: "2px solid rgba(139,92,246,0.3)"
  },
  chatTime: {
    marginTop: 6,
    color: "rgba(255,255,255,0.42)",
    fontSize: "0.68rem"
  },
  // Pending questions inline section
  questionsSection: {
    display: "flex",
    flexDirection: "column",
    gap: 6
  },
  questionsDivider: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    margin: "6px 0 2px"
  },
  questionsDividerLabel: {
    fontSize: "0.72rem",
    color: "#f59e0b",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    fontWeight: 600
  },
  // Composer
  composer: {
    padding: "10px 14px 12px",
    borderTop: "1px solid #232335",
    background: "#0f0f18",
    flexShrink: 0
  },
  composerRow: {
    display: "flex",
    gap: 8
  },
  composerInput: {
    flex: 1,
    background: "#1e1e2e",
    color: "#f8fafc",
    border: "1px solid #2a2a3e",
    borderRadius: 12,
    padding: "10px 12px",
    fontSize: "0.88rem"
  },
  composerButton: {
    width: 40,
    borderRadius: 12,
    border: "1px solid #8b5cf6",
    background: "linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "1rem"
  },
  composerHint: {
    marginTop: 6,
    fontSize: "0.7rem",
    color: "#6b6b82"
  },
  // Main area
  main: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: "#0a0a12"
  },
  tabBar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 10px 0",
    background: "#0f0f18",
    WebkitAppRegion: "drag",
    borderBottom: "1px solid #1f2030"
  } as React.CSSProperties,
  headerTabs: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    overflowX: "auto",
    flex: 1,
    WebkitAppRegion: "no-drag"
  } as React.CSSProperties,
  headerTab: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 100,
    maxWidth: 200,
    padding: "8px 12px",
    borderRadius: "9px 9px 0 0",
    background: "#0a0a12",
    color: "#9090a8",
    border: "1px solid #1f2030",
    borderBottom: "none",
    cursor: "pointer",
    fontSize: "0.82rem"
  },
  headerTabWrap: {
    display: "flex",
    alignItems: "center",
    minWidth: 100,
    maxWidth: 200,
    borderRadius: "9px 9px 0 0",
    background: "#0a0a12",
    border: "1px solid #1f2030",
    borderBottom: "none",
    color: "#9090a8"
  },
  headerTabWrapActive: {
    background: "#16162a",
    borderColor: "#4a4a7a",
    borderTopColor: "#8b5cf6",
    color: "#ffffff"
  },
  headerTabInner: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 7,
    background: "transparent",
    border: "none",
    color: "inherit",
    padding: "8px 6px 8px 10px",
    cursor: "pointer",
    fontSize: "0.82rem"
  },
  headerTabActive: {
    background: "#12121a",
    color: "#ffffff",
    borderColor: "#2a2a3e"
  },
  headerTabDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#8b5cf6",
    flexShrink: 0
  },
  headerTabTitle: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap"
  },
  headerTabClose: {
    width: 22,
    height: 22,
    marginRight: 5,
    borderRadius: 5,
    background: "transparent",
    border: "none",
    color: "#9090a8",
    cursor: "pointer",
    fontSize: "0.72rem",
    display: "grid",
    placeItems: "center"
  },
  addTabButton: {
    width: 28,
    height: 28,
    borderRadius: 7,
    background: "#141422",
    border: "1px solid #2a2a3e",
    color: "#cbd5e1",
    cursor: "pointer",
    fontSize: "1rem"
  },
  navBar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 10px",
    background: "#12121a",
    borderBottom: "1px solid #2a2a3e",
    WebkitAppRegion: "drag"
  } as React.CSSProperties,
  navButtons: {
    display: "flex",
    alignItems: "center",
    gap: 3,
    WebkitAppRegion: "no-drag"
  } as React.CSSProperties,
  iconButton: {
    background: "#1a1a26",
    color: "#cbd5e1",
    border: "1px solid #2a2a3e",
    borderRadius: 9,
    minWidth: 30,
    height: 30,
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    fontSize: "0.88rem"
  },
  addressBarWrap: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    gap: 7,
    minWidth: 0,
    background: "#1e1e2e",
    border: "1px solid #2a2a3e",
    borderRadius: 9,
    padding: "0 10px",
    height: 30,
    WebkitAppRegion: "no-drag"
  } as React.CSSProperties,
  addressLock: {
    fontSize: "0.68rem",
    flexShrink: 0
  },
  addressInput: {
    flex: 1,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "#e5e7eb",
    fontSize: "0.86rem",
    minWidth: 0
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    WebkitAppRegion: "no-drag"
  } as React.CSSProperties,
  headerPill: {
    background: "#1a1a26",
    color: "#e5e7eb",
    border: "1px solid #2a2a3e",
    borderRadius: 999,
    padding: "5px 11px",
    cursor: "pointer",
    fontSize: "0.8rem"
  },
  waitingPip: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    background: "rgba(245,158,11,0.12)",
    border: "1px solid rgba(245,158,11,0.3)",
    borderRadius: 999,
    padding: "4px 9px",
    fontSize: "0.78rem",
    color: "#fbbf24"
  },
  waitingDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#f59e0b",
    display: "inline-block"
  },
  mainBody: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden"
  }
};
