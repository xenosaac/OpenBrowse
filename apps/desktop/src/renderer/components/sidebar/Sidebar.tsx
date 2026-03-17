import React, { useEffect, useMemo, useRef } from "react";
import type { TaskRun, WorkflowEvent } from "@openbrowse/contracts";
import type { ChatSession, ChatMessage } from "../../types/chat";
import type { RuntimeDescriptor } from "../../../shared/runtime";
import { colors } from "../../styles/tokens";
import { SidebarHeader } from "./SidebarHeader";
import { SessionListDropdown } from "./SessionListDropdown";
import { RunContextCard } from "./RunContextCard";
import { ChatMessageItem } from "./ChatMessageItem";
import { ChatComposer } from "./ChatComposer";
import { RemoteQuestions } from "../RemoteQuestions";

interface Props {
  // Session state
  sessions: ChatSession[];
  activeSession: ChatSession;
  activeSessionId: string;
  sessionListOpen: boolean;
  messages: ChatMessage[];
  chatInput: string;
  chatBusy: boolean;
  // Runtime state
  runs: TaskRun[];
  runtime: RuntimeDescriptor | null;
  globalActionEvents: WorkflowEvent[];
  suspendedRuns: TaskRun[];
  // Callbacks
  onToggleSessionList: () => void;
  onNewSession: () => void;
  onSwitchSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onClearChat: () => void;
  onChatInputChange: (val: string) => void;
  onSubmitTask: () => void;
  onRetryTask: (goal: string) => void;
  onResumeRun: (run: TaskRun | null) => Promise<void>;
  onDismissRun: (runId: string) => Promise<void>;
  onSaveTemplate?: (goal: string) => void;
}

export function Sidebar(props: Props) {
  const {
    sessions, activeSession, activeSessionId, sessionListOpen,
    messages, chatInput, chatBusy,
    runs, runtime, globalActionEvents, suspendedRuns,
    onToggleSessionList, onNewSession, onSwitchSession, onDeleteSession, onClearChat,
    onChatInputChange, onSubmitTask, onRetryTask, onResumeRun, onDismissRun, onSaveTemplate
  } = props;

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const runningCount = runs.filter((r) => r.status === "running").length;
  const waitingCount = suspendedRuns.length;

  const sessionSuspendedRuns = useMemo(
    () => suspendedRuns.filter(run => activeSession.runIds.includes(run.id)),
    [suspendedRuns, activeSession.runIds]
  );

  const chatContextRun = useMemo(() => {
    const sessionRuns = runs.filter(r => activeSession.runIds.includes(r.id));
    const running = sessionRuns.filter(r => r.status === "running");
    if (running.length > 0) return running.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b));
    const suspended = sessionRuns.filter(
      r => r.status === "suspended_for_clarification" || r.status === "suspended_for_approval"
    );
    if (suspended.length > 0) return suspended.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b));
    return null;
  }, [runs, activeSession.runIds]);

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sessionSuspendedRuns]);

  return (
    <>
      <div style={styles.titleBarSpacer as React.CSSProperties} />
      <SidebarHeader
        runningCount={runningCount}
        waitingCount={waitingCount}
        onToggleSessionList={onToggleSessionList}
        onNewSession={onNewSession}
        onClearChat={onClearChat}
      />
      {sessionListOpen && (
        <SessionListDropdown
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSwitch={onSwitchSession}
          onDelete={onDeleteSession}
        />
      )}
      {sessions.length > 1 && <div style={styles.sessionLabel}>{activeSession.title}</div>}

      <div style={styles.conversationArea}>
        {chatContextRun && (
          <RunContextCard run={chatContextRun} recentActions={globalActionEvents} />
        )}
        {messages.length === 0 && !chatContextRun && sessionSuspendedRuns.length === 0 && (
          <div style={styles.emptyState}>
            <div style={styles.emptyHeading}>What can I help with?</div>
            <div style={styles.emptySubtext}>Try a task like:</div>
            <div style={styles.suggestionList}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  style={styles.suggestionPill}
                  className="ob-suggestion-pill"
                  onClick={() => onChatInputChange(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message) => (
          <ChatMessageItem key={message.id} message={message} onRetry={onRetryTask} onSaveTemplate={onSaveTemplate} />
        ))}
        {sessionSuspendedRuns.length > 0 && (
          <div style={styles.questionsSection}>
            <div style={styles.questionsDivider}>
              <span style={styles.questionsDividerLabel}>Awaiting your input</span>
            </div>
            <RemoteQuestions
              runs={sessionSuspendedRuns}
              onResume={onResumeRun}
              onDismiss={onDismissRun}
            />
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <ChatComposer
        value={chatInput}
        busy={chatBusy}
        plannerMode={runtime?.planner.mode}
        runtimeReady={!!runtime}
        onChange={onChatInputChange}
        onSubmit={onSubmitTask}
      />
    </>
  );
}

const SUGGESTIONS = [
  "Find the cheapest flight from SNA to SEA in April",
  "Play today's Wordle",
  "Compare AirPods prices across Amazon, Best Buy, and Walmart",
  "Look up the weather forecast for this week",
];

const styles: Record<string, React.CSSProperties> = {
  titleBarSpacer: { height: 38, flexShrink: 0, WebkitAppRegion: "drag" } as React.CSSProperties,
  sessionLabel: {
    padding: "4px 14px", fontSize: "0.7rem", color: colors.textMuted,
    borderBottom: "1px solid " + colors.borderSubtle, flexShrink: 0,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const
  },
  conversationArea: {
    flex: 1, minHeight: 0, overflow: "auto",
    padding: "14px 14px 6px", display: "flex",
    flexDirection: "column", gap: 10
  },
  questionsSection: { display: "flex", flexDirection: "column", gap: 6 },
  questionsDivider: { display: "flex", alignItems: "center", gap: 8, margin: "6px 0 2px" },
  questionsDividerLabel: {
    fontSize: "0.72rem", color: colors.statusWaiting,
    textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600
  },
  emptyState: {
    display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", flex: 1, padding: "24px 8px", gap: 8,
    textAlign: "center"
  },
  emptyHeading: {
    fontSize: "1rem", fontWeight: 600, color: colors.textPrimary,
    marginBottom: 2
  },
  emptySubtext: {
    fontSize: "0.78rem", color: colors.textMuted, marginBottom: 6
  },
  suggestionList: {
    display: "flex", flexDirection: "column", gap: 6, width: "100%"
  },
  suggestionPill: {
    background: "transparent",
    border: "1px solid " + colors.borderSubtle,
    borderRadius: 8, padding: "8px 12px",
    fontSize: "0.82rem", color: colors.textSecondary,
    cursor: "pointer", textAlign: "left",
    transition: "border-color 0.15s, color 0.15s"
  }
};
