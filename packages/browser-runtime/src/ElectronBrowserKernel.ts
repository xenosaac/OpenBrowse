import { BrowserWindow, session, type WebContents, type WebContentsView } from "electron";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  BrowserAction,
  BrowserActionResult,
  BrowserProfile,
  BrowserSession,
  ManagedProfileRequest,
  PageModel
} from "@openbrowse/contracts";
import type { AttachSessionOptions, BrowserKernel } from "./BrowserKernel.js";
import { CdpClient } from "./cdp/CdpClient.js";
import { EXTRACT_PAGE_MODEL_SCRIPT } from "./cdp/extractPageModel.js";
import { validateElementTargetId, validateScrollDirection, validateUrl } from "./validation.js";

export interface EmbeddedViewProvider {
  createView(sessionId: string, profileId: string, partition: string): { view: WebContentsView };
  destroyView(sessionId: string): void;
}

interface ManagedSession {
  id: string;
  runId: string;
  groupId: string;
  profile: BrowserProfile;
  taskLabel: string;
  source: BrowserSession["source"];
  status: BrowserSession["status"];
  isBackground: boolean;
  window: BrowserWindow | null;
  view: WebContentsView | null;
  webContents: WebContents;
  cdp: CdpClient;
  createdAt: string;
}

const NAVIGATION_TIMEOUT_MS = 30_000;
const TARGET_ATTR = "data-openbrowse-target-id";

function rejectAfterTimeout(ms: number, message: string): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}

export class ElectronBrowserKernel implements BrowserKernel {
  private readonly profiles = new Map<string, BrowserProfile>();
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly parentWindow: BrowserWindow;
  private readonly profilesDir: string;
  private readonly viewProvider: EmbeddedViewProvider | null;

  constructor(parentWindow: BrowserWindow, profilesDir: string, viewProvider?: EmbeddedViewProvider) {
    this.parentWindow = parentWindow;
    this.profilesDir = profilesDir;
    this.viewProvider = viewProvider ?? null;
  }

  /** Load persisted profiles from disk. Call once after construction. */
  async init(): Promise<void> {
    try {
      const data = await readFile(this.profilesFilePath(), "utf-8");
      const entries: BrowserProfile[] = JSON.parse(data);
      for (const p of entries) {
        this.profiles.set(p.id, p);
      }
    } catch {
      // No file yet — start with empty profiles
    }
  }

  async listProfiles(): Promise<BrowserProfile[]> {
    return [...this.profiles.values()];
  }

  async listSessions(): Promise<BrowserSession[]> {
    const sessions: BrowserSession[] = [];

    for (const managed of this.sessions.values()) {
      const isAlive = !managed.webContents.isDestroyed();
      const now = new Date().toISOString();
      sessions.push({
        id: managed.id,
        runId: managed.runId,
        groupId: managed.groupId,
        profileId: managed.profile.id,
        tabId: `tab_${managed.id}`,
        taskLabel: managed.taskLabel,
        source: managed.source,
        status: managed.status,
        isBackground: managed.isBackground,
        pageUrl: isAlive ? managed.webContents.getURL() || "about:blank" : "about:blank",
        state: isAlive ? "attached" : "terminated",
        createdAt: managed.createdAt,
        updatedAt: now
      });
    }

    return sessions;
  }

  async createManagedProfile(request: ManagedProfileRequest): Promise<BrowserProfile> {
    const id = `managed_${request.label.toLowerCase().replace(/\s+/g, "_")}_${Date.now()}`;
    const profile: BrowserProfile = {
      id,
      label: request.label,
      storagePath: `persist:${id}`,
      isManaged: true
    };
    this.profiles.set(id, profile);
    await this.saveProfiles();
    return profile;
  }

  async ensureProfile(profileId?: string): Promise<BrowserProfile> {
    if (profileId && this.profiles.has(profileId)) {
      return this.profiles.get(profileId)!;
    }

    const defaultId = profileId ?? "managed-default";
    if (this.profiles.has(defaultId)) {
      return this.profiles.get(defaultId)!;
    }

    const profile: BrowserProfile = {
      id: defaultId,
      label: "Managed Default Profile",
      storagePath: `persist:${defaultId}`,
      isManaged: true
    };
    this.profiles.set(defaultId, profile);
    await this.saveProfiles();
    return profile;
  }

