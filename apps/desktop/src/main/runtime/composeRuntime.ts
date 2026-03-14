import path from "node:path";
import { StubBrowserKernel, ElectronBrowserKernel, type BrowserKernel, type EmbeddedViewProvider } from "@openbrowse/browser-runtime";
import type { BrowserWindow } from "electron";
import type {
  RuntimeConfig,
  RuntimeDescriptor,
  TaskIntent,
  WorkflowEvent
} from "@openbrowse/contracts";
import { createDefaultRuntimeSettings } from "@openbrowse/contracts";
import {
  InMemoryPreferenceStore,
  InMemoryRunCheckpointStore,
  InMemoryWorkflowLogStore,
  type PreferenceStore,
  type RunCheckpointStore,
  type WorkflowLogStore
} from "@openbrowse/memory-store/memory";
import { EventBus } from "@openbrowse/observability";
import { DefaultClarificationPolicy, TaskOrchestrator } from "@openbrowse/orchestrator";
import { IntervalWatchScheduler, type WatchScheduler } from "@openbrowse/scheduler";
import { DefaultApprovalPolicy } from "@openbrowse/security";
import {
  bootstrapRun as bootstrapRuntimeRun,
  buildRuntimeDescriptor,
  createChatBridge,
  createPlanner,
  type RuntimeServices
} from "@openbrowse/runtime-core";

export type { RuntimeServices } from "@openbrowse/runtime-core";

export function createDefaultRuntimeConfig(): RuntimeConfig {
  return {
    platform: "macos",
    siliconOnly: true,
    appName: "OpenBrowse",
    workflowLogPath: "~/Library/Application Support/OpenBrowse/workflow",
    managedProfilesPath: "~/Library/Application Support/OpenBrowse/profiles"
  };
}

export interface ComposeRuntimeOptions {
  runtimeConfig?: RuntimeConfig;
  dbPath?: string;
  mainWindow?: BrowserWindow;
  viewProvider?: EmbeddedViewProvider;
  enableExperimentalBrowser?: boolean;
  enableRemoteChat?: boolean;
  enableModelPlanner?: boolean;
  hasDemos?: boolean;
}

function createBrowserKernel(
  mainWindow: BrowserWindow | undefined,
  enableExperimentalBrowser: boolean,
  managedProfilesPath: string,
  viewProvider?: EmbeddedViewProvider
): {
  browserKernel: BrowserKernel;
  browserKernelInit?: () => Promise<void>;
  descriptor: RuntimeDescriptor["browser"];
} {
  if (mainWindow && enableExperimentalBrowser) {
    const kernel = new ElectronBrowserKernel(mainWindow, managedProfilesPath, viewProvider);
    return {
      browserKernel: kernel,
      browserKernelInit: () => kernel.init(),
      descriptor: {
        mode: "live",
        detail: viewProvider
          ? "Electron browser runtime is active with embedded views inside the main window."
          : "Electron-backed browser runtime is active with managed Chromium profiles."
      }
    };
  }

  return {
    browserKernel: new StubBrowserKernel(),
    descriptor: {
      mode: "stub",
      detail: "Browser runtime is disabled, so OpenBrowse falls back to the local stub kernel."
    }
  };
}

