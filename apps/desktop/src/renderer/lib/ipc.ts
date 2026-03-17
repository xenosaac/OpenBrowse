import type { BrowserProfile, RunHandoffArtifact, TaskRun, WorkflowEvent } from "@openbrowse/contracts";
import type { ReplayStep } from "@openbrowse/observability";
import type {
  BrowserShellTabDescriptor,
  RecoverySummary,
  RuntimeDescriptor,
  RuntimeSettings
} from "../../shared/runtime";

/**
 * Wraps an async IPC call so that both synchronous throws (e.g., handler
 * missing on window.openbrowse) and async rejections return a safe fallback
 * instead of crashing the renderer.
 */
export async function safeCall<T>(
  fn: () => T | Promise<T>,
  fallback: T,
  channel: string,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[IPC] ${channel} failed:`, err);
    return fallback;
  }
}

/**
 * Wraps a void IPC call (fire-and-forget) so that synchronous throws
 * are swallowed with a warning instead of crashing the renderer.
 */
export function safeVoid(fn: () => void, channel: string): void {
  try {
    fn();
  } catch (err) {
    console.warn(`[IPC] ${channel} failed:`, err);
  }
}

/**
 * Typed wrapper around all `window.openbrowse.*` calls, organized by domain.
 * Every call is wrapped with safeCall/safeVoid so that missing or broken IPC
 * handlers degrade gracefully instead of crashing the renderer.
 */
export const ipc = {
  tasks: {
    start: (intent: unknown) =>
      safeCall(() => window.openbrowse.startTask(intent), null as TaskRun | null, "tasks:start"),
    resume: (message: unknown) =>
      safeCall(() => window.openbrowse.resumeTask(message), null as TaskRun | null, "tasks:resume"),
    cancel: (runId: string) =>
      safeCall(() => window.openbrowse.cancelTask(runId), null as TaskRun | null, "tasks:cancel"),
    list: () =>
      safeCall(() => window.openbrowse.listRuns(), [] as TaskRun[], "tasks:list"),
    get: (runId: string) =>
      safeCall(() => window.openbrowse.getRun(runId), null as TaskRun | null, "tasks:get"),
  },
  browser: {
    showSession: (sessionId: string) =>
      safeVoid(() => window.openbrowse.showBrowserSession(sessionId), "browser:showSession"),
    hideSession: () =>
      safeVoid(() => window.openbrowse.hideBrowserSession(), "browser:hideSession"),
    newTab: (url?: string) =>
      safeCall(() => window.openbrowse.browserNewTab(url), null as BrowserShellTabDescriptor | null, "browser:newTab"),
    navigate: (sessionId: string, url: string) =>
      safeVoid(() => window.openbrowse.browserNavigate(sessionId, url), "browser:navigate"),
    back: (sessionId: string) =>
      safeVoid(() => window.openbrowse.browserBack(sessionId), "browser:back"),
    forward: (sessionId: string) =>
      safeVoid(() => window.openbrowse.browserForward(sessionId), "browser:forward"),
    reload: (sessionId: string) =>
      safeVoid(() => window.openbrowse.browserReload(sessionId), "browser:reload"),
    navState: (sessionId: string) =>
      safeCall(() => window.openbrowse.browserNavState(sessionId), null as {
        canGoBack: boolean;
        canGoForward: boolean;
        url: string;
        title: string;
      } | null, "browser:navState"),
    setViewport: (bounds: { x: number; y: number; width: number; height: number }) =>
      safeVoid(() => window.openbrowse.setBrowserViewport(bounds), "browser:setViewport"),
    clearViewport: () =>
      safeVoid(() => window.openbrowse.clearBrowserViewport(), "browser:clearViewport"),
    closeGroup: (groupId: string) =>
      safeCall(() => window.openbrowse.closeBrowserGroup(groupId), null as TaskRun | null, "browser:closeGroup"),
    listTabs: () =>
      safeCall(() => window.openbrowse.listTabs(), [] as BrowserShellTabDescriptor[], "browser:listTabs"),
    listProfiles: () =>
      safeCall(() => window.openbrowse.listProfiles(), [] as BrowserProfile[], "browser:listProfiles"),
  },
  runtime: {
    describe: () =>
      safeCall(() => window.openbrowse.describeRuntime(), null as RuntimeDescriptor | null, "runtime:describe"),
    getSettings: () =>
      safeCall(() => window.openbrowse.getSettings(), null as RuntimeSettings | null, "runtime:getSettings"),
    saveSettings: (settings: RuntimeSettings) =>
      safeCall(() => window.openbrowse.saveSettings(settings), null as {
        settings: RuntimeSettings;
        descriptor: RuntimeDescriptor;
      } | null, "runtime:saveSettings"),
    getLastRecoveryReport: () =>
      safeCall(() => window.openbrowse.getLastRecoveryReport(), null as RecoverySummary | null, "runtime:getLastRecoveryReport"),
  },
  logs: {
    list: (runId: string) =>
      safeCall(() => window.openbrowse.listLogs(runId), [] as WorkflowEvent[], "logs:list"),
    replay: (runId: string) =>
      safeCall(() => window.openbrowse.replayLogs(runId), [] as ReplayStep[], "logs:replay"),
  },
  demos: {
    list: () =>
      safeCall(() => window.openbrowse.listDemos(), [] as unknown[], "demos:list"),
    run: (demoId: string) =>
      safeVoid(() => window.openbrowse.runDemo(demoId), "demos:run"),
    watch: (demoId: string, intervalMinutes: number) =>
      safeVoid(() => window.openbrowse.watchDemo(demoId, intervalMinutes), "demos:watch"),
    listTaskPacks: () =>
      safeCall(() => window.openbrowse.listTaskPacks(), [] as unknown[], "demos:listTaskPacks"),
    runTaskPack: (packId: string) =>
      safeVoid(() => window.openbrowse.runTaskPack(packId), "demos:runTaskPack"),
  },
  handoff: {
    get: (runId: string) =>
      safeCall(() => window.openbrowse.getRunHandoff(runId), null as {
        artifact: RunHandoffArtifact;
        markdown: string;
      } | null, "handoff:get"),
  },
  scheduler: {
    list: () =>
      safeCall(() => window.openbrowse.listWatches(), [] as Array<{
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
      }>, "scheduler:list"),
    register: (params: { goal: string; startUrl?: string; intervalMinutes: number }) =>
      safeCall(() => window.openbrowse.registerWatch(params), null as { watchId: string } | null, "scheduler:register"),
    unregister: (watchId: string) =>
      safeCall(() => window.openbrowse.unregisterWatch(watchId), { ok: false }, "scheduler:unregister"),
  },
  templates: {
    list: () =>
      safeCall(() => window.openbrowse.listTemplates(), [] as Array<{
        id: string; name: string; goal: string; createdAt: string;
      }>, "templates:list"),
    save: (template: { goal: string; name?: string }) =>
      safeCall(() => window.openbrowse.saveTemplate(template), null as {
        id: string; name: string; goal: string; createdAt: string;
      } | null, "templates:save"),
    delete: (templateId: string) =>
      safeCall(() => window.openbrowse.deleteTemplate(templateId), { ok: false }, "templates:delete"),
  },
  file: {
    saveExtracted: (params: { data: string; defaultName: string; format: "json" | "csv" }) =>
      safeCall(() => window.openbrowse.saveExtractedData(params), { ok: false }, "file:saveExtracted"),
  },
  events: {
    subscribe: (callback: (event: unknown) => void) => {
      try {
        return window.openbrowse.onRuntimeEvent(callback);
      } catch (err) {
        console.warn("[IPC] events:subscribe failed:", err);
        return () => {}; // no-op cleanup
      }
    },
  },
} as const;