  async attachSession(profile: BrowserProfile, options?: AttachSessionOptions): Promise<BrowserSession> {
    const runId = options?.runId ?? `run_${profile.id}_${Date.now()}`;
    const groupId = options?.groupId ?? runId;
    const taskLabel = options?.taskLabel ?? profile.label;
    const source = options?.source ?? "desktop";
    const status = options?.status ?? "running";
    const isBackground = options?.isBackground ?? false;
    const sessionId = `session_${runId}_${Date.now()}`;
    const partition = profile.storagePath.startsWith("persist:")
      ? profile.storagePath
      : `persist:${profile.id}`;

    let managed: ManagedSession;

    if (this.viewProvider) {
      const { view } = this.viewProvider.createView(sessionId, profile.id, partition);
      const cdp = new CdpClient(view.webContents);
      await cdp.attach();

      managed = {
        id: sessionId,
        runId,
        groupId,
        profile,
        taskLabel,
        source,
        status,
        isBackground,
        window: null,
        view,
        webContents: view.webContents,
        cdp,
        createdAt: new Date().toISOString()
      };

      view.webContents.on("destroyed", () => {
        this.sessions.delete(sessionId);
      });
    } else {
      const ses = session.fromPartition(partition);
      const win = new BrowserWindow({
        width: 1024,
        height: 768,
        show: false,
        parent: this.parentWindow,
        webPreferences: {
          session: ses,
          contextIsolation: true,
          nodeIntegration: false
        }
      });

      win.on("closed", () => {
        this.sessions.delete(sessionId);
      });

      const cdp = new CdpClient(win.webContents);
      await cdp.attach();

      managed = {
        id: sessionId,
        runId,
        groupId,
        profile,
        taskLabel,
        source,
        status,
        isBackground,
        window: win,
        view: null,
        webContents: win.webContents,
        cdp,
        createdAt: new Date().toISOString()
      };
    }

    this.sessions.set(sessionId, managed);
    await this.ensureReadyDocument(managed.webContents);

    const now = managed.createdAt;
    return {
      id: sessionId,
      runId,
      groupId,
      profileId: profile.id,
      tabId: `tab_${sessionId}`,
      taskLabel,
      source,
      status,
      isBackground,
      pageUrl: "about:blank",
      state: "attached",
      createdAt: now,
      updatedAt: now
    };
  }

  async capturePageModel(browserSession: BrowserSession): Promise<PageModel> {
    const managed = this.sessions.get(browserSession.id);
    if (!managed) {
      throw new Error(`Session not found: ${browserSession.id}`);
    }

    const raw = await managed.cdp.evaluate<{
      url: string;
      title: string;
      summary: string;
      focusedElementId?: string;
      elements: Array<{ id: string; role: string; label: string; value?: string; isActionable: boolean }>;
      visibleText: string;
    }>(EXTRACT_PAGE_MODEL_SCRIPT);

    return {
      id: `page_${browserSession.id}_${Date.now()}`,
      url: raw.url,
      title: raw.title,
      summary: raw.summary,
      focusedElementId: raw.focusedElementId,
      elements: raw.elements,
      visibleText: raw.visibleText,
      createdAt: new Date().toISOString()
    };
  }

