import { dialog, type BrowserWindow, type WebContentsView } from "electron";
import type { EmbeddedViewProvider } from "@openbrowse/browser-runtime";
import { BrowserViewManager } from "./BrowserViewManager";
import type { BrowserShellTabDescriptor, BrowserViewportBounds } from "../../shared/runtime";
import fs from "node:fs";
import path from "node:path";

interface PersistedTab {
  id: string;
  url: string;
  profileId: string;
  pinned?: boolean;
}

export class AppBrowserShell implements EmbeddedViewProvider {
  private viewManager: BrowserViewManager | null = null;
  private readonly standaloneTabIds = new Set<string>();
  private readonly pinnedTabIds = new Set<string>();
  private standaloneTabOrder: string[] = [];
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

  // ---- Split view ----

  enterSplitView(leftId: string, rightId: string): void {
    this.viewManager?.showSplit(leftId, rightId);
  }

  exitSplitView(): void {
    this.viewManager?.exitSplit();
  }

  setSplitBounds(leftBounds: BrowserViewportBounds, rightBounds: BrowserViewportBounds): void {
    this.viewManager?.setSplitBounds(leftBounds, rightBounds);
  }

  isSplitView(): boolean {
    return this.viewManager?.isSplit() ?? false;
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

  findInPage(sessionId: string, text: string, options?: { forward?: boolean; findNext?: boolean }): void {
    this.viewManager?.findInPage(sessionId, text, options);
  }

  stopFindInPage(sessionId: string, action?: "clearSelection" | "keepSelection" | "activateSelection"): void {
    this.viewManager?.stopFindInPage(sessionId, action);
  }

  setFindCallback(cb: (sessionId: string, result: { activeMatchOrdinal: number; matches: number; finalUpdate: boolean }) => void): void {
    if (this.viewManager) {
      this.viewManager.onFindResult = cb;
    }
  }

  setContextMenuCallback(cb: (sessionId: string, params: {
    x: number; y: number; linkURL: string; linkText: string;
    selectionText: string; mediaType: string; srcURL: string; isEditable: boolean;
  }) => void): void {
    if (this.viewManager) {
      this.viewManager.onContextMenu = cb;
    }
  }

  inspectElement(sessionId: string, x: number, y: number): void {
    const managed = this.viewManager?.get(sessionId);
    if (managed && !managed.view.webContents.isDestroyed()) {
      managed.view.webContents.inspectElement(x, y);
    }
  }

  copyImageAt(sessionId: string, x: number, y: number): void {
    const managed = this.viewManager?.get(sessionId);
    if (managed && !managed.view.webContents.isDestroyed()) {
      managed.view.webContents.copyImageAt(x, y);
    }
  }

  executeEditCommand(sessionId: string, command: "cut" | "copy" | "paste" | "selectAll"): void {
    const managed = this.viewManager?.get(sessionId);
    if (managed && !managed.view.webContents.isDestroyed()) {
      managed.view.webContents[command]();
    }
  }

  zoomIn(sessionId: string): number {
    return this.viewManager?.zoomIn(sessionId) ?? 0;
  }

  zoomOut(sessionId: string): number {
    return this.viewManager?.zoomOut(sessionId) ?? 0;
  }

  resetZoom(sessionId: string): number {
    return this.viewManager?.resetZoom(sessionId) ?? 0;
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

  setLoadErrorCallback(cb: (sessionId: string, errorCode: number, errorDescription: string, validatedURL: string) => void): void {
    if (this.viewManager) {
      this.viewManager.onLoadError = cb;
    }
  }

  setDownloadCallback(cb: (info: import("./BrowserViewManager").DownloadInfo) => void): void {
    if (this.viewManager) {
      this.viewManager.onDownloadUpdated = cb;
    }
  }

  // --- DevTools / Print / PDF ---

  openDevTools(sessionId: string): void {
    const managed = this.viewManager?.get(sessionId);
    if (managed && !managed.view.webContents.isDestroyed()) {
      managed.view.webContents.openDevTools({ mode: "detach" });
    }
  }

  printPage(sessionId: string): void {
    const managed = this.viewManager?.get(sessionId);
    if (managed && !managed.view.webContents.isDestroyed()) {
      managed.view.webContents.print();
    }
  }

  async toggleReaderMode(sessionId: string): Promise<{ active: boolean; success: boolean }> {
    const managed = this.viewManager?.get(sessionId);
    if (!managed || managed.view.webContents.isDestroyed()) {
      return { active: false, success: false };
    }

    const result = await managed.view.webContents.executeJavaScript(`
      (function() {
        var overlay = document.getElementById('ob-reader-overlay');
        if (overlay) {
          overlay.remove();
          return { active: false, success: true };
        }

        // Find article content
        var article = document.querySelector('article');
        if (!article) article = document.querySelector('[role="main"]');
        if (!article) article = document.querySelector('main');
        if (!article) {
          var candidates = document.querySelectorAll('div, section');
          var best = null;
          var bestLen = 0;
          candidates.forEach(function(c) {
            var text = c.innerText || '';
            if (text.length > bestLen && c.querySelectorAll('p').length >= 2) {
              bestLen = text.length;
              best = c;
            }
          });
          article = best;
        }

        if (!article || (article.innerText || '').length < 100) {
          return { active: false, success: false };
        }

        var title = document.title || '';
        var content = article.innerHTML;

        var div = document.createElement('div');
        div.id = 'ob-reader-overlay';
        div.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#1a1a1a;overflow-y:auto;';
        div.innerHTML =
          '<div style="max-width:680px;margin:0 auto;padding:48px 24px 80px;color:#e0e0e0;font-family:Georgia,serif;line-height:1.75;font-size:18px;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:32px;">' +
              '<button id="ob-reader-close" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);color:#e0e0e0;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:14px;">Exit Reader Mode</button>' +
            '</div>' +
            '<h1 style="font-size:28px;line-height:1.3;margin-bottom:24px;color:#f5f5f5;">' + title.replace(/</g, '&lt;') + '</h1>' +
            '<div id="ob-reader-content">' + content + '</div>' +
          '</div>';

        document.body.appendChild(div);

        // Style images and links inside reader content
        var rc = document.getElementById('ob-reader-content');
        if (rc) {
          var imgs = rc.querySelectorAll('img');
          imgs.forEach(function(img) { img.style.maxWidth = '100%'; img.style.height = 'auto'; img.style.borderRadius = '6px'; img.style.margin = '16px 0'; });
          var links = rc.querySelectorAll('a');
          links.forEach(function(a) { a.style.color = '#6ee7b7'; });
          // Remove ads, nav, footer, aside inside content
          var junk = rc.querySelectorAll('nav, footer, aside, .ad, .advertisement, [role="complementary"], [role="banner"]');
          junk.forEach(function(el) { el.remove(); });
        }

        document.getElementById('ob-reader-close').addEventListener('click', function() {
          var ov = document.getElementById('ob-reader-overlay');
          if (ov) ov.remove();
        });

        return { active: true, success: true };
      })()
    `);

    return result as { active: boolean; success: boolean };
  }

  async saveAsPdf(sessionId: string): Promise<boolean> {
    const managed = this.viewManager?.get(sessionId);
    if (!managed || managed.view.webContents.isDestroyed()) return false;

    const title = managed.view.webContents.getTitle() || "page";
    const safeName = title.replace(/[^a-zA-Z0-9_\- ]/g, "").slice(0, 60) || "page";
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: `${safeName}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }]
    });
    if (canceled || !filePath) return false;

    const buffer = await managed.view.webContents.printToPDF({});
    await fs.promises.writeFile(filePath, buffer);
    return true;
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
    this.standaloneTabOrder.push(tabId);
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
    const viewMap = new Map(
      this.viewManager.list().filter((v) => this.standaloneTabIds.has(v.id)).map((v) => [v.id, v])
    );
    // Return tabs in saved order, appending any that aren't in the order array
    const ordered: string[] = [
      ...this.standaloneTabOrder.filter((id) => viewMap.has(id)),
      ...[...viewMap.keys()].filter((id) => !this.standaloneTabOrder.includes(id))
    ];
    return ordered.map((id) => {
      const v = viewMap.get(id)!;
      return {
        id: v.id,
        runId: v.id,
        groupId: v.id,
        title: v.title || "New Tab",
        url: v.url || "about:blank",
        profileId: "standalone",
        source: "desktop" as const,
        status: "running" as const,
        isBackground: false,
        closable: true,
        pinned: this.pinnedTabIds.has(v.id) || undefined
      };
    });
  }

  closeStandaloneTab(tabId: string): void {
    this.standaloneTabIds.delete(tabId);
    this.pinnedTabIds.delete(tabId);
    this.standaloneTabOrder = this.standaloneTabOrder.filter((id) => id !== tabId);
    this.viewManager?.destroy(tabId);
    void this.saveStandaloneTabs();
  }

  isStandaloneTab(tabId: string): boolean {
    return this.standaloneTabIds.has(tabId);
  }

  /** Remove a tab from the standalone set without destroying its view (agent is reusing it). */
  releaseStandaloneTab(tabId: string): boolean {
    if (!this.standaloneTabIds.has(tabId)) return false;
    this.standaloneTabIds.delete(tabId);
    this.pinnedTabIds.delete(tabId);
    this.standaloneTabOrder = this.standaloneTabOrder.filter((id) => id !== tabId);
    void this.saveStandaloneTabs();
    return true;
  }

  // --- Pin and order management ---

  setTabPinned(tabId: string, pinned: boolean): void {
    if (!this.standaloneTabIds.has(tabId)) return;
    if (pinned) {
      this.pinnedTabIds.add(tabId);
    } else {
      this.pinnedTabIds.delete(tabId);
    }
    void this.saveStandaloneTabs();
  }

  reorderTabs(orderedIds: string[]): void {
    // Only keep IDs that are actually standalone tabs
    this.standaloneTabOrder = orderedIds.filter((id) => this.standaloneTabIds.has(id));
    void this.saveStandaloneTabs();
  }

  // --- Standalone tab persistence ---

  private get tabsFilePath(): string | null {
    return this.storagePath ? path.join(this.storagePath, "standalone-tabs.json") : null;
  }

  private async saveStandaloneTabs(): Promise<void> {
    const filePath = this.tabsFilePath;
    if (!filePath || !this.viewManager) return;

    const viewMap = new Map(
      this.viewManager.list().filter((v) => this.standaloneTabIds.has(v.id)).map((v) => [v.id, v])
    );
    // Save in the tracked order
    const ordered = [
      ...this.standaloneTabOrder.filter((id) => viewMap.has(id)),
      ...[...viewMap.keys()].filter((id) => !this.standaloneTabOrder.includes(id))
    ];
    const tabs: PersistedTab[] = ordered.map((id) => {
      const v = viewMap.get(id)!;
      return {
        id: v.id,
        url: v.url || "about:blank",
        profileId: "standalone",
        ...(this.pinnedTabIds.has(v.id) ? { pinned: true } : {})
      };
    });

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

  // --- Cookie management ---

  async getCookies(sessionId: string): Promise<Electron.Cookie[]> {
    const managed = this.viewManager?.get(sessionId);
    if (!managed || managed.view.webContents.isDestroyed()) return [];
    return managed.view.webContents.session.cookies.get({});
  }

  async removeCookie(sessionId: string, url: string, name: string): Promise<void> {
    const managed = this.viewManager?.get(sessionId);
    if (!managed || managed.view.webContents.isDestroyed()) return;
    await managed.view.webContents.session.cookies.remove(url, name);
  }

  async removeAllCookies(sessionId: string): Promise<void> {
    const managed = this.viewManager?.get(sessionId);
    if (!managed || managed.view.webContents.isDestroyed()) return;
    const cookies = await managed.view.webContents.session.cookies.get({});
    for (const cookie of cookies) {
      const protocol = cookie.secure ? "https" : "http";
      const cookieUrl = `${protocol}://${cookie.domain?.replace(/^\./, "")}${cookie.path ?? "/"}`;
      await managed.view.webContents.session.cookies.remove(cookieUrl, cookie.name);
    }
  }

  async restoreStandaloneTabs(): Promise<BrowserShellTabDescriptor[]> {
    const saved = await this.loadStandaloneTabs();
    const restored: BrowserShellTabDescriptor[] = [];
    for (const entry of saved) {
      try {
        const tab = this.createStandaloneTab(entry.url);
        if (entry.pinned) {
          this.pinnedTabIds.add(tab.groupId);
          tab.pinned = true;
        }
        restored.push(tab);
      } catch (err) {
        console.error("[AppBrowserShell] Failed to restore standalone tab:", err);
      }
    }
    return restored;
  }
}
