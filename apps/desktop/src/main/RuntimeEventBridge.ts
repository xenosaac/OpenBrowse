import { ipcMain, type BrowserWindow } from "electron";
import { RecoveryManager, type RuntimeServices } from "@openbrowse/runtime-core";
import type { RecoverySummary } from "@openbrowse/contracts";

/**
 * Bridges runtime-core events and lifecycle hooks into the Electron shell.
 * Encapsulates: workflow event forwarding, startup recovery, and recovery IPC.
 * Created once per runtime; re-pointed at new windows when macOS reopens one.
 */
export class RuntimeEventBridge {
  private lastRecoveryReport: RecoverySummary | null = null;

  constructor(
    private readonly services: RuntimeServices,
    private mainWindow: BrowserWindow
  ) {}

  /** Update the target window (called when macOS reopens a closed window). */
  attachWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  /** Subscribe to the runtime event bus and forward workflow events to the renderer. */
  attachEventBus(): void {
    this.services.eventBus.subscribe("workflow", async (event) => {
      if (!this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send("runtime:event", { type: "workflow_event", event });
      }
    });
  }

  /** Register the IPC handler that lets the renderer query the last recovery report. */
  registerRecoveryIpc(): void {
    ipcMain.removeHandler("runtime:last-recovery");
    ipcMain.handle("runtime:last-recovery", async () => this.lastRecoveryReport);
  }

  /** Run startup recovery and cache the summary for subsequent IPC queries. */
  async runStartupRecovery(): Promise<void> {
    const manager = new RecoveryManager(this.services);
    const report = await manager.recoverInterruptedRuns();
    const total =
      report.resumed.length + report.awaitingInput.length + report.failed.length + report.skipped.length;

    this.lastRecoveryReport =
      total > 0
        ? {
            resumed: report.resumed.length,
            awaitingInput: report.awaitingInput.length,
            failed: report.failed.length,
            skipped: report.skipped.length
          }
        : null;

    if (total > 0) {
      console.log(
        `[startup] Recovery summary: resumed=${report.resumed.length}, awaiting_input=${report.awaitingInput.length}, failed=${report.failed.length}`
      );
    }
  }

  /** Send runtime_ready + recovery_complete (if applicable) once the window is ready. */
  sendStartupSignals(): void {
    const send = () => {
      this.mainWindow.webContents.send("runtime:event", {
        type: "runtime_ready",
        descriptor: this.services.descriptor
      });
      if (this.lastRecoveryReport) {
        this.mainWindow.webContents.send("runtime:event", {
          type: "recovery_complete",
          report: this.lastRecoveryReport
        });
      }
    };

    if (this.mainWindow.webContents.isLoading()) {
      this.mainWindow.webContents.once("did-finish-load", send);
    } else {
      send();
    }
  }

  /** Send only runtime_ready — used when reopening a window without re-running recovery. */
  sendReopenSignal(): void {
    const send = () => {
      this.mainWindow.webContents.send("runtime:event", {
        type: "runtime_ready",
        descriptor: this.services.descriptor
      });
    };

    if (this.mainWindow.webContents.isLoading()) {
      this.mainWindow.webContents.once("did-finish-load", send);
    } else {
      send();
    }
  }
}
