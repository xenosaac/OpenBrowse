import { useState } from "react";
import type { BrowserProfile, TaskRun, WorkflowEvent } from "@openbrowse/contracts";
import { colors, glass, shadows } from "../styles/tokens";
import type { ReplayStep } from "@openbrowse/observability";
import type { RuntimeDescriptor, RuntimeSettings } from "../../shared/runtime";
import { DemoPanel } from "./DemoPanel";
import { LiveTasks } from "./LiveTasks";
import { ManagedProfiles } from "./ManagedProfiles";
import { SettingsPanel } from "./SettingsPanel";
import { HandoffViewer } from "./HandoffViewer";
import { WorkflowLog } from "./WorkflowLog";
import { BookmarkPanel } from "./BookmarkPanel";
import { HistoryPanel } from "./HistoryPanel";
import { CookiePanel } from "./CookiePanel";

export type ManagementTab = "config" | "demos" | "sessions" | "profiles" | "runtime" | "bookmarks" | "history" | "cookies";
type SessionsSubTab = "tasks" | "log" | "handoff";

interface Props {
  runtime: RuntimeDescriptor | null;
  settings: RuntimeSettings | null;
  runs: TaskRun[];
  logs: WorkflowEvent[];
  replaySteps: ReplayStep[];
  profiles: BrowserProfile[];
  selectedRunId: string | null;
  activeSessionId: string | null;
  initialTab: ManagementTab;
  onSaved: (settings: RuntimeSettings) => Promise<void>;
  onSelectRun: (runId: string) => void;
  onCancelRun?: (runId: string) => void;
  onStartDemo: (run?: TaskRun | null) => Promise<void>;
  onClose: () => void;
}

const TABS: { key: ManagementTab; label: string }[] = [
  { key: "config", label: "Configuration" },
  { key: "demos", label: "Demos" },
  { key: "sessions", label: "Sessions" },
  { key: "profiles", label: "Profiles" },
  { key: "bookmarks", label: "Bookmarks" },
  { key: "history", label: "History" },
  { key: "cookies", label: "Cookies" },
  { key: "runtime", label: "Runtime" }
];

export function ManagementPanel({
  runtime,
  settings,
  runs,
  logs,
  replaySteps,
  profiles,
  selectedRunId,
  activeSessionId,
  initialTab,
  onSaved,
  onSelectRun,
  onCancelRun,
  onStartDemo,
  onClose
}: Props) {
  const [activeTab, setActiveTab] = useState<ManagementTab>(initialTab);
  const [sessionsSubTab, setSessionsSubTab] = useState<SessionsSubTab>("tasks");

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.sheet} className="ob-glass-panel" onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <span style={styles.headerTitle}>Manage</span>
            <div style={styles.tabBar}>
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    ...styles.tabBtn,
                    ...(activeTab === tab.key ? styles.tabBtnActive : {})
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <button style={styles.closeBtn} className="ob-btn" onClick={onClose}>✕</button>
        </div>

        <div style={styles.body}>
          {activeTab === "config" && (
            <SettingsPanel
              runtime={runtime}
              settings={settings}
              onSaved={onSaved}
            />
          )}

          {activeTab === "demos" && (
            <DemoPanel onStarted={(run) => void onStartDemo(run)} />
          )}

          {activeTab === "sessions" && (
            <div style={styles.sessionsLayout}>
              <div style={styles.subTabBar}>
                <button
                  onClick={() => setSessionsSubTab("tasks")}
                  className={sessionsSubTab === "tasks" ? undefined : "ob-btn"}
                  style={{
                    ...styles.subTabBtn,
                    ...(sessionsSubTab === "tasks" ? styles.subTabBtnActive : {})
                  }}
                >
                  Live Tasks
                </button>
                <button
                  onClick={() => setSessionsSubTab("log")}
                  className={sessionsSubTab === "log" ? undefined : "ob-btn"}
                  style={{
                    ...styles.subTabBtn,
                    ...(sessionsSubTab === "log" ? styles.subTabBtnActive : {})
                  }}
                >
                  Workflow Log
                </button>
                <button
                  onClick={() => setSessionsSubTab("handoff")}
                  className={sessionsSubTab === "handoff" ? undefined : "ob-btn"}
                  style={{
                    ...styles.subTabBtn,
                    ...(sessionsSubTab === "handoff" ? styles.subTabBtnActive : {})
                  }}
                >
                  Handoff
                </button>
              </div>
              <div style={styles.sessionsContent}>
                {sessionsSubTab === "tasks" && (
                  <LiveTasks runs={runs} onSelectRun={onSelectRun} onCancelRun={onCancelRun} />
                )}
                {sessionsSubTab === "log" && (
                  <WorkflowLog
                    logs={logs}
                    replaySteps={replaySteps}
                    selectedRunId={selectedRunId}
                    runs={runs}
                    onSelectRun={onSelectRun}
                  />
                )}
                {sessionsSubTab === "handoff" && (
                  <HandoffViewer selectedRunId={selectedRunId} runs={runs} onSelectRun={onSelectRun} />
                )}
              </div>
            </div>
          )}

          {activeTab === "profiles" && (
            <ManagedProfiles profiles={profiles} />
          )}

          {activeTab === "bookmarks" && <BookmarkPanel />}

          {activeTab === "history" && <HistoryPanel />}

          {activeTab === "cookies" && <CookiePanel activeSessionId={activeSessionId} />}

          {activeTab === "runtime" && (
            <RuntimeStatus runtime={runtime} />
          )}
        </div>
      </div>
    </div>
  );
}

