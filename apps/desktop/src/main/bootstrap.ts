import { app, type BrowserWindow } from "electron";
import path from "node:path";
import { AppBrowserShell } from "./browser/AppBrowserShell";
import { createDefaultDemoRegistry, type DemoRegistry } from "@openbrowse/demo-flows";
import { registerIpcHandlers } from "./ipc/registerIpcHandlers";
import { composeRuntime } from "./runtime/composeRuntime";
import { migrateJsonToSqlite } from "./runtime/migrateJsonToSqlite";
import { loadWatches } from "./runtime/watchPersistence";
import {
  hydrateRuntimeSettings,
  markBrowserRuntimeInitFailed,
  markChatBridgeInitFailed,
  wireInboundChat,
  wireBotCommands,
  buildStartupDiagnostic,
  formatDiagnosticLog,
  type RuntimeServices
} from "@openbrowse/runtime-core";
import { SCHEMA_VERSION } from "@openbrowse/memory-store";

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

  // Restore persisted watches after all services are initialized.
  let restoredWatchCount = 0;
  try {
    const watchesJsonPath = path.join(app.getPath("userData"), "watches.json");
    const savedWatches = await loadWatches(watchesJsonPath);
    for (const w of savedWatches) {
      const metadata: Record<string, string> = {};
      if (w.startUrl) metadata.startUrl = w.startUrl;
      const intent = {
        id: `task_watch_${Date.now()}`,
        goal: w.startUrl ? `${w.goal} (start at ${w.startUrl})` : w.goal,
        constraints: [] as string[],
        metadata,
        source: "scheduler" as const,
        createdAt: new Date().toISOString(),
      };
      const watchId = await services.scheduler.registerWatch(intent, w.intervalMinutes);
      if (w.lastExtractedData && w.lastExtractedData.length > 0 && services.scheduler.updateWatchData) {
        services.scheduler.updateWatchData(watchId, w.lastExtractedData);
      }
    }
    restoredWatchCount = savedWatches.length;
    if (savedWatches.length > 0) {
      console.log(`[bootstrap] Restored ${savedWatches.length} saved watch(es).`);
    }
  } catch (error) {
    console.error("[bootstrap] Failed to restore watches:", error);
  }

  // Emit startup diagnostic summary.
  try {
    const allRuns = await services.runCheckpointStore.listAll();
    const diag = buildStartupDiagnostic({
      appVersion: app.getVersion(),
      schemaVersion: SCHEMA_VERSION,
      runCount: allRuns.length,
      watchCount: restoredWatchCount,
      telegramConfigured: !!services.runtimeSettings.telegramBotToken,
      plannerApiKeyPresent: !!services.runtimeSettings.anthropicApiKey
    });
    console.log(formatDiagnosticLog(diag));
    mainWindow.webContents.send("diagnostics:startup", diag);
  } catch (error) {
    console.error("[bootstrap] Failed to emit startup diagnostic:", error);
  }

  return { browserShell, services, mainWindow, demoRegistry };
}
