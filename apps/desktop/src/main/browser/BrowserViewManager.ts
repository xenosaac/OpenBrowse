import { WebContentsView, session, app, type BrowserWindow } from "electron";
import path from "node:path";

export interface ManagedBrowserView {
  id: string;
  profileId: string;
  view: WebContentsView;
  createdAt: string;
}

export interface DownloadInfo {
  id: string;
  filename: string;
  url: string;
  savePath: string;
  totalBytes: number;
  receivedBytes: number;
  state: "progressing" | "completed" | "cancelled" | "interrupted";
}

interface ViewportBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class BrowserViewManager {
  private readonly views = new Map<string, ManagedBrowserView>();
  private readonly downloadSessions = new Set<string>();
  private activeViewId: string | null = null;
  private hostWindow: BrowserWindow;
  private viewportBounds: ViewportBounds | null = null;

  // Split view state
  private splitMode = false;
  private splitLeftId: string | null = null;
  private splitRightId: string | null = null;
  private splitLeftBounds: ViewportBounds | null = null;
  private splitRightBounds: ViewportBounds | null = null;
  onNavigate: ((sessionId: string, url: string, title: string) => void) | null = null;
  onLoadingStateChanged: ((sessionId: string, isLoading: boolean) => void) | null = null;
  onFaviconUpdated: ((sessionId: string, faviconUrl: string) => void) | null = null;
  onFindResult: ((sessionId: string, result: { activeMatchOrdinal: number; matches: number; finalUpdate: boolean }) => void) | null = null;
  onContextMenu: ((sessionId: string, params: {
    x: number; y: number; linkURL: string; linkText: string;
    selectionText: string; mediaType: string; srcURL: string; isEditable: boolean;
  }) => void) | null = null;
  onLoadError: ((sessionId: string, errorCode: number, errorDescription: string, validatedURL: string) => void) | null = null;
  onDownloadUpdated: ((info: DownloadInfo) => void) | null = null;

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

    view.webContents.on("context-menu", (_event, params) => {
      this.onContextMenu?.(sessionId, {
        x: params.x,
        y: params.y,
        linkURL: params.linkURL,
        linkText: params.linkText,
        selectionText: params.selectionText,
        mediaType: params.mediaType,
        srcURL: params.srcURL,
        isEditable: params.isEditable
      });
    });

    view.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) {
        this.onLoadError?.(sessionId, errorCode, errorDescription, validatedURL);
      }
    });

    // Attach download handler once per partition to avoid duplicate listeners
    const partitionKey = partition;
    if (!this.downloadSessions.has(partitionKey)) {
      this.downloadSessions.add(partitionKey);
      ses.on("will-download", (_event, item) => {
        const downloadId = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const filename = item.getFilename() || "download";
        const downloadsDir = app.getPath("downloads");
        const savePath = path.join(downloadsDir, filename);
        item.setSavePath(savePath);

        const emitUpdate = (state: DownloadInfo["state"]) => {
          this.onDownloadUpdated?.({
            id: downloadId,
            filename,
            url: item.getURL(),
            savePath,
            totalBytes: item.getTotalBytes(),
            receivedBytes: item.getReceivedBytes(),
            state,
          });
        };

        emitUpdate("progressing");

        item.on("updated", (_ev, state) => {
          emitUpdate(state === "progressing" ? "progressing" : "interrupted");
        });

        item.once("done", (_ev, state) => {
          emitUpdate(state === "completed" ? "completed" : "cancelled");
        });
      });
    }

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

  zoomIn(sessionId: string): number {
    const managed = this.views.get(sessionId);
    if (!managed || managed.view.webContents.isDestroyed()) return 0;
    const current = managed.view.webContents.getZoomLevel();
    const next = Math.min(current + 0.5, 5);
    managed.view.webContents.setZoomLevel(next);
    return next;
  }

  zoomOut(sessionId: string): number {
    const managed = this.views.get(sessionId);
    if (!managed || managed.view.webContents.isDestroyed()) return 0;
    const current = managed.view.webContents.getZoomLevel();
    const next = Math.max(current - 0.5, -3);
    managed.view.webContents.setZoomLevel(next);
    return next;
  }

  resetZoom(sessionId: string): number {
    const managed = this.views.get(sessionId);
    if (!managed || managed.view.webContents.isDestroyed()) return 0;
    managed.view.webContents.setZoomLevel(0);
    return 0;
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

    // Exit split if destroying a split pane
    if (this.splitMode && (sessionId === this.splitLeftId || sessionId === this.splitRightId)) {
      this.exitSplit();
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

  // ---- Split view ----

  showSplit(leftId: string, rightId: string): void {
    this.splitMode = true;
    this.splitLeftId = leftId;
    this.splitRightId = rightId;
    this.activeViewId = leftId;
    this.promote(leftId);
    this.promote(rightId);
    this.applyVisibility();
  }

  setSplitBounds(leftBounds: ViewportBounds, rightBounds: ViewportBounds): void {
    this.splitLeftBounds = {
      x: Math.max(0, Math.round(leftBounds.x)),
      y: Math.max(0, Math.round(leftBounds.y)),
      width: Math.max(0, Math.round(leftBounds.width)),
      height: Math.max(0, Math.round(leftBounds.height))
    };
    this.splitRightBounds = {
      x: Math.max(0, Math.round(rightBounds.x)),
      y: Math.max(0, Math.round(rightBounds.y)),
      width: Math.max(0, Math.round(rightBounds.width)),
      height: Math.max(0, Math.round(rightBounds.height))
    };
    this.relayout();
  }

  exitSplit(): void {
    this.splitMode = false;
    const keepId = this.splitLeftId;
    this.splitLeftId = null;
    this.splitRightId = null;
    this.splitLeftBounds = null;
    this.splitRightBounds = null;
    if (keepId) {
      this.activeViewId = keepId;
    }
    this.applyVisibility();
  }

  isSplit(): boolean {
    return this.splitMode;
  }

  getSplitIds(): { leftId: string | null; rightId: string | null } {
    return { leftId: this.splitLeftId, rightId: this.splitRightId };
  }

  relayout(): void {
    if (this.splitMode) {
      const left = this.splitLeftId ? this.views.get(this.splitLeftId) : null;
      const right = this.splitRightId ? this.views.get(this.splitRightId) : null;
      if (left && this.splitLeftBounds) {
        left.view.setBounds(this.splitLeftBounds);
      }
      if (right && this.splitRightBounds) {
        right.view.setBounds(this.splitRightBounds);
      }
      return;
    }
    if (this.activeViewId) {
      const managed = this.views.get(this.activeViewId);
      if (managed) {
        this.layoutView(managed.view);
      }
    }
  }

  private applyVisibility(): void {
    for (const [id, managed] of this.views) {
      if (this.splitMode && (id === this.splitLeftId || id === this.splitRightId)) {
        const bounds = id === this.splitLeftId ? this.splitLeftBounds : this.splitRightBounds;
        if (bounds) {
          managed.view.setBounds(bounds);
        }
        managed.view.setVisible(true);
        if (id === this.activeViewId) {
          try { managed.view.webContents.focus(); } catch { /* best-effort */ }
        }
      } else if (!this.splitMode && id === this.activeViewId) {
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
