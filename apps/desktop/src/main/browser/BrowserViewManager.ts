import { WebContentsView, session, type BrowserWindow } from "electron";

export interface ManagedBrowserView {
  id: string;
  profileId: string;
  view: WebContentsView;
  createdAt: string;
}

interface ViewportBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class BrowserViewManager {
  private readonly views = new Map<string, ManagedBrowserView>();
  private activeViewId: string | null = null;
  private hostWindow: BrowserWindow;
  private viewportBounds: ViewportBounds | null = null;
  onNavigate: ((sessionId: string, url: string, title: string) => void) | null = null;
  onLoadingStateChanged: ((sessionId: string, isLoading: boolean) => void) | null = null;
  onFaviconUpdated: ((sessionId: string, faviconUrl: string) => void) | null = null;
  onFindResult: ((sessionId: string, result: { activeMatchOrdinal: number; matches: number; finalUpdate: boolean }) => void) | null = null;

  constructor(hostWindow: BrowserWindow) {
    this.hostWindow = hostWindow;
  }

  create(sessionId: string, profileId: string, partition: string): ManagedBrowserView {
    const ses = session.fromPartition(partition);

    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    const managed: ManagedBrowserView = {
      id: sessionId,
      profileId,
      view,
      createdAt: new Date().toISOString()
    };

    this.views.set(sessionId, managed);
    this.hostWindow.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    view.setVisible(false);

    view.webContents.on("did-navigate", (_, url) => {
      this.onNavigate?.(sessionId, url, view.webContents.getTitle());
    });

    view.webContents.on("did-navigate-in-page", (_, url) => {
      this.onNavigate?.(sessionId, url, view.webContents.getTitle());
    });

    view.webContents.on("page-title-updated", (_, title) => {
      const url = view.webContents.getURL();
      this.onNavigate?.(sessionId, url, title);
    });

    view.webContents.on("did-start-loading", () => {
      this.onLoadingStateChanged?.(sessionId, true);
    });

    view.webContents.on("did-stop-loading", () => {
      this.onLoadingStateChanged?.(sessionId, false);
    });

    view.webContents.on("page-favicon-updated", (_, favicons) => {
      if (favicons.length > 0) {
        this.onFaviconUpdated?.(sessionId, favicons[0]);
      }
    });

    view.webContents.on("found-in-page", (_event, result) => {
      this.onFindResult?.(sessionId, {
        activeMatchOrdinal: result.activeMatchOrdinal,
        matches: result.matches,
        finalUpdate: result.finalUpdate
      });
    });

    view.webContents.on("destroyed", () => {
      this.views.delete(sessionId);
      if (this.activeViewId === sessionId) {
        this.activeViewId = null;
      }
    });

    return managed;
  }

  findInPage(sessionId: string, text: string, options?: { forward?: boolean; findNext?: boolean }): void {
    const managed = this.views.get(sessionId);
    if (managed && !managed.view.webContents.isDestroyed() && text) {
      managed.view.webContents.findInPage(text, options);
    }
  }

  stopFindInPage(sessionId: string, action: "clearSelection" | "keepSelection" | "activateSelection" = "clearSelection"): void {
    const managed = this.views.get(sessionId);
    if (managed && !managed.view.webContents.isDestroyed()) {
      managed.view.webContents.stopFindInPage(action);
    }
  }

  navigate(sessionId: string, url: string): void {
    const managed = this.views.get(sessionId);
    if (managed) {
      void managed.view.webContents.loadURL(url);
    }
  }

  goBack(sessionId: string): void {
    const managed = this.views.get(sessionId);
    if (managed?.view.webContents.canGoBack()) {
      managed.view.webContents.goBack();
    }
  }

  goForward(sessionId: string): void {
    const managed = this.views.get(sessionId);
    if (managed?.view.webContents.canGoForward()) {
      managed.view.webContents.goForward();
    }
  }

