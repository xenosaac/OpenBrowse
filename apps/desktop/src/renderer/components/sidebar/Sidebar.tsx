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
  onChatInputChange: (val: string) => void;
  onSubmitTask: () => void;
  onResumeRun: (run: TaskRun | null) => Promise<void>;
  onDismissRun: (runId: string) => Promise<void>;
}

export function Sidebar(props: Props) {
  const {
    sessions, activeSession, activeSessionId, sessionListOpen,
    messages, chatInput, chatBusy,
    runs, runtime, globalActionEvents, suspendedRuns,
    onToggleSessionList, onNewSession, onSwitchSession,
    onChatInputChange, onSubmitTask, onResumeRun, onDismissRun
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
      />
      {sessionListOpen && (
        <SessionListDropdown
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSwitch={onSwitchSession}
        />
      )}
      {sessions.length > 1 && <div style={styles.sessionLabel}>{activeSession.title}</div>}

      <div style={styles.conversationArea}>
        {chatContextRun && (
          <RunContextCard run={chatContextRun} recentActions={globalActionEvents} />
        )}
        {messages.map((message) => (
          <ChatMessageItem key={message.id} message={message} />
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
    fontSize: "0.72rem", color: "#f59e0b",
    textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600
  }
};
