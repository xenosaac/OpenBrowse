import { app, BrowserWindow } from "electron";
import path from "node:path";
import { createDesktopBootstrap } from "./bootstrap";
import { registerIpcHandlers } from "./ipc/registerIpcHandlers";
import { shutdownRuntime } from "@openbrowse/runtime-core";
import { RuntimeEventBridge } from "./RuntimeEventBridge";

let mainWindow: BrowserWindow | null = null;
let desktopBootstrap: Awaited<ReturnType<typeof createDesktopBootstrap>> | null = null;
let runtimeBridge: RuntimeEventBridge | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    title: "OpenBrowse",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 14 },
    backgroundColor: "#0a0a10", // must match colors.bgBase in renderer/styles/tokens.ts
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

async function createAndBootstrapWindow(): Promise<BrowserWindow> {
  const window = createWindow();
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  // macOS: window reopened while runtime is already running — reattach shell and bridge.
  if (desktopBootstrap && runtimeBridge) {
    desktopBootstrap.browserShell.reattach(window);
    runtimeBridge.attachWindow(window);
    registerIpcHandlers(
      desktopBootstrap.services,
      desktopBootstrap.browserShell,
      window,
      desktopBootstrap.demoRegistry
    );
    desktopBootstrap = { ...desktopBootstrap, mainWindow: window };
    mainWindow = window;
    runtimeBridge.sendReopenSignal();
    return window;
  }

  // First window: full bootstrap, recovery, and event wiring.
  const bootstrap = await createDesktopBootstrap(window);
  desktopBootstrap = bootstrap;
  mainWindow = window;

  runtimeBridge = new RuntimeEventBridge(bootstrap.services, window);
  runtimeBridge.attachEventBus();
  runtimeBridge.registerRecoveryIpc();
  await runtimeBridge.runStartupRecovery();
  runtimeBridge.sendStartupSignals();

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
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async () => {
  if (desktopBootstrap) {
    await shutdownRuntime(desktopBootstrap.services);
  }
});