  reload(sessionId: string): void {
    const managed = this.views.get(sessionId);
    managed?.view.webContents.reload();
  }

  getNavState(sessionId: string): { canGoBack: boolean; canGoForward: boolean; url: string; title: string } | null {
    const managed = this.views.get(sessionId);
    if (!managed) return null;
    return {
      canGoBack: managed.view.webContents.canGoBack(),
      canGoForward: managed.view.webContents.canGoForward(),
      url: managed.view.webContents.getURL() || "about:blank",
      title: managed.view.webContents.getTitle() || "Untitled"
    };
  }

  show(sessionId: string): void {
    this.activeViewId = sessionId;
    this.promote(sessionId);
    this.applyVisibility();
  }

  hideAll(): void {
    this.activeViewId = null;
    this.applyVisibility();
  }

  reattach(hostWindow: BrowserWindow): void {
    const previousWindow = this.hostWindow;
    this.hostWindow = hostWindow;

    for (const managed of this.views.values()) {
      if (!previousWindow.isDestroyed()) {
        try {
          previousWindow.contentView.removeChildView(managed.view);
        } catch {
          // View may already be detached during window teardown.
        }
      }

      try {
        this.hostWindow.contentView.addChildView(managed.view);
      } catch {
        // Re-adding an already adopted view is safe to ignore here.
      }
    }

    this.applyVisibility();
  }

  get(sessionId: string): ManagedBrowserView | undefined {
    return this.views.get(sessionId);
  }

  getActiveId(): string | null {
    return this.activeViewId;
  }

  setViewportBounds(bounds: ViewportBounds): void {
    this.viewportBounds = {
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height))
    };
    this.relayout();
  }

  clearViewportBounds(): void {
    this.viewportBounds = null;
    this.relayout();
  }

  list(): Array<{ id: string; profileId: string; url: string; title: string; isActive: boolean }> {
    return [...this.views.values()].map((m) => ({
      id: m.id,
      profileId: m.profileId,
      url: m.view.webContents.getURL() || "about:blank",
      title: m.view.webContents.getTitle() || "Untitled",
      isActive: m.id === this.activeViewId
    }));
  }

  destroy(sessionId: string): void {
    const managed = this.views.get(sessionId);
    if (!managed) return;

    this.views.delete(sessionId);
    if (this.activeViewId === sessionId) {
      this.activeViewId = null;
    }

    try {
      this.hostWindow.contentView.removeChildView(managed.view);
    } catch {
      // View already removed
    }

    if (!managed.view.webContents.isDestroyed()) {
      managed.view.webContents.close();
    }
  }

  destroyAll(): void {
    const ids = [...this.views.keys()];
    for (const id of ids) {
      this.destroy(id);
    }
  }

  relayout(): void {
    if (this.activeViewId) {
      const managed = this.views.get(this.activeViewId);
      if (managed) {
        this.layoutView(managed.view);
      }
    }
  }

  private applyVisibility(): void {
    for (const [id, managed] of this.views) {
      if (id === this.activeViewId) {
        this.layoutView(managed.view);
        managed.view.setVisible(true);
        try {
          managed.view.webContents.focus();
        } catch {
          // Focus best-effort only.
        }
      } else {
        managed.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        managed.view.setVisible(false);
      }
    }
  }

  private promote(sessionId: string): void {
    const managed = this.views.get(sessionId);
    if (!managed) {
      return;
    }

    try {
      this.hostWindow.contentView.removeChildView(managed.view);
    } catch {
      // Ignore if already detached.
    }

    try {
      this.hostWindow.contentView.addChildView(managed.view);
    } catch {
      // Ignore if already attached.
    }
  }

  private layoutView(view: WebContentsView): void {
    if (this.viewportBounds) {
      view.setBounds(this.viewportBounds);
      return;
    }

    const [width, height] = this.hostWindow.getContentSize();
    view.setBounds({ x: 0, y: 0, width, height });
  }
}
