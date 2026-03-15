import type { BrowserWindow, WebContentsView } from "electron";
import type { EmbeddedViewProvider } from "@openbrowse/browser-runtime";
import { BrowserViewManager } from "./BrowserViewManager";
import type { BrowserShellTabDescriptor, BrowserViewportBounds } from "../../shared/runtime";

export class AppBrowserShell implements EmbeddedViewProvider {
  private viewManager: BrowserViewManager | null = null;
  private readonly standaloneTabIds = new Set<string>();
  private standaloneTabCounter = 0;

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

  // --- Navigation ---

  navigateTo(sessionId: string, url: string): void {
    this.viewManager?.navigate(sessionId, url);
  }

  goBack(sessionId: string): void {
    this.viewManager?.goBack(sessionId);
  }

  goForward(sessionId: string): void {
    this.viewManager?.goForward(sessionId);
  }

  reload(sessionId: string): void {
    this.viewManager?.reload(sessionId);
  }

  getNavState(sessionId: string): { canGoBack: boolean; canGoForward: boolean; url: string; title: string } | null {
    return this.viewManager?.getNavState(sessionId) ?? null;
  }

  setNavigationCallback(cb: (sessionId: string, url: string, title: string) => void): void {
    if (this.viewManager) {
      this.viewManager.onNavigate = cb;
    }
  }

  // --- Standalone tab management ---

  createStandaloneTab(url = "about:blank"): BrowserShellTabDescriptor {
    if (!this.viewManager) {
      throw new Error("BrowserViewManager not attached to a host window");
    }
    this.standaloneTabCounter++;
    const tabId = `standalone_${Date.now()}_${this.standaloneTabCounter}`;
    const managed = this.viewManager.create(tabId, "standalone", `persist:standalone-${tabId}`);
    this.standaloneTabIds.add(tabId);
    void managed.view.webContents.loadURL(url);
    return {
      id: tabId,
      runId: tabId,
      groupId: tabId,
      title: "New Tab",
      url,
      profileId: "standalone",
      source: "desktop",
      status: "running",
      isBackground: false,
      closable: true
    };
  }

  listStandaloneTabs(): BrowserShellTabDescriptor[] {
    if (!this.viewManager) return [];
    return this.viewManager
      .list()
      .filter((v) => this.standaloneTabIds.has(v.id))
      .map((v) => ({
        id: v.id,
        runId: v.id,
        groupId: v.id,
        title: v.title || "New Tab",
        url: v.url || "about:blank",
        profileId: "standalone",
        source: "desktop" as const,
        status: "running" as const,
        isBackground: false,
        closable: true
      }));
  }

  closeStandaloneTab(tabId: string): void {
    this.standaloneTabIds.delete(tabId);
    this.viewManager?.destroy(tabId);
  }

  isStandaloneTab(tabId: string): boolean {
    return this.standaloneTabIds.has(tabId);
  }
}