export async function composeRuntime(options: ComposeRuntimeOptions = {}): Promise<RuntimeServices> {
  const runtimeConfig = options.runtimeConfig ?? createDefaultRuntimeConfig();
  const runtimeSettings = createDefaultRuntimeSettings();
  const enableExperimentalBrowser =
    options.enableExperimentalBrowser ??
    (Boolean(options.mainWindow) && process.env.OPENBROWSE_DISABLE_BROWSER !== "1");
  const enableRemoteChat =
    options.enableRemoteChat ??
    (process.env.OPENBROWSE_DISABLE_TELEGRAM !== "1");
  const enableModelPlanner =
    options.enableModelPlanner ??
    (Boolean(runtimeSettings.anthropicApiKey.trim() || process.env.ANTHROPIC_API_KEY) &&
      process.env.OPENBROWSE_DISABLE_MODEL_PLANNER !== "1");

  let workflowLogStore: WorkflowLogStore;
  let runCheckpointStore: RunCheckpointStore;
  let preferenceStore: PreferenceStore;
  let sqliteDb: { close(): void } | undefined;
  let storageDescriptor: RuntimeDescriptor["storage"];

  if (options.dbPath) {
    try {
      const {
        SqliteDatabase,
        SqliteWorkflowLogStore,
        SqliteRunCheckpointStore,
        SqlitePreferenceStore
      } = await import("@openbrowse/memory-store/sqlite");

      const sqliteDbInstance = new SqliteDatabase(options.dbPath);
      workflowLogStore = new SqliteWorkflowLogStore(sqliteDbInstance);
      runCheckpointStore = new SqliteRunCheckpointStore(sqliteDbInstance);
      preferenceStore = new SqlitePreferenceStore(sqliteDbInstance);
      sqliteDb = sqliteDbInstance;
      storageDescriptor = {
        mode: "sqlite",
        detail: `Local SQLite persistence is enabled at ${options.dbPath}.`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[runtime] Failed to initialize SQLite store, falling back to memory:", message);
      workflowLogStore = new InMemoryWorkflowLogStore();
      runCheckpointStore = new InMemoryRunCheckpointStore();
      preferenceStore = new InMemoryPreferenceStore();
      storageDescriptor = {
        mode: "memory",
        detail: `Falling back to in-memory storage because SQLite failed to initialize: ${message}`
      };
    }
  } else {
    workflowLogStore = new InMemoryWorkflowLogStore();
    runCheckpointStore = new InMemoryRunCheckpointStore();
    preferenceStore = new InMemoryPreferenceStore();
    storageDescriptor = {
      mode: "memory",
      detail: "Falling back to in-memory storage because no desktop app data path was provided."
    };
  }

  const plannerSetup = createPlanner(enableModelPlanner, runtimeSettings);
  const telegramStatePath = options.dbPath
    ? path.join(path.dirname(options.dbPath), "telegram-bridge-state.json")
    : path.resolve(process.cwd(), "openbrowse-telegram-state.json");
  const chatBridgeSetup = createChatBridge(enableRemoteChat, telegramStatePath, runtimeSettings);
  const resolvedProfilesPath = runtimeConfig.managedProfilesPath.replace(/^~/, process.env.HOME ?? "");
  const browserKernelSetup = createBrowserKernel(options.mainWindow, enableExperimentalBrowser, resolvedProfilesPath, options.viewProvider);

  let services!: RuntimeServices;
  const scheduler: WatchScheduler = new IntervalWatchScheduler(async (intent) => {
    const schedulerIntent: TaskIntent = {
      ...intent,
      id: `${intent.id}_${Date.now()}`,
      source: "scheduler",
      createdAt: new Date().toISOString()
    };

    await bootstrapRuntimeRun(services, schedulerIntent);
  });

  services = {
    descriptor: buildRuntimeDescriptor({
      planner: plannerSetup.descriptor,
      browser: browserKernelSetup.descriptor,
      chatBridge: chatBridgeSetup.descriptor,
      storage: storageDescriptor,
      hasDemos: options.hasDemos
    }),
    browserKernel: browserKernelSetup.browserKernel,
    browserKernelInit: browserKernelSetup.browserKernelInit,
    chatBridge: chatBridgeSetup.chatBridge,
    chatBridgeInit: chatBridgeSetup.chatBridgeInit,
    eventBus: new EventBus<{ workflow: WorkflowEvent }>(),
    hasDemos: options.hasDemos,
    orchestrator: new TaskOrchestrator({
      clarificationPolicy: new DefaultClarificationPolicy()
    }),
    planner: plannerSetup.planner,
    preferenceStore,
    runCheckpointStore,
    runtimeConfig,
    runtimeSettings,
    scheduler,
    securityPolicy: new DefaultApprovalPolicy(),
    sqliteDb,
    telegramStatePath,
    workflowLogStore
  };

  return services;
}
