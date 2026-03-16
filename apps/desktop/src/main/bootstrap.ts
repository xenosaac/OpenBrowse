import { app, type BrowserWindow } from "electron";
import path from "node:path";
import { AppBrowserShell } from "./browser/AppBrowserShell";
import { createDefaultDemoRegistry, type DemoRegistry } from "@openbrowse/demo-flows";
import { registerIpcHandlers } from "./ipc/registerIpcHandlers";
import { composeRuntime } from "./runtime/composeRuntime";
import { migrateJsonToSqlite } from "./runtime/migrateJsonToSqlite";
import {
  hydrateRuntimeSettings,
  markBrowserRuntimeInitFailed,
  markChatBridgeInitFailed,
  wireInboundChat,
  wireBotCommands,
  type RuntimeServices
} from "@openbrowse/runtime-core";

export interface DesktopBootstrap {
  browserShell: AppBrowserShell;
  services: RuntimeServices;
  mainWindow: BrowserWindow;
  demoRegistry: DemoRegistry;
}

export async function createDesktopBootstrap(mainWindow: BrowserWindow): Promise<DesktopBootstrap> {
  const dbPath = path.join(app.getPath("userData"), "openbrowse.db");

  const browserShell = new AppBrowserShell(path.join(app.getPath("userData"), "browser-shell"));
  browserShell.attach(mainWindow);

  const services = await composeRuntime({
    dbPath,
    mainWindow,
    hasDemos: true,
    viewProvider: browserShell
  });

  await migrateJsonToSqlite(services, {
    profilesJsonPath: path.join(
      services.runtimeConfig.managedProfilesPath.replace(/^~/, process.env.HOME ?? ""),
      "profiles.json"
    ),
    standaloneTabsJsonPath: path.join(app.getPath("userData"), "browser-shell", "standalone-tabs.json"),
    telegramStateJsonPath: services.telegramStatePath
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
  wireBotCommands(services);

  try {
    await services.browserKernelInit?.();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[bootstrap] Browser runtime init failed:", message);
    markBrowserRuntimeInitFailed(services, message);
  }

  // Restore persisted standalone tabs after the browser kernel is ready.
  try {
    const restoredTabs = await browserShell.restoreStandaloneTabs();
    for (const tab of restoredTabs) {
      mainWindow.webContents.send("runtime:event", { type: "standalone_tab_created", tab });
    }
  } catch (error) {
    console.error("[bootstrap] Failed to restore standalone tabs:", error);
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
