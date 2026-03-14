import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { createDesktopBootstrap } from "./bootstrap";
import { registerIpcHandlers } from "./ipc/registerIpcHandlers";
import { RecoveryManager, shutdownRuntime } from "@openbrowse/runtime-core";
import type { RecoverySummary } from "@openbrowse/contracts";

let mainWindow: BrowserWindow | null = null;
let desktopBootstrap: Awaited<ReturnType<typeof createDesktopBootstrap>> | null = null;
let lastRecoveryReport: RecoverySummary | null = null;
let workflowSubscriptionAttached = false;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    title: "OpenBrowse",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 14 },
    backgroundColor: "#f4efe6",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  return win;
}

function attachWindowLifecycle(window: BrowserWindow): void {
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });
}

async function createAndBootstrapWindow(): Promise<BrowserWindow> {
  const window = createWindow();
  attachWindowLifecycle(window);

  if (desktopBootstrap) {
    desktopBootstrap.browserShell.reattach(window);
    registerIpcHandlers(desktopBootstrap.services, desktopBootstrap.browserShell, window, desktopBootstrap.demoRegistry);
    desktopBootstrap = {
      ...desktopBootstrap,
      mainWindow: window
    };
    mainWindow = window;
    window.webContents.once("did-finish-load", () => {
      window.webContents.send("runtime:event", {
        type: "runtime_ready",
        descriptor: desktopBootstrap?.services.descriptor
      });
    });
    return window;
  }

  const bootstrap = await createDesktopBootstrap(window);
  desktopBootstrap = bootstrap;
  mainWindow = window;

  if (!workflowSubscriptionAttached) {
    bootstrap.services.eventBus.subscribe("workflow", async (event) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("runtime:event", {
          type: "workflow_event",
          event
        });
      }
    });
    workflowSubscriptionAttached = true;
  }

  ipcMain.removeHandler("runtime:last-recovery");
  ipcMain.handle("runtime:last-recovery", async () => lastRecoveryReport);

  const recovery = new RecoveryManager(bootstrap.services);
  const recoveryReport = await recovery.recoverInterruptedRuns();
  const recoveredCount = recoveryReport.resumed.length;
  const awaitingInputCount = recoveryReport.awaitingInput.length;
  const failedCount = recoveryReport.failed.length;
  const skippedCount = recoveryReport.skipped.length;
  const totalRecoveryCount = recoveredCount + awaitingInputCount + failedCount + skippedCount;
  lastRecoveryReport =
    totalRecoveryCount > 0
      ? {
          resumed: recoveredCount,
          awaitingInput: awaitingInputCount,
          failed: failedCount,
          skipped: skippedCount
        }
      : null;

  if (totalRecoveryCount > 0) {
    console.log(
      `[startup] Recovery summary: resumed=${recoveredCount}, awaiting_input=${awaitingInputCount}, failed=${failedCount}`
    );
  }

  const sendReady = () => {
    window.webContents.send("runtime:event", {
      type: "runtime_ready",
      descriptor: bootstrap.services.descriptor
    });

    if (totalRecoveryCount > 0) {
      window.webContents.send("runtime:event", {
        type: "recovery_complete",
        report: lastRecoveryReport
      });
    }
  };

  if (window.webContents.isLoading()) {
    window.webContents.once("did-finish-load", sendReady);
  } else {
    sendReady();
  }

  return window;
}

app.setAboutPanelOptions({
  applicationName: "OpenBrowse",
  applicationVersion: "0.1.0",
  copyright: "Local-first agentic browser for macOS",
  version: `Electron ${process.versions.electron}`
});

app.whenReady().then(async () => {
  await createAndBootstrapWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createAndBootstrapWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async () => {
  if (desktopBootstrap) {
    await shutdownRuntime(desktopBootstrap.services);
  }
});
