import { app, type BrowserWindow } from "electron";
import path from "node:path";
import { AppBrowserShell } from "./browser/AppBrowserShell";
import { createDefaultDemoRegistry, type DemoRegistry } from "@openbrowse/demo-flows";
import { registerIpcHandlers } from "./ipc/registerIpcHandlers";
import {
  composeRuntime,
  type RuntimeServices
} from "./runtime/composeRuntime";
import {
  hydrateRuntimeSettings,
  markBrowserRuntimeInitFailed,
  markChatBridgeInitFailed,
  wireInboundChat
} from "@openbrowse/runtime-core";

export interface DesktopBootstrap {
  browserShell: AppBrowserShell;
  services: RuntimeServices;
  mainWindow: BrowserWindow;
  demoRegistry: DemoRegistry;
}

export async function createDesktopBootstrap(mainWindow: BrowserWindow): Promise<DesktopBootstrap> {
  const dbPath = path.join(app.getPath("userData"), "openbrowse.db");

  const browserShell = new AppBrowserShell();
  browserShell.attach(mainWindow);

  const services = await composeRuntime({
    dbPath,
    mainWindow,
    hasDemos: true,
    viewProvider: browserShell
  });

  await hydrateRuntimeSettings(services);
  const demoRegistry = createDefaultDemoRegistry();
  services.executionResolver = {
    resolveForIntent: (intent, runtimeServices) =>
      demoRegistry.resolveServicesForIntent(intent, runtimeServices),
    resolveForRun: (run, runtimeServices) =>
      demoRegistry.resolveServicesForRun(run, runtimeServices)
  };

  registerIpcHandlers(services, browserShell, mainWindow, demoRegistry);
  wireInboundChat(services);

  try {
    await services.browserKernelInit?.();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[bootstrap] Browser runtime init failed:", message);
    markBrowserRuntimeInitFailed(services, message);
  }

  try {
    await services.chatBridgeInit?.();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[bootstrap] Telegram bridge init failed:", message);
    markChatBridgeInitFailed(services, message);
  }

  return { browserShell, services, mainWindow, demoRegistry };
}
