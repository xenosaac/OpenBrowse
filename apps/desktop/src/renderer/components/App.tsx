import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BrowserProfile, RunHandoffArtifact, TaskRun, WorkflowEvent } from "@openbrowse/contracts";
import type { ReplayStep } from "@openbrowse/observability";
import type {
  BrowserShellTabDescriptor,
  RecoverySummary,
  RuntimeDescriptor,
  RuntimeSettings
} from "../../shared/runtime";
import { runtimeEventBus } from "../lib/eventBus";
import { ipc } from "../lib/ipc";
import { normalizeUrl } from "../lib/url";
import type { ChatMessage } from "../types/chat";
import { useAgentRuns } from "../hooks/useAgentRuns";
import { useBrowserTabs } from "../hooks/useBrowserTabs";
import { useSelection } from "../hooks/useSelection";
import { useChatSessions } from "../hooks/useChatSessions";
import { useAddressBar } from "../hooks/useAddressBar";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useUILayout } from "../hooks/useUILayout";
import { colors, glass, shadows } from "../styles/tokens";
import { Sidebar } from "./sidebar/Sidebar";
import { TabBar } from "./chrome/TabBar";
import { NavBar } from "./chrome/NavBar";
import { HomePage } from "./panels/HomePage";
import { AgentActivityBar } from "./AgentActivityBar";
import { BrowserPanel } from "./BrowserPanel";
import { ManagementPanel } from "./ManagementPanel";

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
      getRunHandoff: (runId: string) => Promise<{
        artifact: RunHandoffArtifact;
        markdown: string;
      } | null>;
      // Bookmarks
      listBookmarks: () => Promise<Array<{ id: string; url: string; title: string; faviconUrl?: string; createdAt: string }>>;
      getBookmarkByUrl: (url: string) => Promise<unknown>;
      addBookmark: (data: { url: string; title: string; faviconUrl?: string }) => Promise<{ id: string }>;
      deleteBookmark: (id: string) => Promise<void>;
      searchBookmarks: (query: string) => Promise<unknown[]>;
      // DevTools / Print / PDF
      openDevTools: (sessionId: string) => Promise<unknown>;
      printPage: (sessionId: string) => Promise<unknown>;
      saveAsPdf: (sessionId: string) => Promise<boolean>;
      // Chat persistence
      chatListSessions: () => Promise<Array<{
        id: string; title: string; createdAt: string; updatedAt: string;
        messages: Array<{ id: string; sessionId: string; role: string; content: string; tone?: string; createdAt: string }>;
        runIds: string[];
      }>>;
      chatCreateSession: (data: { id: string; title: string; createdAt: string }) => Promise<void>;
      chatDeleteSession: (sessionId: string) => Promise<boolean>;
      chatUpdateTitle: (sessionId: string, title: string) => Promise<void>;
      chatAppendMessage: (msg: {
        id: string; sessionId: string; role: string; content: string; tone?: string; createdAt: string;
      }) => Promise<void>;
      chatClearMessages: (sessionId: string) => Promise<void>;
      chatLinkRun: (sessionId: string, runId: string) => Promise<void>;
      // Browsing history
      listHistory: (limit?: number) => Promise<unknown[]>;
      searchHistory: (query: string) => Promise<unknown[]>;
      clearHistory: () => Promise<void>;

      // Cookie management
      listCookies: (sessionId: string) => Promise<unknown[]>;
      removeCookie: (sessionId: string, url: string, name: string) => Promise<void>;
      removeAllCookies: (sessionId: string) => Promise<void>;
    };
  }
}

