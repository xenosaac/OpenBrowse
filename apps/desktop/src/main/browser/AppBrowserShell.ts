import type { BrowserWindow, WebContentsView } from "electron";
import type { EmbeddedViewProvider } from "@openbrowse/browser-runtime";
import { BrowserViewManager } from "./BrowserViewManager";
import type { BrowserShellTabDescriptor, BrowserViewportBounds } from "../../shared/runtime";
import fs from "node:fs";
import path from "node:path";

interface PersistedTab {
  id: string;
  url: string;
  profileId: string;
}

export class AppBrowserShell implements EmbeddedViewProvider {
  private viewManager: BrowserViewManager | null = null;
  private readonly standaloneTabIds = new Set<string>();
  private standaloneTabCounter = 0;

  constructor(private readonly storagePath?: string) {}

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

  setLoadingCallback(cb: (sessionId: string, isLoading: boolean) => void): void {
    if (this.viewManager) {
      this.viewManager.onLoadingStateChanged = cb;
    }
  }

  setFaviconCallback(cb: (sessionId: string, faviconUrl: string) => void): void {
    if (this.viewManager) {
      this.viewManager.onFaviconUpdated = cb;
    }
  }

  // --- Standalone tab management ---

  createStandaloneTab(url = "about:blank"): BrowserShellTabDescriptor {
    if (!this.viewManager) {
      throw new Error("BrowserViewManager not attached to a host window");
    }
    this.standaloneTabCounter++;
    const tabId = `standalone_${Date.now()}_${this.standaloneTabCounter}`;
    const managed = this.viewManager.create(tabId, "standalone", "persist:standalone");
    this.standaloneTabIds.add(tabId);
    void managed.view.webContents.loadURL(url);
    void this.saveStandaloneTabs();
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
    void this.saveStandaloneTabs();
  }

  isStandaloneTab(tabId: string): boolean {
    return this.standaloneTabIds.has(tabId);
  }

  // --- Standalone tab persistence ---

  private get tabsFilePath(): string | null {
    return this.storagePath ? path.join(this.storagePath, "standalone-tabs.json") : null;
  }

  private async saveStandaloneTabs(): Promise<void> {
    const filePath = this.tabsFilePath;
    if (!filePath || !this.viewManager) return;

    const tabs: PersistedTab[] = this.viewManager
      .list()
      .filter((v) => this.standaloneTabIds.has(v.id))
      .map((v) => ({ id: v.id, url: v.url || "about:blank", profileId: "standalone" }));

    try {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, JSON.stringify(tabs, null, 2), "utf-8");
    } catch (err) {
      console.error("[AppBrowserShell] Failed to save standalone tabs:", err);
    }
  }

  private async loadStandaloneTabs(): Promise<PersistedTab[]> {
    const filePath = this.tabsFilePath;
    if (!filePath) return [];

    try {
      const data = await fs.promises.readFile(filePath, "utf-8");
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async restoreStandaloneTabs(): Promise<BrowserShellTabDescriptor[]> {
    const saved = await this.loadStandaloneTabs();
    const restored: BrowserShellTabDescriptor[] = [];
    for (const entry of saved) {
      try {
        const tab = this.createStandaloneTab(entry.url);
        restored.push(tab);
      } catch (err) {
        console.error("[AppBrowserShell] Failed to restore standalone tab:", err);
      }
    }
    return restored;
  }
}