  async executeAction(browserSession: BrowserSession, action: BrowserAction): Promise<BrowserActionResult> {
    const managed = this.sessions.get(browserSession.id);
    if (!managed) {
      throw new Error(`Session not found: ${browserSession.id}`);
    }

    const wc: WebContents = managed.webContents;

    try {
      switch (action.type) {
        case "navigate": {
          if (action.value) {
            const safeUrl = validateUrl(action.value);
            await Promise.race([
              wc.loadURL(safeUrl),
              rejectAfterTimeout(NAVIGATION_TIMEOUT_MS, `Navigation to ${safeUrl} timed out after ${NAVIGATION_TIMEOUT_MS}ms`)
            ]);
          }
          break;
        }

        case "click": {
          const targetId = this.requireTargetId(action);
          await managed.cdp.callFunction(
            `function(targetAttr, targetId) {
              const el = document.querySelector('[' + targetAttr + '="' + targetId + '"]');
              if (!el) {
                throw new Error('Target not found: ' + targetId);
              }
              el.click();
            }`,
            TARGET_ATTR,
            targetId
          );
          break;
        }

        case "type": {
          const targetId = this.requireTargetId(action);
          const value = this.requireActionValue(action);
          await managed.cdp.callFunction(
            `function(targetAttr, targetId, value) {
              const el = document.querySelector('[' + targetAttr + '="' + targetId + '"]');
              if (!el) {
                throw new Error('Target not found: ' + targetId);
              }
              el.focus();
              el.value = value;
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }`,
            TARGET_ATTR,
            targetId,
            value
          );
          break;
        }

        case "select": {
          const targetId = this.requireTargetId(action);
          const value = this.requireActionValue(action);
          await managed.cdp.callFunction(
            `function(targetAttr, targetId, value) {
              const el = document.querySelector('[' + targetAttr + '="' + targetId + '"]');
              if (!el) {
                throw new Error('Target not found: ' + targetId);
              }
              el.value = value;
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }`,
            TARGET_ATTR,
            targetId,
            value
          );
          break;
        }

        case "scroll": {
          const direction = validateScrollDirection(action.value ?? "down");
          await managed.cdp.evaluate(
            `window.scrollBy(0, ${direction === "up" ? -400 : 400})`
          );
          break;
        }

        case "wait":
          await new Promise((r) => setTimeout(r, Number(action.value) || 1000));
          break;

        case "extract":
          await managed.cdp.evaluate(EXTRACT_PAGE_MODEL_SCRIPT);
          break;
      }

      const pageModel = await this.capturePageModel(browserSession);

      return {
        ok: true,
        action,
        pageModelId: pageModel.id,
        summary: `Executed ${action.type}: ${action.description}`
      };
    } catch (err) {
      return {
        ok: false,
        action,
        summary: `Failed to execute ${action.type}: ${err instanceof Error ? err.message : String(err)}`
      };
    }
  }

  async destroySession(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;

    this.sessions.delete(sessionId);

    try {
      await managed.cdp.detach();
    } catch {
      // Already detached
    }

    if (managed.view && this.viewProvider) {
      this.viewProvider.destroyView(sessionId);
    } else if (managed.window && !managed.window.isDestroyed()) {
      managed.window.close();
    }
  }

  async destroyAllSessions(): Promise<void> {
    const ids = [...this.sessions.keys()];
    for (const id of ids) {
      await this.destroySession(id);
    }
  }

  async getSession(sessionId: string): Promise<BrowserSession | null> {
    const managed = this.sessions.get(sessionId);
    if (!managed) return null;

    const isAlive = !managed.webContents.isDestroyed();
    const now = new Date().toISOString();

    return {
      id: managed.id,
      runId: managed.runId,
      groupId: managed.groupId,
      profileId: managed.profile.id,
      tabId: `tab_${managed.id}`,
      taskLabel: managed.taskLabel,
      source: managed.source,
      status: managed.status,
      isBackground: managed.isBackground,
      pageUrl: isAlive ? managed.webContents.getURL() || "about:blank" : "about:blank",
      state: isAlive ? "attached" : "terminated",
      createdAt: managed.createdAt,
      updatedAt: now
    };
  }

  private profilesFilePath(): string {
    return path.join(this.profilesDir, "profiles.json");
  }

  private requireTargetId(action: BrowserAction): string {
    if (!action.targetId) {
      throw new Error(`Browser action "${action.type}" requires a targetId`);
    }

    validateElementTargetId(action.targetId);
    return action.targetId;
  }

  private requireActionValue(action: BrowserAction): string {
    if (action.value === undefined) {
      throw new Error(`Browser action "${action.type}" requires a value`);
    }

    return action.value;
  }

  private async ensureReadyDocument(webContents: WebContents): Promise<void> {
    if (webContents.isDestroyed()) {
      return;
    }

    if (!webContents.getURL()) {
      await Promise.race([
        webContents.loadURL("about:blank"),
        rejectAfterTimeout(
          NAVIGATION_TIMEOUT_MS,
          `Initial about:blank navigation timed out after ${NAVIGATION_TIMEOUT_MS}ms`
        )
      ]);
      return;
    }

    if (webContents.isLoadingMainFrame()) {
      await new Promise<void>((resolve) => {
        webContents.once("did-finish-load", () => resolve());
      });
    }
  }

  private async saveProfiles(): Promise<void> {
    await mkdir(this.profilesDir, { recursive: true });
    const data = JSON.stringify([...this.profiles.values()], null, 2);
    await writeFile(this.profilesFilePath(), data, "utf-8");
  }
}