export function App() {
  // ---- Step 1.0: Event bus lifecycle ----
  useEffect(() => {
    runtimeEventBus.connect();
    return () => runtimeEventBus.disconnect();
  }, []);

  // ---- Step 1.1: Core domain hooks (replace useRuntimeStore) ----
  const agentRuns = useAgentRuns();
  const browserTabs = useBrowserTabs();
  const selection = useSelection(agentRuns.runs, browserTabs.shellTabs);

  // ---- Step 1.2: Feature hooks (replace inline state) ----
  const chat = useChatSessions();
  const addressBar = useAddressBar(selection.activeBrowserTab, selection.mainPanel);
  const layout = useUILayout();
  const addressBarRef = useRef<HTMLInputElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

  // ---- Step 1.3: Sync selectedRunId → inspectedRunId, foregroundRunId ----
  useEffect(() => {
    agentRuns.setInspectedRunId(selection.selectedRunId);
  }, [selection.selectedRunId, agentRuns.setInspectedRunId]);

  useEffect(() => {
    agentRuns.setForegroundRunId(selection.foregroundRunId);
  }, [selection.foregroundRunId, agentRuns.setForegroundRunId]);

  // ---- Step 1.5: Initial tab refresh ----
  useEffect(() => {
    void browserTabs.refreshTabs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Derived values ----
  const displayUrl = selection.mainPanel === "browser" && selection.activeBrowserTab
    ? selection.activeBrowserTab.url : "";
  const isSecure = displayUrl.startsWith("https://");

  // ---- Bookmark state ----
  const [isBookmarked, setIsBookmarked] = useState(false);
  useEffect(() => {
    if (!displayUrl || displayUrl === "about:blank") { setIsBookmarked(false); return; }
    window.openbrowse.getBookmarkByUrl(displayUrl).then(b => setIsBookmarked(!!b)).catch(() => setIsBookmarked(false));
  }, [displayUrl]);

  const handleToggleBookmark = useCallback(async () => {
    if (!displayUrl || displayUrl === "about:blank") return;
    if (isBookmarked) {
      const bk = await window.openbrowse.getBookmarkByUrl(displayUrl) as { id: string } | null;
      if (bk) await window.openbrowse.deleteBookmark(bk.id);
      setIsBookmarked(false);
    } else {
      const title = selection.activeBrowserTab?.title ?? displayUrl;
      await window.openbrowse.addBookmark({ url: displayUrl, title });
      setIsBookmarked(true);
    }
  }, [displayUrl, isBookmarked, selection.activeBrowserTab?.title]);

  // ---- Step 1.6: Cross-cutting handlers ----

  const handleCancelRun = useCallback(async (runId: string) => {
    await ipc.tasks.cancel(runId);
    await agentRuns.refresh();
  }, [agentRuns.refresh]);

  const handleCloseTab = useCallback(async (tab: BrowserShellTabDescriptor) => {
    const closingActive = selection.mainPanel === "browser" &&
      selection.activeBrowserTab?.groupId === tab.groupId;
    const tabIndex = browserTabs.shellTabs.findIndex(t => t.groupId === tab.groupId);
    const remaining = browserTabs.shellTabs.filter(t => t.groupId !== tab.groupId);
    const nextTab = remaining.length > 0
      ? remaining[Math.min(tabIndex, remaining.length - 1)]
      : null;

    await browserTabs.closeTab(tab.groupId);
    await agentRuns.refresh();
    await browserTabs.refreshTabs();
    selection.clearGroupSelection(tab.groupId);

    if (closingActive) {
      if (nextTab) {
        selection.selectGroup(nextTab.groupId);
        selection.selectRun(nextTab.runId);
        selection.setForegroundRunId(nextTab.runId);
      } else {
        selection.setMainPanel("home");
      }
    }
  }, [
    selection.mainPanel, selection.activeBrowserTab?.groupId, browserTabs.shellTabs,
    browserTabs.closeTab, agentRuns.refresh, browserTabs.refreshTabs,
    selection.clearGroupSelection, selection.selectGroup, selection.selectRun,
    selection.setForegroundRunId, selection.setMainPanel
  ]);

  const handleNewTab = useCallback(async (url?: string) => {
    const tab = await browserTabs.newTab(url);
    selection.selectGroup(tab.groupId);
    selection.setForegroundRunId(tab.runId);
    selection.setMainPanel("browser");
  }, [browserTabs.newTab, selection.selectGroup, selection.setForegroundRunId, selection.setMainPanel]);

  const handleNavigate = useCallback(async (input: string) => {
    const url = normalizeUrl(input);
    if (selection.activeBrowserTab && selection.mainPanel === "browser") {
      await browserTabs.navigate(selection.activeBrowserTab.id, url);
    } else {
      await handleNewTab(url);
    }
  }, [selection.activeBrowserTab, selection.mainPanel, browserTabs.navigate, handleNewTab]);

  const openRunInBrowser = useCallback(async (run: TaskRun) => {
    const next = selection.focusRun(run, { openBrowser: true });
    if (run.checkpoint.browserSessionId || next.openBrowser) {
      selection.setMainPanel("browser");
    }
  }, [selection.focusRun, selection.setMainPanel]);

  const handleSelectTab = useCallback((tab: BrowserShellTabDescriptor) => {
    selection.selectGroup(tab.groupId);
    selection.selectRun(tab.runId);
    selection.setForegroundRunId(tab.runId);
    selection.setMainPanel("browser");
  }, [selection.selectGroup, selection.selectRun, selection.setForegroundRunId, selection.setMainPanel]);

  const submitChatTask = async (goalOverride?: string) => {
    const goal = (goalOverride ?? chat.chatInput).trim();
    if (!goal || chat.chatBusy) return;

    chat.setMessages(current => [
      ...current,
      {
        id: `user:${Date.now()}`,
        role: "user" as const,
        content: goal,
        timestamp: new Date().toISOString()
      }
    ]);
    chat.setChatInput("");

    const CHAT_PATTERNS = /^(hi|hey|hello|yo|sup|thanks|thank you|ok|okay|sure|bye|goodbye|good morning|good night|how are you|what's up|whats up|haha|lol|hmm|hm|yes|no|yep|nope|cool|nice|great|awesome|got it|i see)\b[.!?\s]*$/i;
    if (CHAT_PATTERNS.test(goal)) {
      chat.postSystemMessage(
        "I'm an automation agent — I work best with specific tasks like \"search for flights from SNA to SEA\" or \"fill out the survey on the current page\". What would you like me to do?"
      );
      return;
    }

    chat.renameSession(goal);

    if (!agentRuns.runtime) {
      chat.postSystemMessage("Runtime is still loading. Wait a second and try again.", "warning");
      return;
    }

    if (agentRuns.runtime.planner.mode !== "live") {
      chat.postSystemMessage(
        "Freeform tasks need a live planner. Open Settings and add your Anthropic API key first.",
        "warning"
      );
      layout.openManagement("config");
      return;
    }

    chat.setChatBusy(true);
    try {
      const run = await ipc.tasks.start({
        id: `task_${Date.now()}`,
        source: "desktop",
        goal,
        constraints: [],
        metadata: {},
        ...(selection.activeBrowserTab ? { activeSessionId: selection.activeBrowserTab.id } : {})
      }) as TaskRun;
      chat.addRunToSession(run.id);
      await agentRuns.refresh();
      await browserTabs.refreshTabs();
      await openRunInBrowser(run);
      chat.postSystemMessage(`Started: ${run.goal}`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      chat.postSystemMessage(`Failed to start task: ${message}`, "error");
    } finally {
      chat.setChatBusy(false);
    }
  };

  const handleResumeRun = useCallback(async (run: TaskRun | null) => {
    await agentRuns.refresh();
    await browserTabs.refreshTabs();
    if (!run?.id) return;
    selection.selectRun(run.id);
    if (run.checkpoint.browserSessionId) {
      selection.selectGroup(run.id);
      selection.setForegroundRunId(run.id);
      selection.setMainPanel("browser");
    }
  }, [
    agentRuns.refresh, browserTabs.refreshTabs,
    selection.selectRun, selection.selectGroup, selection.setForegroundRunId, selection.setMainPanel
  ]);

  const handleDismissRun = useCallback(async (runId: string) => {
    await handleCancelRun(runId);
  }, [handleCancelRun]);

  // ---- Step 1.7: Bridge effects (cross-domain, stay in App.tsx) ----

  // CSS injection — global one-shot
  useEffect(() => {
    document.documentElement.classList.add("dark");
    document.body.style.margin = "0";
    document.body.style.background = colors.bgBase;
    document.body.style.backgroundImage = [
      'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(16,185,129,0.03) 0%, transparent 70%)',
      'radial-gradient(ellipse 60% 40% at 80% 100%, rgba(99,102,241,0.02) 0%, transparent 60%)'
    ].join(', ');
    const style = document.createElement("style");
    style.textContent = `
      @keyframes ob-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
      @keyframes ob-loading-slide { 0%{transform:translateX(-100%)} 50%{transform:translateX(0%)} 100%{transform:translateX(100%)} }
      @keyframes ob-glow-pulse {
        0%,100% { box-shadow: 0 0 8px rgba(16,185,129,0.1); }
        50% { box-shadow: 0 0 16px rgba(16,185,129,0.25); }
      }

      /* ---- Liquid Glass specular light band ---- */
      .ob-glass-panel {
        position: relative;
      }
      .ob-glass-panel::after {
        content: '';
        position: absolute;
        top: 0; left: 0; right: 0;
        height: 1px;
        background: linear-gradient(
          90deg,
          transparent 0%,
          rgba(255,255,255,0.12) 15%,
          rgba(255,255,255,0.22) 50%,
          rgba(255,255,255,0.12) 85%,
          transparent 100%
        );
        pointer-events: none;
        z-index: 1;
      }

      /* ---- Button hover/active with glass ---- */
      .ob-btn {
        transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
      }
      .ob-btn:hover {
        background: rgba(16,185,129,0.1) !important;
        border-color: rgba(255,255,255,0.2) !important;
        box-shadow: 0 0 16px rgba(16,185,129,0.1), inset 0 1px 0 rgba(255,255,255,0.06);
        backdrop-filter: blur(8px) saturate(150%);
        -webkit-backdrop-filter: blur(8px) saturate(150%);
        color: ${colors.emerald} !important;
      }
      .ob-btn:active {
        transform: scale(0.94);
        background: rgba(16,185,129,0.16) !important;
        box-shadow: inset 0 1px 3px rgba(0,0,0,0.3);
      }

      /* Primary CTA (send, approve, etc.) */
      .ob-btn-primary {
        transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
      }
      .ob-btn-primary:hover {
        background: ${colors.emeraldHover} !important;
        box-shadow: 0 0 24px rgba(16,185,129,0.3), inset 0 1px 0 rgba(255,255,255,0.15);
        transform: translateY(-1px);
      }
      .ob-btn-primary:active {
        background: ${colors.emeraldActive} !important;
        transform: translateY(1px) scale(0.95);
        box-shadow: inset 0 2px 4px rgba(0,0,0,0.3);
      }

      /* Tab hover — glass materializes */
      .ob-tab {
        transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
      }
      .ob-tab:hover {
        background: rgba(255,255,255,0.04) !important;
        backdrop-filter: blur(8px) saturate(150%);
        -webkit-backdrop-filter: blur(8px) saturate(150%);
        border-color: rgba(255,255,255,0.1) !important;
        color: ${colors.textPrimary} !important;
      }
      .ob-tab:hover .ob-tab-close {
        opacity: 1 !important;
      }
      .ob-tab-close {
        opacity: 0;
        transition: opacity 150ms ease, color 150ms ease;
      }
      .ob-tab-close:hover {
        color: ${colors.statusFailed} !important;
      }

      /* Address bar focus — emerald glass glow */
      .ob-address {
        transition: border-color 200ms ease, box-shadow 200ms ease;
      }
      .ob-address:focus-within {
        border-color: rgba(16,185,129,0.35) !important;
        box-shadow: 0 0 16px rgba(16,185,129,0.1), inset 0 1px 0 rgba(16,185,129,0.08);
      }

      /* Card hover — glass + emerald shimmer */
      .ob-card {
        transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
      }
      .ob-card:hover {
        border-color: rgba(255,255,255,0.14) !important;
        box-shadow: 0 4px 20px rgba(0,0,0,0.2), 0 0 12px rgba(16,185,129,0.06), inset 0 1px 0 rgba(255,255,255,0.08);
        transform: translateY(-1px);
      }

      /* Dropdown item hover */
      .ob-dropdown-item {
        transition: background 150ms ease, color 150ms ease;
      }
      .ob-dropdown-item:hover {
        background: rgba(16,185,129,0.08) !important;
        color: #ffffff !important;
      }

      /* Scrollbar */
      ::-webkit-scrollbar { width: 6px; height: 6px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb {
        background: rgba(255,255,255,0.1);
        border-radius: 3px;
      }
      ::-webkit-scrollbar-thumb:hover {
        background: rgba(16,185,129,0.25);
      }
    `;
    document.head.appendChild(style);
    return () => { style.remove(); };
  }, []);

  // Browser hide on non-browser panel
  useEffect(() => {
    if (selection.mainPanel !== "browser") {
      void ipc.browser.hideSession();
      void ipc.browser.clearViewport();
    }
  }, [selection.mainPanel]);

  // Notice → chat
  useEffect(() => {
    if (!agentRuns.notice) return;
    chat.setMessages(current =>
      current.some(m => m.id === `notice:${agentRuns.notice}`)
        ? current
        : [
            ...current,
            {
              id: `notice:${agentRuns.notice}`,
              role: "agent" as const,
              content: agentRuns.notice!,
              tone: "success" as const,
              timestamp: new Date().toISOString()
            }
          ]
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentRuns.notice]);

  // Error notice → chat
  useEffect(() => {
    if (!agentRuns.errorNotice) return;
    chat.setMessages(current =>
      current.some(m => m.id === `error:${agentRuns.errorNotice}`)
        ? current
        : [
            ...current,
            {
              id: `error:${agentRuns.errorNotice}`,
              role: "agent" as const,
              content: agentRuns.errorNotice!,
              tone: "error" as const,
              timestamp: new Date().toISOString()
            }
          ]
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentRuns.errorNotice]);

  // Stream agent actions from active session's runs to the chat
  useEffect(() => {
    if (agentRuns.globalActionEvents.length === 0) return;
    chat.setMessages(current => {
      let changed = false;
      let next = current;
      for (const evt of agentRuns.globalActionEvents) {
        if (!chat.activeSession.runIds.includes(evt.runId)) continue;
        const msgId = `action:${evt.id}`;
        if (!next.some(m => m.id === msgId)) {
          if (!changed) { next = [...next]; changed = true; }
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentRuns.globalActionEvents, chat.activeSession.runIds]);

  // Surface run outcomes to chat (completion/failure summaries)
  const postedOutcomesRef = useRef<Set<string>>(new Set());
  const outcomesInitializedRef = useRef(false);
  useEffect(() => {
    if (!outcomesInitializedRef.current && agentRuns.runs.length > 0) {
      outcomesInitializedRef.current = true;
      for (const run of agentRuns.runs) {
        if (run.outcome?.summary) {
          postedOutcomesRef.current.add(run.id);
        }
      }
      return;
    }

    for (const run of agentRuns.runs) {
      if (!run.outcome?.summary) continue;
      if (postedOutcomesRef.current.has(run.id)) continue;
      postedOutcomesRef.current.add(run.id);
      const tone: ChatMessage["tone"] = run.outcome.status === "completed" ? "success" : "error";
      const msgId = `outcome:${run.id}`;
      let content = run.outcome!.summary;
      const ed = run.outcome!.extractedData;
      if (ed && ed.length > 0) {
        content += "\n\n## Results\n\n| Label | Value |\n|---|---|\n"
          + ed.map((item) => `| ${item.label.replace(/\|/g, "\\|")} | ${item.value.replace(/\|/g, "\\|")} |`).join("\n");
      }
      const outcomeMsg: ChatMessage = {
        id: msgId,
        role: "agent",
        content,
        tone,
        timestamp: run.outcome!.finishedAt
      };
      chat.postToRunSessions(run.id, outcomeMsg);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentRuns.runs]);

  // Close hamburger menu when clicking outside
  useEffect(() => {
    if (!layout.menuOpen) return;
    const handler = () => layout.setMenuOpen(false);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [layout.menuOpen, layout.setMenuOpen]);

  // ---- Keyboard shortcuts (after handlers are defined) ----
  useKeyboardShortcuts({
    activeBrowserTab: selection.activeBrowserTab,
    mainPanel: selection.mainPanel,
    addressBarRef,
    onNewTab: () => void handleNewTab(),
    onCloseTab: () => { if (selection.activeBrowserTab) void handleCloseTab(selection.activeBrowserTab); },
    onReload: () => { if (selection.activeBrowserTab) void browserTabs.reload(selection.activeBrowserTab.id); },
    onBack: () => { if (selection.activeBrowserTab) void browserTabs.goBack(selection.activeBrowserTab.id); },
    onForward: () => { if (selection.activeBrowserTab) void browserTabs.goForward(selection.activeBrowserTab.id); },
    onFocusAddressBar: () => { addressBarRef.current?.focus(); addressBarRef.current?.select(); }
  });

  // ---- Hamburger dropdown menu content (rendered via portal) ----
  const menuRect = menuButtonRef.current?.getBoundingClientRect();
  const menuContent = layout.menuOpen && menuRect ? createPortal(
    <div style={{
      ...styles.dropdownMenu,
      position: "fixed",
      top: menuRect.bottom + 4,
      right: window.innerWidth - menuRect.right,
    }} onClick={() => layout.setMenuOpen(false)}>
      <button
        className="ob-dropdown-item"
        style={styles.dropdownItem}
        onClick={async () => {
          const pending = agentRuns.suspendedRuns.filter(
            r => chat.activeSession.runIds.includes(r.id)
          );
          for (const run of pending) {
            await ipc.tasks.cancel(run.id);
          }
          await agentRuns.refresh();
          await browserTabs.refreshTabs();
          chat.createSession();
        }}
      >
        New Session
      </button>
      <button className="ob-dropdown-item" style={styles.dropdownItem} onClick={() => layout.openManagement("history")}>
        History
      </button>
      <div style={styles.dropdownSeparator} />
      <button
        className="ob-dropdown-item"
        style={{
          ...styles.dropdownItem,
          ...(!(selection.mainPanel === "browser" && selection.activeBrowserTab) ? { opacity: 0.4, pointerEvents: "none" as const } : {})
        }}
        onClick={() => {
          if (selection.activeBrowserTab) void window.openbrowse.openDevTools(selection.activeBrowserTab.id);
        }}
      >
        Developer Tools
      </button>
      <div style={styles.dropdownSeparator} />
      <button
        className="ob-dropdown-item"
        style={{
          ...styles.dropdownItem,
          ...(!(selection.mainPanel === "browser" && selection.activeBrowserTab) ? { opacity: 0.4, pointerEvents: "none" as const } : {})
        }}
        onClick={() => {
          if (selection.activeBrowserTab) void window.openbrowse.printPage(selection.activeBrowserTab.id);
        }}
      >
        Print Page
      </button>
      <button
        className="ob-dropdown-item"
        style={{
          ...styles.dropdownItem,
          ...(!(selection.mainPanel === "browser" && selection.activeBrowserTab) ? { opacity: 0.4, pointerEvents: "none" as const } : {})
        }}
        onClick={() => {
          if (selection.activeBrowserTab) void window.openbrowse.saveAsPdf(selection.activeBrowserTab.id);
        }}
      >
        Save as PDF
      </button>
      <button className="ob-dropdown-item" style={styles.dropdownItem} onClick={() => layout.openManagement("bookmarks")}>Bookmarks</button>
      <button className="ob-dropdown-item" style={styles.dropdownItem} onClick={() => layout.openManagement("cookies")}>Cookies</button>
    </div>,
    document.body
  ) : null;

  // ---- Step 1.8: JSX with extracted components ----
  return (
    <div style={styles.app}>
      {/* Sidebar */}
      <aside
        className="ob-glass-panel"
        style={{
          ...styles.sidebar,
          width: layout.sidebarVisible ? layout.sidebarWidth : 0,
          minWidth: layout.sidebarVisible ? 240 : 0,
          overflow: "hidden",
          transition: layout.isDragging ? "none" : "width 0.18s ease, min-width 0.18s ease"
        }}
      >
        <Sidebar
          sessions={chat.sessions}
          activeSession={chat.activeSession}
          activeSessionId={chat.activeSessionId}
          sessionListOpen={chat.sessionListOpen}
          messages={chat.messages}
          chatInput={chat.chatInput}
          chatBusy={chat.chatBusy}
          runs={agentRuns.runs}
          runtime={agentRuns.runtime}
          globalActionEvents={agentRuns.globalActionEvents}
          suspendedRuns={agentRuns.suspendedRuns}
          onToggleSessionList={() => chat.setSessionListOpen(v => !v)}
          onNewSession={chat.createSession}
          onSwitchSession={chat.switchSession}
          onDeleteSession={chat.deleteSession}
          onClearChat={chat.clearCurrentChat}
          onChatInputChange={chat.setChatInput}
          onSubmitTask={submitChatTask}
          onResumeRun={handleResumeRun}
          onDismissRun={handleDismissRun}
        />
      </aside>

      {layout.sidebarVisible && (
        <div onMouseDown={layout.startSidebarDrag} style={styles.sidebarDragHandle} />
      )}

      {/* Main browser area */}
      <section style={styles.main}>
        {/* Unified chrome band — single Tier 1 glass surface for TabBar + NavBar */}
        <div className="ob-glass-panel" style={styles.chromeBand}>
          <TabBar
            shellTabs={browserTabs.shellTabs}
            activeBrowserTab={selection.activeBrowserTab}
            runs={agentRuns.runs}
            tabFavicons={browserTabs.tabFavicons}
            sidebarVisible={layout.sidebarVisible}
            mainPanel={selection.mainPanel}
            onSelectTab={handleSelectTab}
            onCloseTab={handleCloseTab}
            onNewTab={() => void handleNewTab()}
            onToggleSidebar={layout.toggleSidebar}
          />
          <div style={styles.chromeSeparator} />
          <NavBar
          activeBrowserTab={selection.activeBrowserTab}
          mainPanel={selection.mainPanel}
          addressInput={addressBar.addressInput}
          addressEditing={addressBar.addressEditing}
          navState={addressBar.navState}
          displayUrl={displayUrl}
          isSecure={isSecure}
          waitingCount={agentRuns.suspendedRuns.length}
          isBookmarked={isBookmarked}
          onToggleBookmark={() => void handleToggleBookmark()}
          onAddressChange={addressBar.setAddressInput}
          onAddressFocus={addressBar.startEditing}
          onAddressBlur={addressBar.stopEditing}
          onNavigate={(input) => void handleNavigate(input)}
          onBack={() => {
            if (selection.activeBrowserTab && selection.mainPanel === "browser") {
              void browserTabs.goBack(selection.activeBrowserTab.id);
            }
          }}
          onForward={() => {
            if (selection.activeBrowserTab && selection.mainPanel === "browser") {
              void browserTabs.goForward(selection.activeBrowserTab.id);
            }
          }}
          onReload={() => {
            if (selection.activeBrowserTab && selection.mainPanel === "browser") {
              void browserTabs.reload(selection.activeBrowserTab.id);
            } else {
              void agentRuns.refresh();
            }
          }}
          onHome={() => selection.setMainPanel("home")}
          onOpenManagement={layout.openManagement}
          onToggleMenu={(e) => { e.stopPropagation(); layout.toggleMenu(); }}
          addressBarRef={addressBarRef}
          menuButtonRef={menuButtonRef}
        />
        </div>

        {/* Loading indicator */}
        {selection.activeBrowserTab && browserTabs.loadingTabs[selection.activeBrowserTab.id] && (
          <div style={{ height: 2, background: colors.bgElevated, overflow: "hidden", flexShrink: 0 }}>
            <div style={{
              height: "100%",
              width: "40%",
              background: colors.emerald,
              animation: "ob-loading-slide 1.5s ease-in-out infinite"
            }} />
          </div>
        )}

        {/* Main content */}
        <div style={styles.mainBody}>
          {selection.mainPanel === "browser" ? (
            <>
              <AgentActivityBar
                run={selection.activeTabRun}
                recentAction={agentRuns.foregroundRunEvents.at(-1) ?? null}
                onCancel={(runId) => void handleCancelRun(runId)}
              />
              <BrowserPanel
                activeTab={selection.activeBrowserTab}
                covered={layout.managementOpen || layout.menuOpen}
              />
            </>
          ) : (
            <HomePage
              shellTabs={browserTabs.shellTabs}
              tabFavicons={browserTabs.tabFavicons}
              onOpenTab={handleSelectTab}
              onStartTask={(goal) => void submitChatTask(goal)}
            />
          )}
        </div>

        {/* Management panel */}
        {layout.managementOpen && (
          <ManagementPanel
            runtime={agentRuns.runtime}
            settings={agentRuns.settings}
            runs={agentRuns.runs}
            logs={agentRuns.logs}
            replaySteps={agentRuns.replaySteps}
            profiles={agentRuns.profiles}
            selectedRunId={selection.selectedRunId}
            activeSessionId={selection.activeBrowserTab?.id ?? null}
            initialTab={layout.managementTab}
            onSaved={async () => {
              await agentRuns.refresh();
              await browserTabs.refreshTabs();
            }}
            onSelectRun={selection.selectRun}
            onCancelRun={(runId) => void handleCancelRun(runId)}
            onStartDemo={async (run) => {
              layout.closeManagement();
              await agentRuns.refresh();
              await browserTabs.refreshTabs();
              if (run) {
                chat.addRunToSession(run.id);
                await openRunInBrowser(run);
              }
            }}
            onClose={layout.closeManagement}
          />
        )}

        {/* Hamburger dropdown menu — rendered via portal to escape NavBar stacking context */}
        {menuContent}
      </section>
    </div>
  );
}

// ---- Styles (only what App.tsx owns — components have their own) ----

const styles: Record<string, React.CSSProperties> = {
  app: {
    display: "flex",
    height: "100vh",
    overflow: "hidden",
    background: colors.bgBase,
    backgroundImage: [
      'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(16,185,129,0.03) 0%, transparent 70%)',
      'radial-gradient(ellipse 60% 40% at 80% 100%, rgba(99,102,241,0.02) 0%, transparent 60%)'
    ].join(', '),
    color: colors.textPrimary,
    fontFamily: "'SF Pro Display', 'Avenir Next', sans-serif"
  },
  sidebar: {
    display: "flex",
    flexDirection: "column",
    ...glass.panel,
    borderRight: `1px solid ${colors.borderGlass}`,
    boxShadow: shadows.glass,
    flexShrink: 0
  } as React.CSSProperties,
  sidebarDragHandle: {
    width: 4,
    cursor: "col-resize",
    background: "transparent",
    flexShrink: 0,
    zIndex: 10,
    boxSizing: "border-box" as const
  },
  chromeBand: {
    ...glass.panel,
    border: `1px solid ${colors.borderGlass}`,
    borderBottom: '1px solid rgba(255,255,255,0.12)',
    boxShadow: shadows.glass,
  } as React.CSSProperties,
  chromeSeparator: {
    height: 1,
    background: colors.borderSubtle,
    margin: '0 10px',
  },
  main: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: "transparent",
    position: "relative"
  },
  mainBody: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden"
  },
  dropdownMenu: {
    ...glass.panel,
    border: `1px solid ${colors.borderGlass}`,
    borderRadius: 10,
    padding: "6px 0",
    minWidth: 180,
    boxShadow: shadows.glassElevated,
    zIndex: 9999
  } as React.CSSProperties,
  dropdownItem: {
    display: "block",
    width: "100%",
    background: "none",
    border: "none",
    color: colors.textPrimary,
    fontSize: "0.82rem",
    padding: "8px 16px",
    textAlign: "left" as const,
    cursor: "pointer",
    borderRadius: 0
  },
  dropdownSeparator: {
    height: 1,
    background: colors.borderSubtle,
    margin: "4px 0"
  }
};
