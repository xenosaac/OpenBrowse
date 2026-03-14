import path from "node:path";
import {
  ElectronBrowserKernel,
  StubBrowserKernel,
  type BrowserKernel,
  type EmbeddedViewProvider
} from "@openbrowse/browser-runtime";
import type { BrowserWindow } from "electron";
import type { RuntimeConfig, RuntimeDescriptor } from "@openbrowse/contracts";
import { createDefaultRuntimeSettings } from "@openbrowse/contracts";
import {
  assembleRuntimeServices,
  createChatBridge,
  createPlanner,
  createRuntimeStorage,
  type RuntimeServices
} from "@openbrowse/runtime-core";


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
    options.enableRemoteChat ?? process.env.OPENBROWSE_DISABLE_TELEGRAM !== "1";
  const enableModelPlanner =
    options.enableModelPlanner ??
    (Boolean(runtimeSettings.anthropicApiKey.trim() || process.env.ANTHROPIC_API_KEY) &&
      process.env.OPENBROWSE_DISABLE_MODEL_PLANNER !== "1");

  const storage = await createRuntimeStorage(options.dbPath);
  const plannerSetup = createPlanner(enableModelPlanner, runtimeSettings);

  const telegramStatePath = options.dbPath
    ? path.join(path.dirname(options.dbPath), "telegram-bridge-state.json")
    : path.resolve(process.cwd(), "openbrowse-telegram-state.json");
  const chatBridgeSetup = createChatBridge(enableRemoteChat, telegramStatePath, runtimeSettings);

  const resolvedProfilesPath = runtimeConfig.managedProfilesPath.replace(/^~/, process.env.HOME ?? "");
  const browserKernelSetup = createBrowserKernel(
    options.mainWindow,
    enableExperimentalBrowser,
    resolvedProfilesPath,
    options.viewProvider
  );

  return assembleRuntimeServices({
    runtimeConfig,
    runtimeSettings,
    planner: plannerSetup.planner,
    plannerDescriptor: plannerSetup.descriptor,
    chatBridge: chatBridgeSetup.chatBridge,
    chatBridgeInit: chatBridgeSetup.chatBridgeInit,
    chatBridgeDescriptor: chatBridgeSetup.descriptor,
    browserKernel: browserKernelSetup.browserKernel,
    browserKernelInit: browserKernelSetup.browserKernelInit,
    browserDescriptor: browserKernelSetup.descriptor,
    ...storage,
    hasDemos: options.hasDemos,
    telegramStatePath
  });
}
