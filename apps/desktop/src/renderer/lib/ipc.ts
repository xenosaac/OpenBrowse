import type { BrowserProfile, RunHandoffArtifact, TaskRun, WorkflowEvent } from "@openbrowse/contracts";
import type { ReplayStep } from "@openbrowse/observability";
import type {
  BrowserShellTabDescriptor,
  RecoverySummary,
  RuntimeDescriptor,
  RuntimeSettings
} from "../../shared/runtime";

/**
 * Typed wrapper around all `window.openbrowse.*` calls, organized by domain.
 * Provides a single import for all IPC operations.
 */
export const ipc = {
  tasks: {
    start: (intent: unknown) => window.openbrowse.startTask(intent) as Promise<TaskRun>,
    resume: (message: unknown) => window.openbrowse.resumeTask(message) as Promise<TaskRun | null>,
    cancel: (runId: string) => window.openbrowse.cancelTask(runId) as Promise<TaskRun | null>,
    list: () => window.openbrowse.listRuns() as Promise<TaskRun[]>,
    get: (runId: string) => window.openbrowse.getRun(runId) as Promise<TaskRun | null>,
  },
  browser: {
    showSession: (sessionId: string) => window.openbrowse.showBrowserSession(sessionId),
    hideSession: () => window.openbrowse.hideBrowserSession(),
    newTab: (url?: string) => window.openbrowse.browserNewTab(url) as Promise<BrowserShellTabDescriptor>,
    navigate: (sessionId: string, url: string) => window.openbrowse.browserNavigate(sessionId, url),
    back: (sessionId: string) => window.openbrowse.browserBack(sessionId),
    forward: (sessionId: string) => window.openbrowse.browserForward(sessionId),
    reload: (sessionId: string) => window.openbrowse.browserReload(sessionId),
    navState: (sessionId: string) => window.openbrowse.browserNavState(sessionId) as Promise<{
      canGoBack: boolean;
      canGoForward: boolean;
      url: string;
      title: string;
    } | null>,
    setViewport: (bounds: { x: number; y: number; width: number; height: number }) =>
      window.openbrowse.setBrowserViewport(bounds),
    clearViewport: () => window.openbrowse.clearBrowserViewport(),
    closeGroup: (groupId: string) => window.openbrowse.closeBrowserGroup(groupId) as Promise<TaskRun | null>,
    listTabs: () => window.openbrowse.listTabs() as Promise<BrowserShellTabDescriptor[]>,
    listProfiles: () => window.openbrowse.listProfiles() as Promise<BrowserProfile[]>,
  },
  runtime: {
    describe: () => window.openbrowse.describeRuntime() as Promise<RuntimeDescriptor>,
    getSettings: () => window.openbrowse.getSettings() as Promise<RuntimeSettings>,
    saveSettings: (settings: RuntimeSettings) => window.openbrowse.saveSettings(settings) as Promise<{
      settings: RuntimeSettings;
      descriptor: RuntimeDescriptor;
    }>,
    getLastRecoveryReport: () => window.openbrowse.getLastRecoveryReport() as Promise<RecoverySummary | null>,
  },
  logs: {
    list: (runId: string) => window.openbrowse.listLogs(runId) as Promise<WorkflowEvent[]>,
    replay: (runId: string) => window.openbrowse.replayLogs(runId) as Promise<ReplayStep[]>,
  },
  demos: {
    list: () => window.openbrowse.listDemos(),
    run: (demoId: string) => window.openbrowse.runDemo(demoId),
    watch: (demoId: string, intervalMinutes: number) => window.openbrowse.watchDemo(demoId, intervalMinutes),
    listTaskPacks: () => window.openbrowse.listTaskPacks(),
    runTaskPack: (packId: string) => window.openbrowse.runTaskPack(packId),
  },
  handoff: {
    get: (runId: string) => window.openbrowse.getRunHandoff(runId) as Promise<{
      artifact: RunHandoffArtifact;
      markdown: string;
    } | null>,
  },
  scheduler: {
    list: () => window.openbrowse.listWatches() as Promise<Array<{
      id: string;
      intent: { id: string; goal: string; metadata?: Record<string, string> };
      intervalMinutes: number;
      active: boolean;
      createdAt: string;
      nextRunAt: string;
      lastTriggeredAt?: string;
      lastCompletedAt?: string;
      consecutiveFailures: number;
      lastError?: string;
      backoffUntil?: string;
    }>>,
    register: (params: { goal: string; startUrl?: string; intervalMinutes: number }) =>
      window.openbrowse.registerWatch(params) as Promise<{ watchId: string }>,
    unregister: (watchId: string) =>
      window.openbrowse.unregisterWatch(watchId) as Promise<{ ok: boolean }>,
  },
  events: {
    subscribe: (callback: (event: unknown) => void) => window.openbrowse.onRuntimeEvent(callback),
  },
} as const;