function RuntimeStatus({ runtime }: { runtime: RuntimeDescriptor | null }) {
  if (!runtime) {
    return <p style={{ color: "#9090a8" }}>Runtime loading…</p>;
  }

  const sections: Array<{ title: string; rows: Array<[string, string]> }> = [
    {
      title: "Planner",
      rows: [
        ["Mode", runtime.planner.mode],
        ["Detail", runtime.planner.detail]
      ]
    },
    {
      title: "Storage",
      rows: [
        ["Mode", runtime.storage.mode],
        ["Detail", runtime.storage.detail]
      ]
    },
    {
      title: "Chat Bridge",
      rows: [
        ["Mode", runtime.chatBridge.mode],
        ["Detail", runtime.chatBridge.detail]
      ]
    }
  ];

  return (
    <div style={styles.runtimeGrid}>
      {sections.map((section) => (
        <div key={section.title} style={styles.runtimeCard}>
          <div style={styles.runtimeCardTitle}>{section.title}</div>
          {section.rows.map(([key, value]) => (
            <div key={key} style={styles.runtimeRow}>
              <span style={styles.runtimeKey}>{key}</span>
              <span style={styles.runtimeValue}>{value}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    ...glass.overlay,
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    justifyContent: "flex-end",
    zIndex: 1000
  } as React.CSSProperties,
  sheet: {
    ...glass.panel,
    borderTop: "1px solid " + colors.borderGlass,
    borderRadius: "18px 18px 0 0",
    display: "flex",
    flexDirection: "column",
    // Fixed height so the panel never resizes when switching tabs.
    // Content that doesn't fit scrolls inside the body area.
    height: "67vh",
    overflow: "hidden",
    boxShadow: shadows.glassElevated
  } as React.CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "14px 20px 0",
    borderBottom: "1px solid " + colors.borderDefault,
    flexShrink: 0
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 20
  },
  headerTitle: {
    fontSize: "0.88rem",
    fontWeight: 700,
    color: "#9090a8",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    flexShrink: 0
  },
  tabBar: {
    display: "flex",
    gap: 2
  },
  tabBtn: {
    background: "transparent",
    border: "none",
    color: "#9090a8",
    padding: "10px 14px",
    cursor: "pointer",
    fontSize: "0.88rem",
    borderBottom: "2px solid transparent",
    marginBottom: -1
  },
  tabBtnActive: {
    color: "#ffffff",
    borderBottomColor: colors.emerald
  },
  closeBtn: {
    background: "transparent",
    border: "none",
    color: "#9090a8",
    cursor: "pointer",
    fontSize: "1rem",
    padding: "8px",
    borderRadius: 8,
    flexShrink: 0
  },
  body: {
    flex: 1,
    // minHeight: 0 is required for a flex child to scroll rather than expand.
    // Without it the child keeps its intrinsic content height and overflow: auto
    // never triggers — the sheet just grows instead of the body scrolling.
    minHeight: 0,
    overflow: "auto",
    padding: "20px 24px 24px"
  },
  sessionsLayout: {
    display: "flex",
    flexDirection: "column",
    gap: 16
  },
  subTabBar: {
    display: "flex",
    gap: 4
  },
  subTabBtn: {
    background: colors.buttonBg,
    border: "1px solid " + colors.borderGlass,
    color: colors.textSecondary,
    borderRadius: 8,
    padding: "6px 14px",
    cursor: "pointer",
    fontSize: "0.84rem"
  },
  subTabBtnActive: {
    ...glass.emerald,
    color: "#ffffff"
  } as React.CSSProperties,
  sessionsContent: {
    minHeight: 0
  },
  runtimeGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: 14
  },
  runtimeCard: {
    ...glass.card,
    border: "1px solid " + colors.borderSubtle,
    borderRadius: 14,
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 8
  } as React.CSSProperties,
  runtimeCardTitle: {
    fontSize: "0.8rem",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#9090a8",
    marginBottom: 4
  },
  runtimeRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12
  },
  runtimeKey: {
    fontSize: "0.84rem",
    color: "#9090a8"
  },
  runtimeValue: {
    fontSize: "0.84rem",
    color: "#e5e7eb",
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0
  }
};
