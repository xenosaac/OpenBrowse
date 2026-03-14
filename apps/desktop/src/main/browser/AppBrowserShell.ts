import type { BrowserWindow, WebContentsView } from "electron";
import type { EmbeddedViewProvider } from "@openbrowse/browser-runtime";
import { BrowserViewManager } from "./BrowserViewManager";
import type { BrowserViewportBounds } from "../../shared/runtime";

export class AppBrowserShell implements EmbeddedViewProvider {
  private viewManager: BrowserViewManager | null = null;

  attach(hostWindow: BrowserWindow): void {
    // On macOS the main window can be closed and recreated while the app stays alive.
    // Preserve live browser sessions by reattaching existing views instead of destroying them.
    if (this.viewManager) {
      this.viewManager.reattach(hostWindow);
    } else {
      this.viewManager = new BrowserViewManager(hostWindow);
    }
    hostWindow.on("resize", () => this.viewManager?.relayout());
  }

  reattach(hostWindow: BrowserWindow): void {
    this.attach(hostWindow);
  }

  get isAttached(): boolean {
    return this.viewManager !== null;
  }

  createView(sessionId: string, profileId: string, partition: string): { view: WebContentsView } {
    if (!this.viewManager) {
      throw new Error("BrowserViewManager not attached to a host window");
    }
    const managed = this.viewManager.create(sessionId, profileId, partition);
    return { view: managed.view };
  }

  destroyView(sessionId: string): void {
    this.viewManager?.destroy(sessionId);
  }

  showSession(sessionId: string): void {
    this.viewManager?.show(sessionId);
  }

  hideAllSessions(): void {
    this.viewManager?.hideAll();
  }

  getActiveSessionId(): string | null {
    return this.viewManager?.getActiveId() ?? null;
  }

  setViewportBounds(bounds: BrowserViewportBounds): void {
    this.viewManager?.setViewportBounds(bounds);
  }

  clearViewportBounds(): void {
    this.viewManager?.clearViewportBounds();
  }

  destroyAll(): void {
    this.viewManager?.destroyAll();
  }
}
