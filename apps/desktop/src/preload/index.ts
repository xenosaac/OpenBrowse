import { contextBridge, ipcRenderer } from "electron";
import type {
  BrowserShellTabDescriptor,
  BrowserViewportBounds,
  RecoverySummary,
  RuntimeDescriptor,
  RuntimeSettings
} from "../shared/runtime";
import type { TaskRun } from "@openbrowse/contracts";

const api = {
  version: "0.1.0",

  // Task operations
  startTask: (intent: unknown): Promise<TaskRun> => ipcRenderer.invoke("task:start", intent),
  resumeTask: (message: unknown) => ipcRenderer.invoke("task:resume", message),
  cancelTask: (runId: string): Promise<TaskRun | null> => ipcRenderer.invoke("task:cancel", runId),

  // Query operations
  listRuns: () => ipcRenderer.invoke("runs:list"),
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
