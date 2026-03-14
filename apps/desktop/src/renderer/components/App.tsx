import { useEffect, useMemo, useState } from "react";
import type { BrowserProfile, TaskRun, WorkflowEvent } from "@openbrowse/contracts";
import type { ReplayStep } from "@openbrowse/observability";
import type {
  BrowserShellTabDescriptor,
  RecoverySummary,
  RuntimeDescriptor,
  RuntimeSettings
} from "../../shared/runtime";
import { BrowserPanel } from "./BrowserPanel";
import { DemoPanel } from "./DemoPanel";
import { LiveTasks } from "./LiveTasks";
import { ManagedProfiles } from "./ManagedProfiles";
import { RemoteQuestions } from "./RemoteQuestions";
import { SettingsPanel } from "./SettingsPanel";
import { WorkflowLog } from "./WorkflowLog";
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
    };
  }
}

type SidebarPanel = "tasks" | "questions" | "log" | "demos" | "profiles";
type MainPanel = "home" | "browser";
type ChatMessage = {
  id: string;
  role: "user" | "agent";
  content: string;
  tone?: "normal" | "success" | "warning" | "error";
  timestamp: string;
};

export function App() {
  const [sidebarPanel, setSidebarPanel] = useState<SidebarPanel>("tasks");
  const [mainPanel, setMainPanel] = useState<MainPanel>("home");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
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

  useEffect(() => {
    document.documentElement.classList.add("dark");
    document.body.style.margin = "0";
    document.body.style.background = "#0a0a12";
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
      current.some((message) => message.id === `notice:${notice}`)
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
      current.some((message) => message.id === `error:${errorNotice}`)
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

  const sidebarSections: { key: SidebarPanel; label: string; count?: number }[] = [
    { key: "tasks", label: "Live Tasks", count: runs.length || undefined },
    { key: "questions", label: "Remote Questions", count: suspendedRuns.length || undefined },
    { key: "log", label: "Workflow Log", count: selectedRunId ? logs.length || undefined : undefined },
    { key: "demos", label: "Demos" },
    { key: "profiles", label: "Profiles", count: profiles.length || undefined }
  ];

  const taskSummary = useMemo(() => {
    const running = runs.filter((run) => run.status === "running").length;
    const suspended = suspendedRuns.length;
    const completed = runs.filter((run) => run.status === "completed").length;
    return { running, suspended, completed };
  }, [runs, suspendedRuns]);

  const openRunInBrowser = async (run: TaskRun) => {
    const next = focusRun(run, { openBrowser: true });
    if (run.checkpoint.browserSessionId || next.openBrowser) {
      setMainPanel("browser");
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
      setIsSettingsOpen(true);
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

  const renderSidebarContent = () => {
    switch (sidebarPanel) {
      case "tasks":
        return <LiveTasks runs={runs} onSelectRun={(runId) => setSelectedRunId(runId)} />;
      case "questions":
        return (
          <RemoteQuestions
            runs={suspendedRuns}
            onResume={async (run) => {
              await refresh();
              if (!run?.id) return;
              setSelectedRunId(run.id);
              if (!foregroundRunId && run.source === "desktop") {
                setForegroundRunId(run.id);
              }
              const shouldOpenBrowser =
                Boolean(run.checkpoint.browserSessionId) &&
                (foregroundRunId === run.id || (!foregroundRunId && run.source === "desktop"));
              if (shouldOpenBrowser) {
                setSelectedGroupId(run.id);
                setForegroundRunId(run.id);
                setMainPanel("browser");
              }
            }}
          />
        );
      case "log":
        return (
          <WorkflowLog
            logs={logs}
            replaySteps={replaySteps}
            selectedRunId={selectedRunId}
            runs={runs}
            onSelectRun={(runId) => setSelectedRunId(runId)}
          />
        );
      case "demos":
        return (
          <DemoPanel
            onStarted={async (run) => {
              await refresh();
              if (!run) return;
              await openRunInBrowser(run);
            }}
          />
        );
      case "profiles":
        return <ManagedProfiles profiles={profiles} />;
      default:
        return null;
    }
  };

  return (
    <div style={styles.app}>
      <aside style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
          <div style={styles.brandMark}>✦</div>
          <div>
            <div style={styles.sidebarTitle}>Agent Assistant</div>
            <div style={styles.sidebarSubtitle}>Ready to help</div>
          </div>
        </div>

        <div style={styles.chatTimeline}>
          {messages.map((message) => (
            <div
              key={message.id}
              style={{
                ...styles.chatRow,
                ...(message.role === "user" ? styles.chatRowUser : {})
              }}
            >
              {message.role === "agent" && <div style={styles.chatAvatar}>✦</div>}
              <div
                style={{
                  ...styles.chatBubble,
                  ...(message.role === "user" ? styles.chatBubbleUser : {}),
                  ...(message.tone === "success" ? styles.chatBubbleSuccess : {}),
                  ...(message.tone === "warning" ? styles.chatBubbleWarning : {}),
                  ...(message.tone === "error" ? styles.chatBubbleError : {})
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
        </div>

        <div style={styles.sidebarComposer}>
          <div style={styles.composerRow}>
            <input
              type="text"
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submitChatTask();
                }
              }}
              placeholder="Ask agent to do something..."
              style={styles.composerInput}
            />
            <button onClick={() => void submitChatTask()} style={styles.composerButton} disabled={chatBusy}>
              {chatBusy ? "..." : "→"}
            </button>
          </div>
        </div>

        <div style={styles.statGrid}>
          <StatCard label="Running" value={String(taskSummary.running)} accent="#8b5cf6" />
          <StatCard label="Waiting" value={String(taskSummary.suspended)} accent="#f59e0b" />
          <StatCard label="Done" value={String(taskSummary.completed)} accent="#22c55e" />
        </div>

        <nav style={styles.sidebarNav}>
          {sidebarSections.map((section) => {
            const active = sidebarPanel === section.key;
            return (
              <button
                key={section.key}
                onClick={() => setSidebarPanel(section.key)}
                style={{
                  ...styles.sidebarButton,
                  ...(active ? styles.sidebarButtonActive : {})
                }}
              >
                <span>{section.label}</span>
                {section.count ? <span style={styles.sidebarCount}>{section.count}</span> : null}
              </button>
            );
          })}
        </nav>

        <div style={styles.sidebarContent}>{renderSidebarContent()}</div>
      </aside>

      <section style={styles.main}>
        <header style={styles.browserHeader}>
          <div style={styles.tabBar}>
            <button onClick={() => setIsSettingsOpen(true)} style={styles.iconButton} title="Settings">
              ⚙
            </button>
            <div style={styles.headerTabs}>
              <button
                onClick={() => setMainPanel("home")}
                style={{
                  ...styles.headerTab,
                  ...(mainPanel === "home" ? styles.headerTabActive : {})
                }}
              >
                <span style={styles.headerTabDot} />
                <span style={styles.headerTabTitle}>New Tab</span>
              </button>
              {shellTabs.map((tab) => {
                const active = mainPanel === "browser" && activeBrowserTab?.groupId === tab.groupId;
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
                      style={styles.headerTabInner}
                    >
                      <span style={styles.headerTabDot} />
                      <span style={styles.headerTabTitle}>{tab.title}</span>
                    </button>
                    <button
                      style={styles.headerTabClose}
                      onClick={async () => {
                        await window.openbrowse.closeBrowserGroup(tab.groupId);
                        await refresh();
                        clearGroupSelection(tab.groupId, selectedRunId);
                        if (activeBrowserTab?.groupId === tab.groupId) {
                          setMainPanel("home");
                        }
                      }}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
              <button style={styles.addTabButton} onClick={() => setMainPanel("home")}>
                +
              </button>
            </div>
            <button style={styles.iconButton}>≡</button>
          </div>

          <div style={styles.navBar}>
            <div style={styles.navButtons}>
              <button style={styles.iconButton}>←</button>
              <button style={styles.iconButton}>→</button>
              <button style={styles.iconButton} onClick={() => void refresh()}>
                ↻
              </button>
              <button style={styles.iconButton} onClick={() => setMainPanel("home")}>
                ⌂
              </button>
            </div>

            <div style={styles.addressBar}>
              <span style={styles.addressLock}>●</span>
              <span style={styles.addressText}>
                {mainPanel === "browser" ? activeBrowserTab?.url ?? "about:blank" : "agent://newtab"}
              </span>
            </div>

            <div style={styles.headerActions}>
              <button style={styles.headerPill} onClick={() => setSidebarPanel("demos")}>
                Demos
              </button>
              <button style={styles.headerPill} onClick={() => setSidebarPanel("questions")}>
                Questions
              </button>
            </div>
          </div>
        </header>

        <div style={styles.mainBody}>
          {mainPanel === "browser" && shellTabs.length > 0 ? (
            <BrowserPanel
              tabs={shellTabs}
              runs={runs}
              logs={logs}
              selectedRunId={selectedRunId}
              selectedGroupId={selectedGroupId}
              foregroundRunId={foregroundRunId}
              runtime={runtime}
              plannerModel={settings?.plannerModel ?? null}
              onSelectRun={setSelectedRunId}
              onSelectGroup={setSelectedGroupId}
              onFocusRun={(run) => {
                void openRunInBrowser(run);
              }}
              onCloseGroup={async (groupId) => {
                await window.openbrowse.closeBrowserGroup(groupId);
                await refresh();
                clearGroupSelection(groupId, selectedRunId);
              }}
              onHideBrowser={() => setMainPanel("home")}
              onRefresh={refresh}
            />
          ) : (
            <div style={styles.homePage}>
              <div style={styles.hero}>
                <div style={styles.heroBadge}>Powered by AI Agent</div>
                <h1 style={styles.heroTitle}>What can I help you browse today?</h1>
                <div style={styles.heroSearchWrap}>
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void submitChatTask();
                      }
                    }}
                    placeholder="Search or ask your agent..."
                    style={styles.heroSearch}
                  />
                  <button onClick={() => void submitChatTask()} style={styles.heroSearchButton} disabled={chatBusy}>
                    →
                  </button>
                </div>
              </div>

              <div style={styles.quickGrid}>
                <QuickActionCard
                  title="Web Search"
                  desc="Launch a research or browsing task."
                  onClick={() => setSidebarPanel("tasks")}
                />
                <QuickActionCard
                  title="Quick Actions"
                  desc="Run demos and repeatable browser packs."
                  onClick={() => setSidebarPanel("demos")}
                />
                <QuickActionCard
                  title="Workflow Debug"
                  desc="Inspect replay and raw event timeline."
                  onClick={() => setSidebarPanel("log")}
                />
                <QuickActionCard
                  title="Settings"
                  desc="Configure Anthropic and Telegram."
                  onClick={() => setIsSettingsOpen(true)}
                />
              </div>

              <div style={styles.homeSections}>
                <div style={styles.homeSection}>
                  <div style={styles.sectionEyebrow}>Recent Pages</div>
                  <div style={styles.recentList}>
                    {shellTabs.length === 0 ? (
                      <div style={styles.recentEmpty}>No browser groups yet. Start a task from the agent chat.</div>
                    ) : (
                      shellTabs.map((tab) => (
                        <button
                          key={tab.groupId}
                          onClick={() => {
                            setSelectedGroupId(tab.groupId);
                            setSelectedRunId(tab.runId);
                            setForegroundRunId(tab.runId);
                            setMainPanel("browser");
                          }}
                          style={styles.recentItem}
                        >
                          <div>
                            <div style={styles.recentTitle}>{tab.title}</div>
                            <div style={styles.recentMeta}>{tab.url}</div>
                          </div>
                          <div style={styles.recentBadge}>{tab.status}</div>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                <div style={styles.homeSection}>
                  <div style={styles.sectionEyebrow}>Agent Stats</div>
                  <div style={styles.actionCards}>
                    <HomeInfoCard
                      title="Pages Browsed"
                      value={String(shellTabs.length)}
                      detail="Live browser groups currently tracked by the runtime."
                      accent="#8b5cf6"
                    />
                    <HomeInfoCard
                      title="Tasks Automated"
                      value={String(runs.length)}
                      detail="Total runs currently visible in the desktop runtime."
                      accent="#38bdf8"
                    />
                    <HomeInfoCard
                      title="Waiting Replies"
                      value={String(suspendedRuns.length)}
                      detail="Clarification or approval loops waiting on you."
                      accent="#f59e0b"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {isSettingsOpen && (
        <div style={styles.modalBackdrop} onClick={() => setIsSettingsOpen(false)}>
          <div style={styles.modalCard} onClick={(event) => event.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div>
                <div style={styles.modalTitle}>Settings</div>
                <div style={styles.modalSubtitle}>Configure your browser agent.</div>
              </div>
              <button style={styles.iconButton} onClick={() => setIsSettingsOpen(false)}>
                ✕
              </button>
            </div>
            <div style={styles.modalBody}>
              <SettingsPanel
                runtime={runtime}
                settings={settings}
                onSaved={async () => {
                  await refresh();
                  setIsSettingsOpen(false);
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{ ...styles.statCard, boxShadow: `inset 0 0 0 1px ${accent}33` }}>
      <div style={styles.statValue}>{value}</div>
      <div style={{ ...styles.statLabel, color: accent }}>{label}</div>
    </div>
  );
}

function QuickActionCard({
  title,
  desc,
  onClick
}: {
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} style={styles.quickCard}>
      <div style={styles.quickCardTitle}>{title}</div>
      <div style={styles.quickCardDesc}>{desc}</div>
    </button>
  );
}

function HomeInfoCard({
  title,
  value,
  detail,
  accent
}: {
  title: string;
  value: string;
  detail: string;
  accent: string;
}) {
  return (
    <div style={{ ...styles.infoCard, boxShadow: `inset 0 0 0 1px ${accent}33` }}>
      <div style={styles.infoValue}>{value}</div>
      <div style={{ ...styles.infoTitle, color: accent }}>{title}</div>
      <div style={styles.infoDetail}>{detail}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    display: "flex",
    minHeight: "100vh",
    height: "100vh",
    overflow: "hidden",
    background: "#0a0a12",
    color: "#e8e8f0",
    fontFamily: "'SF Pro Display', 'Avenir Next', sans-serif"
  },
  sidebar: {
    width: 340,
    minWidth: 340,
    display: "flex",
    flexDirection: "column",
    borderRight: "1px solid #2a2a3e",
    background: "#0f0f18"
  },
  sidebarHeader: {
    padding: "18px 18px 14px",
    display: "flex",
    alignItems: "center",
    gap: 12,
    borderBottom: "1px solid #2a2a3e",
    background: "linear-gradient(90deg, rgba(139,92,246,0.16), rgba(15,15,24,0))"
  },
  brandMark: {
    width: 36,
    height: 36,
    borderRadius: 12,
    display: "grid",
    placeItems: "center",
    background: "rgba(139,92,246,0.14)",
    color: "#c4b5fd",
    fontSize: 18
  },
  sidebarTitle: {
    fontSize: "0.96rem",
    fontWeight: 700,
    color: "#ffffff"
  },
  sidebarSubtitle: {
    fontSize: "0.78rem",
    color: "#9090a8",
    marginTop: 2
  },
  chatTimeline: {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    padding: "14px 16px 4px",
    display: "flex",
    flexDirection: "column",
    gap: 12
  },
  chatRow: {
    display: "flex",
    alignItems: "flex-end",
    gap: 10
  },
  chatRowUser: {
    justifyContent: "flex-end"
  },
  chatAvatar: {
    width: 30,
    height: 30,
    borderRadius: 999,
    display: "grid",
    placeItems: "center",
    background: "rgba(139,92,246,0.14)",
    color: "#c4b5fd",
    flexShrink: 0
  },
  chatAvatarUser: {
    width: 30,
    height: 30,
    borderRadius: 999,
    display: "grid",
    placeItems: "center",
    background: "#334155",
    color: "#e2e8f0",
    flexShrink: 0
  },
  chatBubble: {
    maxWidth: "78%",
    background: "#171726",
    border: "1px solid #2a2a3e",
    color: "#e5e7eb",
    borderRadius: 16,
    padding: "10px 12px"
  },
  chatBubbleUser: {
    background: "linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)",
    borderColor: "#8b5cf6",
    color: "#ffffff"
  },
  chatBubbleSuccess: {
    borderColor: "rgba(34,197,94,0.3)"
  },
  chatBubbleWarning: {
    borderColor: "rgba(245,158,11,0.3)"
  },
  chatBubbleError: {
    borderColor: "rgba(239,68,68,0.3)"
  },
  chatTime: {
    marginTop: 8,
    color: "rgba(255,255,255,0.58)",
    fontSize: "0.72rem"
  },
  sidebarComposer: {
    padding: "12px 16px 14px",
    borderTop: "1px solid #232335",
    borderBottom: "1px solid #232335",
    background: "#12121a"
  },
  composerRow: {
    display: "flex",
    gap: 10
  },
  composerInput: {
    flex: 1,
    background: "#1e1e2e",
    color: "#f8fafc",
    border: "1px solid #2a2a3e",
    borderRadius: 14,
    padding: "12px 14px",
    fontSize: "0.92rem"
  },
  composerButton: {
    width: 46,
    borderRadius: 14,
    border: "1px solid #8b5cf6",
    background: "linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 700
  },
  statGrid: {
    padding: "14px 16px 16px",
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 10
  },
  statCard: {
    background: "#151522",
    borderRadius: 14,
    padding: 12
  },
  statValue: {
    fontSize: "1.25rem",
    fontWeight: 700,
    color: "#ffffff"
  },
  statLabel: {
    marginTop: 6,
    fontSize: "0.76rem",
    textTransform: "uppercase",
    letterSpacing: "0.06em"
  },
  sidebarNav: {
    padding: "0 12px 12px",
    display: "grid",
    gap: 6
  },
  sidebarButton: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    background: "transparent",
    color: "#9090a8",
    border: "1px solid transparent",
    borderRadius: 12,
    padding: "10px 12px",
    cursor: "pointer",
    fontSize: "0.88rem"
  },
  sidebarButtonActive: {
    background: "#7c3aed",
    color: "#ffffff",
    borderColor: "#8b5cf6"
  },
  sidebarCount: {
    background: "rgba(255,255,255,0.12)",
    borderRadius: 999,
    minWidth: 22,
    height: 22,
    display: "grid",
    placeItems: "center",
    padding: "0 6px",
    fontSize: "0.75rem"
  },
  sidebarContent: {
    minHeight: 0,
    overflow: "auto",
    padding: "0 16px 16px"
  },
  main: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: "#0a0a12"
  },
  browserHeader: {
    borderBottom: "1px solid #2a2a3e",
    background: "#12121a"
  },
  tabBar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px 0",
    background: "#0f0f18"
  },
  headerTabs: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    overflowX: "auto",
    flex: 1
  },
  headerTab: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 180,
    maxWidth: 260,
    padding: "10px 16px",
    borderRadius: "12px 12px 0 0",
    background: "#0a0a12",
    color: "#9090a8",
    border: "1px solid #1f2030",
    borderBottom: "none",
    cursor: "pointer"
  },
  headerTabWrap: {
    display: "flex",
    alignItems: "center",
    minWidth: 180,
    maxWidth: 260,
    borderRadius: "12px 12px 0 0",
    background: "#0a0a12",
    border: "1px solid #1f2030",
    borderBottom: "none"
  },
  headerTabWrapActive: {
    background: "#12121a",
    borderColor: "#2a2a3e"
  },
  headerTabInner: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "transparent",
    border: "none",
    color: "inherit",
    padding: "10px 10px 10px 16px",
    cursor: "pointer"
  },
  headerTabActive: {
    background: "#12121a",
    color: "#ffffff",
    borderColor: "#2a2a3e"
  },
  headerTabDot: {
    width: 8,
    height: 8,
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
    width: 28,
    height: 28,
    marginRight: 8,
    borderRadius: 8,
    background: "transparent",
    border: "none",
    color: "#9090a8",
    cursor: "pointer"
  },
  addTabButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    background: "#141422",
    border: "1px solid #2a2a3e",
    color: "#cbd5e1",
    cursor: "pointer"
  },
  navBar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 16px"
  },
  navButtons: {
    display: "flex",
    alignItems: "center",
    gap: 6
  },
  iconButton: {
    background: "#1a1a26",
    color: "#cbd5e1",
    border: "1px solid #2a2a3e",
    borderRadius: 10,
    minWidth: 34,
    height: 34,
    display: "grid",
    placeItems: "center",
    cursor: "pointer"
  },
  addressBar: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
    background: "#1e1e2e",
    border: "1px solid #2a2a3e",
    borderRadius: 12,
    padding: "10px 14px"
  },
  addressLock: {
    color: "#22c55e",
    fontSize: 10
  },
  addressText: {
    color: "#e5e7eb",
    fontSize: "0.88rem",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap"
  },
  headerActions: {
    display: "flex",
    gap: 8
  },
  headerPill: {
    background: "#1a1a26",
    color: "#e5e7eb",
    border: "1px solid #2a2a3e",
    borderRadius: 999,
    padding: "8px 14px",
    cursor: "pointer",
    fontSize: "0.82rem"
  },
  mainBody: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
    padding: 16
  },
  homePage: {
    height: "100%",
    overflow: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 24,
    background: "linear-gradient(180deg, #0a0a12 0%, #12121a 100%)"
  },
  hero: {
    padding: "56px 24px 0",
    textAlign: "center"
  },
  heroBadge: {
    display: "inline-block",
    background: "rgba(139,92,246,0.14)",
    color: "#c4b5fd",
    border: "1px solid rgba(139,92,246,0.26)",
    borderRadius: 999,
    padding: "8px 14px",
    fontSize: "0.8rem"
  },
  heroTitle: {
    margin: "22px 0 16px",
    fontSize: "2.4rem",
    color: "#ffffff"
  },
  heroSearchWrap: {
    position: "relative",
    maxWidth: 760,
    margin: "0 auto"
  },
  heroSearch: {
    width: "100%",
    boxSizing: "border-box",
    background: "#1e1e2e",
    border: "1px solid #2a2a3e",
    borderRadius: 18,
    padding: "18px 56px 18px 22px",
    color: "#ffffff",
    fontSize: "1rem"
  },
  heroSearchButton: {
    position: "absolute",
    right: 10,
    top: "50%",
    transform: "translateY(-50%)",
    width: 40,
    height: 40,
    borderRadius: 12,
    border: "1px solid #8b5cf6",
    background: "linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)",
    color: "#ffffff",
    cursor: "pointer"
  },
  quickGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 14,
    padding: "0 24px"
  },
  quickCard: {
    textAlign: "left",
    background: "#12121a",
    border: "1px solid #2a2a3e",
    borderRadius: 18,
    padding: 18,
    color: "#e5e7eb",
    cursor: "pointer"
  },
  quickCardTitle: {
    fontSize: "0.98rem",
    fontWeight: 700
  },
  quickCardDesc: {
    marginTop: 8,
    color: "#9090a8",
    fontSize: "0.84rem",
    lineHeight: 1.45
  },
  homeSections: {
    padding: "0 24px 24px"
  },
  homeSection: {
    display: "grid",
    gap: 10,
    marginBottom: 18
  },
  sectionEyebrow: {
    color: "#9090a8",
    fontSize: "0.78rem",
    letterSpacing: "0.08em",
    textTransform: "uppercase"
  },
  actionCards: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 14
  },
  infoCard: {
    textAlign: "left",
    background: "#12121a",
    border: "1px solid #2a2a3e",
    borderRadius: 18,
    padding: 18,
    color: "#e5e7eb"
  },
  infoValue: {
    fontSize: "1.65rem",
    fontWeight: 700,
    color: "#ffffff"
  },
  infoTitle: {
    marginTop: 8,
    fontSize: "0.9rem",
    fontWeight: 700
  },
  infoDetail: {
    marginTop: 8,
    color: "#9090a8",
    fontSize: "0.82rem",
    lineHeight: 1.45
  },
  recentList: {
    display: "grid",
    gap: 10
  },
  recentItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
    textAlign: "left",
    background: "#12121a",
    border: "1px solid #2a2a3e",
    borderRadius: 18,
    padding: 16,
    color: "#e5e7eb",
    cursor: "pointer"
  },
  recentTitle: {
    fontSize: "0.92rem",
    fontWeight: 700,
    color: "#ffffff"
  },
  recentMeta: {
    marginTop: 6,
    color: "#9090a8",
    fontSize: "0.8rem",
    lineHeight: 1.4
  },
  recentBadge: {
    color: "#c4b5fd",
    fontSize: "0.75rem",
    textTransform: "uppercase"
  },
  recentEmpty: {
    background: "#12121a",
    border: "1px solid #2a2a3e",
    borderRadius: 18,
    padding: 16,
    color: "#9090a8"
  },
  modalBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    backdropFilter: "blur(6px)",
    display: "grid",
    placeItems: "center",
    padding: 24,
    zIndex: 1000
  },
  modalCard: {
    width: "min(1100px, 100%)",
    maxHeight: "84vh",
    display: "flex",
    flexDirection: "column",
    background: "#12121a",
    border: "1px solid #2a2a3e",
    borderRadius: 24,
    boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
    overflow: "hidden"
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
    padding: "20px 24px",
    borderBottom: "1px solid #2a2a3e",
    background: "linear-gradient(90deg, rgba(139,92,246,0.14), rgba(18,18,26,0))"
  },
  modalTitle: {
    color: "#ffffff",
    fontSize: "1.2rem",
    fontWeight: 700
  },
  modalSubtitle: {
    marginTop: 4,
    color: "#9090a8",
    fontSize: "0.85rem"
  },
  modalBody: {
    overflow: "auto",
    padding: 24
  }
};
