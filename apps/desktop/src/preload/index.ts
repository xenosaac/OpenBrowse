import { contextBridge, ipcRenderer } from "electron";
import type {
  BrowserShellTabDescriptor,
  BrowserViewportBounds,
  RecoverySummary,
  RuntimeDescriptor,
  RuntimeSettings
} from "../shared/runtime";
import type { RunHandoffArtifact, TaskRun } from "@openbrowse/contracts";

const api = {
  version: "0.1.0",

  // Task operations
  startTask: (intent: unknown): Promise<TaskRun> => ipcRenderer.invoke("task:start", intent),
  resumeTask: (message: unknown) => ipcRenderer.invoke("task:resume", message),
  cancelTask: (runId: string): Promise<TaskRun | null> => ipcRenderer.invoke("task:cancel", runId),

  // Query operations
  listRuns: () => ipcRenderer.invoke("runs:list"),
  listRecentRuns: (limit?: number): Promise<TaskRun[]> => ipcRenderer.invoke("runs:listRecent", limit),
  getRun: (runId: string) => ipcRenderer.invoke("runs:get", runId),
  listProfiles: () => ipcRenderer.invoke("profiles:list"),
  listLogs: (runId: string) => ipcRenderer.invoke("logs:list", runId),
  replayLogs: (runId: string) => ipcRenderer.invoke("logs:replay", runId),
  listTabs: (): Promise<BrowserShellTabDescriptor[]> => ipcRenderer.invoke("shell:tabs:list"),
  describeRuntime: (): Promise<RuntimeDescriptor> => ipcRenderer.invoke("runtime:describe"),
  getLastRecoveryReport: (): Promise<RecoverySummary | null> => ipcRenderer.invoke("runtime:last-recovery"),
  getSettings: (): Promise<RuntimeSettings> => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: RuntimeSettings) => ipcRenderer.invoke("settings:save", settings),

  // Demo operations
  listDemos: () => ipcRenderer.invoke("demo:list"),
  runDemo: (demoId: string): Promise<TaskRun> => ipcRenderer.invoke("demo:run", demoId),
  watchDemo: (demoId: string, intervalMinutes: number) =>
    ipcRenderer.invoke("demo:watch", { demoId, intervalMinutes }),

  // Task packs (live planner)
  listTaskPacks: () => ipcRenderer.invoke("taskpacks:list"),
  runTaskPack: (packId: string): Promise<TaskRun> => ipcRenderer.invoke("taskpacks:run", packId),

  // Browser view operations
  showBrowserSession: (sessionId: string) => ipcRenderer.invoke("browser:show", sessionId),
  hideBrowserSession: () => ipcRenderer.invoke("browser:hide"),
  getActiveBrowserSession: (): Promise<string | null> => ipcRenderer.invoke("browser:active"),
  setBrowserViewport: (bounds: BrowserViewportBounds) => ipcRenderer.invoke("browser:viewport:set", bounds),
  clearBrowserViewport: () => ipcRenderer.invoke("browser:viewport:clear"),
  closeBrowserGroup: (groupId: string): Promise<TaskRun | null> => ipcRenderer.invoke("browser:close-group", groupId),

  // Split view
  enterSplitView: (leftId: string, rightId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("browser:split-view:enter", { leftId, rightId }),
  exitSplitView: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("browser:split-view:exit"),
  setSplitViewBounds: (leftBounds: BrowserViewportBounds, rightBounds: BrowserViewportBounds): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("browser:split-view:set-bounds", { leftBounds, rightBounds }),

  // Browser navigation
  browserNewTab: (url?: string): Promise<BrowserShellTabDescriptor> =>
    ipcRenderer.invoke("browser:new-tab", url),
  setTabPinned: (tabId: string, pinned: boolean): Promise<void> =>
    ipcRenderer.invoke("browser:set-tab-pinned", { tabId, pinned }),
  setTabOrder: (orderedIds: string[]): Promise<void> =>
    ipcRenderer.invoke("browser:set-tab-order", orderedIds),
  browserNavigate: (sessionId: string, url: string): Promise<void> =>
    ipcRenderer.invoke("browser:navigate", { sessionId, url }),
  browserBack: (sessionId: string): Promise<void> => ipcRenderer.invoke("browser:back", sessionId),
  browserForward: (sessionId: string): Promise<void> => ipcRenderer.invoke("browser:forward", sessionId),
  browserReload: (sessionId: string): Promise<void> => ipcRenderer.invoke("browser:reload", sessionId),
  browserNavState: (
    sessionId: string
  ): Promise<{ canGoBack: boolean; canGoForward: boolean; url: string; title: string } | null> =>
    ipcRenderer.invoke("browser:nav-state", sessionId),
  browserZoomIn: (sessionId: string) => ipcRenderer.invoke("browser:zoom-in", sessionId),
  browserZoomOut: (sessionId: string) => ipcRenderer.invoke("browser:zoom-out", sessionId),
  browserZoomReset: (sessionId: string) => ipcRenderer.invoke("browser:zoom-reset", sessionId),
  findInPage: (sessionId: string, text: string, options?: { forward?: boolean; findNext?: boolean }) =>
    ipcRenderer.invoke("browser:find-in-page", { sessionId, text, ...options }),
  stopFindInPage: (sessionId: string) => ipcRenderer.invoke("browser:stop-find-in-page", sessionId),
  openDevTools: (sessionId: string) => ipcRenderer.invoke("browser:devtools", sessionId),
  toggleReaderMode: (sessionId: string): Promise<{ active: boolean; success: boolean }> =>
    ipcRenderer.invoke("browser:toggle-reader-mode", sessionId),
  printPage: (sessionId: string) => ipcRenderer.invoke("browser:print", sessionId),
  saveAsPdf: (sessionId: string): Promise<boolean> => ipcRenderer.invoke("browser:save-pdf", sessionId),

  // Run handoff
  getRunHandoff: (runId: string): Promise<{ artifact: RunHandoffArtifact; markdown: string } | null> =>
    ipcRenderer.invoke("run:handoff", runId),

  // Bookmarks
  listBookmarks: () => ipcRenderer.invoke("bookmarks:list"),
  getBookmarkByUrl: (url: string) => ipcRenderer.invoke("bookmarks:get-by-url", url),
  addBookmark: (data: { url: string; title: string; faviconUrl?: string }) =>
    ipcRenderer.invoke("bookmarks:add", data),
  deleteBookmark: (id: string) => ipcRenderer.invoke("bookmarks:delete", id),
  searchBookmarks: (query: string) => ipcRenderer.invoke("bookmarks:search", query),

  // Chat persistence
  chatListSessions: () => ipcRenderer.invoke("chat:sessions:list"),
  chatCreateSession: (data: { id: string; title: string; createdAt: string }) =>
    ipcRenderer.invoke("chat:sessions:create", data),
  chatDeleteSession: (sessionId: string) => ipcRenderer.invoke("chat:sessions:delete", sessionId),
  chatUpdateTitle: (sessionId: string, title: string) =>
    ipcRenderer.invoke("chat:sessions:update-title", { sessionId, title }),
  chatAppendMessage: (msg: {
    id: string; sessionId: string; role: string; content: string; tone?: string; createdAt: string
  }) => ipcRenderer.invoke("chat:messages:append", msg),
  chatClearMessages: (sessionId: string) => ipcRenderer.invoke("chat:messages:clear", sessionId),
  chatLinkRun: (sessionId: string, runId: string) =>
    ipcRenderer.invoke("chat:runs:link", { sessionId, runId }),

  // Browsing history
  listHistory: (limit?: number) => ipcRenderer.invoke("history:list", limit),
  searchHistory: (query: string) => ipcRenderer.invoke("history:search", query),
  clearHistory: () => ipcRenderer.invoke("history:clear"),

  // Cookie management
  listCookies: (sessionId: string) => ipcRenderer.invoke("cookies:list", sessionId),
  removeCookie: (sessionId: string, url: string, name: string) =>
    ipcRenderer.invoke("cookies:remove", { sessionId, url, name }),
  removeAllCookies: (sessionId: string) => ipcRenderer.invoke("cookies:remove-all", sessionId),

  // Keybinding preferences
  getKeybindings: (): Promise<Array<{ key: string; value: string }>> =>
    ipcRenderer.invoke("keybindings:get"),
  saveKeybindings: (entries: Array<{ key: string; value: string }>): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("keybindings:save", entries),

  // Real-time events
  onRuntimeEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("runtime:event", listener);
    return () => {
      ipcRenderer.removeListener("runtime:event", listener);
    };
  }
};

contextBridge.exposeInMainWorld("openbrowse", api);

export type PreloadApi = typeof api;
