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
import { DISMISS_COOKIE_BANNER_SCRIPT } from "./cdp/dismissCookieBanner.js";
import { EXTRACT_PAGE_MODEL_SCRIPT } from "./cdp/extractPageModel.js";
import { mapRawToPageModel, type RawPageModelResult } from "./mapRawToPageModel.js";
import { navigateWithRetry } from "./navigateRetry.js";
import { classifyFailure, parseKeyboardShortcut, validateElementTargetId, validateScrollDirection, validateUrl } from "./validation.js";

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

/**
 * Inline JS helper that resolves an element by targetId, including same-origin
 * iframe traversal for frame-prefixed IDs like "frame0_el_5".
 * Returns { el, iframe } where iframe is the containing iframe element (or null).
 * This string is prepended inside callFunction bodies that need element resolution.
 */
const RESOLVE_TARGET_JS = `
  function _resolve(targetAttr, targetId) {
    var fm = targetId.match(/^frame(\\d+)_el_/);
    if (fm) {
      var fi = parseInt(fm[1], 10);
      var ifs = document.querySelectorAll('iframe');
      var si = 0;
      for (var i = 0; i < ifs.length; i++) {
        var d; try { d = ifs[i].contentDocument; } catch(e) { continue; }
        if (!d || !d.body) continue;
        if (si === fi) return { el: d.querySelector('[' + targetAttr + '="' + targetId + '"]'), iframe: ifs[i] };
        si++;
      }
      return { el: null, iframe: null };
    }
    return { el: document.querySelector('[' + targetAttr + '="' + targetId + '"]'), iframe: null };
  }
`;

function rejectAfterTimeout(ms: number, message: string): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}

export class ElectronBrowserKernel implements BrowserKernel {
  private readonly profiles = new Map<string, BrowserProfile>();
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly cookieDismissAttempted = new Map<string, Set<string>>();
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

    const raw = await managed.cdp.evaluate<RawPageModelResult>(EXTRACT_PAGE_MODEL_SCRIPT);

    // Auto-dismiss cookie banner if detected and not yet attempted for this session+hostname
    if (raw.cookieBannerDetected) {
      let hostname: string;
      try { hostname = new URL(raw.url).hostname; } catch { hostname = raw.url; }
      const attempted = this.cookieDismissAttempted.get(browserSession.id);
      if (!attempted?.has(hostname)) {
        // Record that we've attempted for this session+hostname
        if (!attempted) {
          this.cookieDismissAttempted.set(browserSession.id, new Set([hostname]));
        } else {
          attempted.add(hostname);
        }

        try {
          const dismissResult = await managed.cdp.evaluate<{ dismissed: boolean; method?: string; detail?: string }>(
            DISMISS_COOKIE_BANNER_SCRIPT
          );
          if (dismissResult.dismissed) {
            // Wait for banner dismiss animation
            await new Promise((r) => setTimeout(r, 500));
            managed.cdp.invalidateContext();
            // Re-extract page model with banner dismissed
            const fresh = await managed.cdp.evaluate<RawPageModelResult>(EXTRACT_PAGE_MODEL_SCRIPT);
            return mapRawToPageModel(fresh, browserSession.id);
          }
        } catch {
          // Dismiss failed — return original page model with banner still detected
        }
      }
    }

    return mapRawToPageModel(raw, browserSession.id);
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
            await navigateWithRetry(
              () => Promise.race([
                wc.loadURL(safeUrl),
                rejectAfterTimeout(NAVIGATION_TIMEOUT_MS, `Navigation to ${safeUrl} timed out after ${NAVIGATION_TIMEOUT_MS}ms`)
              ]),
              classifyFailure
            );
          }
          managed.cdp.invalidateContext();
          break;
        }

        case "click": {
          const targetId = this.requireTargetId(action);
          // Scroll element into view and get its center coordinates
          const coords = await managed.cdp.callFunction<{ x: number; y: number } | null>(
            `function(targetAttr, targetId) {
              ${RESOLVE_TARGET_JS}
              var r = _resolve(targetAttr, targetId);
              if (!r.el) return null;
              r.el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
              var rect = r.el.getBoundingClientRect();
              var ox = 0, oy = 0;
              if (r.iframe) { var ir = r.iframe.getBoundingClientRect(); ox = ir.left; oy = ir.top; }
              return { x: Math.round(ox + rect.left + rect.width / 2), y: Math.round(oy + rect.top + rect.height / 2) };
            }`,
            TARGET_ATTR,
            targetId
          );
          if (!coords) throw new Error(`Target not found: ${targetId}`);
          // Dispatch native mouse events via CDP
          await managed.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: coords.x, y: coords.y });
          await managed.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: coords.x, y: coords.y, button: "left", clickCount: 1 });
          await managed.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: coords.x, y: coords.y, button: "left", clickCount: 1 });
          // Wait for navigation that may have been triggered
          await this.waitForLoadIfNavigating(wc);
          // Post-action settle for SPAs
          await this.postActionSettle(wc);
          managed.cdp.invalidateContext();
          break;
        }

        case "type": {
          const targetId = this.requireTargetId(action);
          const value = this.requireActionValue(action);
          // Focus element, scroll into view
          const found = await managed.cdp.callFunction<boolean>(
            `function(targetAttr, targetId) {
              ${RESOLVE_TARGET_JS}
              var r = _resolve(targetAttr, targetId);
              if (!r.el) return false;
              r.el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
              r.el.focus();
              return true;
            }`,
            TARGET_ATTR,
            targetId
          );
          if (!found) throw new Error(`Target not found: ${targetId}`);

          // If clear_first, select all existing text via keyboard shortcut before typing.
          // Uses Ctrl+A (works cross-platform in Chromium content areas).
          if (action.clearFirst) {
            await managed.cdp.send("Input.dispatchKeyEvent", {
              type: "keyDown", key: "a", code: "KeyA",
              modifiers: 2, // Ctrl
              windowsVirtualKeyCode: 65
            });
            await managed.cdp.send("Input.dispatchKeyEvent", {
              type: "keyUp", key: "a", code: "KeyA",
              modifiers: 2,
              windowsVirtualKeyCode: 65
            });
          }

          // Use character-by-character key dispatch for React/Vue/Angular compat.
          // Fast-path: insertText if hinted (plain HTML inputs without framework bindings).
          if (action.interactionHint === "insertText") {
            await managed.cdp.send("Input.insertText", { text: value });
          } else {
            for (const char of value) {
              await managed.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: char, text: char });
              await managed.cdp.send("Input.dispatchKeyEvent", { type: "char", key: char, text: char });
              await managed.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: char, text: char });
            }
          }

          // Dispatch input + change for framework compatibility
          await managed.cdp.callFunction(
            `function(targetAttr, targetId) {
              ${RESOLVE_TARGET_JS}
              var r = _resolve(targetAttr, targetId);
              if (r.el) {
                r.el.dispatchEvent(new Event('input', { bubbles: true }));
                r.el.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }`,
            TARGET_ATTR,
            targetId
          );
          // Post-action settle
          await this.postActionSettle(wc);
          break;
        }

        case "select": {
          const targetId = this.requireTargetId(action);
          const value = this.requireActionValue(action);
          await managed.cdp.callFunction(
            `function(targetAttr, targetId, value) {
              ${RESOLVE_TARGET_JS}
              var r = _resolve(targetAttr, targetId);
              if (!r.el) throw new Error('Target not found: ' + targetId);
              r.el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
              r.el.focus();

              // Use native setter to trigger internal state update
              var nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLSelectElement.prototype, 'value'
              )?.set;
              if (nativeInputValueSetter) {
                nativeInputValueSetter.call(r.el, value);
              } else {
                r.el.value = value;
              }

              // Dispatch both native and synthetic events for framework compat
              r.el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
              r.el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            }`,
            TARGET_ATTR,
            targetId,
            value
          );
          // Post-action settle
          await this.postActionSettle(wc);
          break;
        }

        case "scroll": {
          const direction = validateScrollDirection(action.value ?? "down");
          const delta = direction === "up" ? -400 : 400;
          if (action.targetId) {
            // Element-level scroll
            const tid = action.targetId;
            validateElementTargetId(tid);
            await managed.cdp.callFunction(
              `function(targetAttr, targetId, delta) {
                ${RESOLVE_TARGET_JS}
                var r = _resolve(targetAttr, targetId);
                if (r.el) r.el.scrollBy({ top: delta, behavior: 'smooth' });
              }`,
              TARGET_ATTR,
              tid,
              delta
            );
          } else {
            await managed.cdp.evaluate(`window.scrollBy({ top: ${delta}, behavior: 'smooth' })`);
          }
          break;
        }

        case "focus": {
          const targetId = this.requireTargetId(action);
          const found = await managed.cdp.callFunction<boolean>(
            `function(targetAttr, targetId) {
              ${RESOLVE_TARGET_JS}
              var r = _resolve(targetAttr, targetId);
              if (!r.el) return false;
              r.el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
              r.el.focus();
              return true;
            }`,
            TARGET_ATTR,
            targetId
          );
          if (!found) throw new Error(`Target not found: ${targetId}`);
          break;
        }

        case "hover": {
          const targetId = this.requireTargetId(action);
          const coords = await managed.cdp.callFunction<{ x: number; y: number } | null>(
            `function(targetAttr, targetId) {
              ${RESOLVE_TARGET_JS}
              var r = _resolve(targetAttr, targetId);
              if (!r.el) return null;
              r.el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
              var rect = r.el.getBoundingClientRect();
              var ox = 0, oy = 0;
              if (r.iframe) { var ir = r.iframe.getBoundingClientRect(); ox = ir.left; oy = ir.top; }
              return { x: Math.round(ox + rect.left + rect.width / 2), y: Math.round(oy + rect.top + rect.height / 2) };
            }`,
            TARGET_ATTR,
            targetId
          );
          if (!coords) throw new Error(`Target not found: ${targetId}`);
          await managed.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: coords.x, y: coords.y });
          break;
        }

        case "pressKey":
        case "keyboard_shortcut": {
          const shortcut = this.requireActionValue(action);
          await this.dispatchKeyboardShortcut(managed.cdp, shortcut);
          await this.waitForLoadIfNavigating(wc);
          managed.cdp.invalidateContext();
          break;
        }

        case "wait":
          await new Promise((r) => setTimeout(r, Number(action.value) || 1000));
          break;

        case "extract":
          await managed.cdp.evaluate(EXTRACT_PAGE_MODEL_SCRIPT);
          break;

        case "go_back": {
          if (wc.canGoBack()) {
            wc.goBack();
            await this.waitForLoadIfNavigating(wc);
            managed.cdp.invalidateContext();
          }
          break;
        }

        case "wait_for_text": {
          const searchText = this.requireActionValue(action);
          const timeout = Number(action.interactionHint) || 5000;
          const pollInterval = 200;
          const maxAttempts = Math.ceil(timeout / pollInterval);

          let found = false;
          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const hasText = await managed.cdp.callFunction<boolean>(
              `function(searchText) {
                return (document.body.innerText || '').includes(searchText);
              }`,
              searchText
            );
            if (hasText) {
              found = true;
              break;
            }
            await new Promise((r) => setTimeout(r, pollInterval));
          }

          managed.cdp.invalidateContext();
          const pageModelAfterWait = await this.capturePageModel(browserSession);

          if (found) {
            return {
              ok: true,
              action,
              pageModelId: pageModelAfterWait.id,
              summary: `Text "${searchText.slice(0, 60)}" found on page`
            };
          } else {
            return {
              ok: false,
              action,
              pageModelId: pageModelAfterWait.id,
              summary: `Text "${searchText.slice(0, 60)}" not found after ${timeout}ms`,
              failureClass: "interaction_failed" as const
            };
          }
        }

        case "read_text": {
          const targetId = this.requireTargetId(action);
          const text = await managed.cdp.callFunction<string | null>(
            `function(targetAttr, targetId) {
              ${RESOLVE_TARGET_JS}
              var r = _resolve(targetAttr, targetId);
              if (!r.el) return null;
              return (r.el.innerText || '').trim().slice(0, 2000);
            }`,
            TARGET_ATTR,
            targetId
          );
          if (text === null) throw new Error(`Target not found: ${targetId}`);
          const pageModelAfterRead = await this.capturePageModel(browserSession);
          return {
            ok: true,
            action,
            pageModelId: pageModelAfterRead.id,
            summary: `Read text from [${targetId}]: ${text.slice(0, 100)}${text.length > 100 ? "..." : ""}`,
            extractedText: text
          };
        }

        case "wait_for_navigation": {
          const initialUrl = wc.getURL();
          const navTimeout = Number(action.interactionHint) || 10000;
          const navPollInterval = 200;
          const navMaxAttempts = Math.ceil(navTimeout / navPollInterval);

          let navigated = false;
          for (let attempt = 0; attempt < navMaxAttempts; attempt++) {
            const currentUrl = wc.getURL();
            if (currentUrl !== initialUrl) {
              navigated = true;
              break;
            }
            await new Promise((r) => setTimeout(r, navPollInterval));
          }

          if (navigated) {
            // Wait for the new page to finish loading
            await this.waitForLoadIfNavigating(wc);
          }

          managed.cdp.invalidateContext();
          const pageModelAfterNav = await this.capturePageModel(browserSession);

          if (navigated) {
            return {
              ok: true,
              action,
              pageModelId: pageModelAfterNav.id,
              summary: `Navigation detected: ${initialUrl.slice(0, 60)} → ${wc.getURL().slice(0, 60)}`
            };
          } else {
            return {
              ok: false,
              action,
              pageModelId: pageModelAfterNav.id,
              summary: `URL did not change after ${navTimeout}ms (still at ${initialUrl.slice(0, 60)})`,
              failureClass: "interaction_failed" as const
            };
          }
        }

        case "screenshot": {
          const screenshotResult = await managed.cdp.send("Page.captureScreenshot", { format: "png" }) as { data: string };
          const pageModelAfterScreenshot = await this.capturePageModel(browserSession);
          return {
            ok: true,
            action,
            pageModelId: pageModelAfterScreenshot.id,
            summary: "Screenshot captured",
            screenshotBase64: screenshotResult.data
          };
        }
      }

      const pageModel = await this.capturePageModel(browserSession);

      return {
        ok: true,
        action,
        pageModelId: pageModel.id,
        summary: `Executed ${action.type}: ${action.description}`
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failureClass = classifyFailure(message);

      // Capture screenshot on failure for diagnostics
      let screenshotBase64: string | undefined;
      try {
        const screenshotResult = await managed.cdp.send("Page.captureScreenshot", { format: "png" }) as { data: string };
        screenshotBase64 = screenshotResult.data;
      } catch {
        // Screenshot capture itself may fail if session is destroyed
      }

      return {
        ok: false,
        action,
        summary: `Failed to execute ${action.type}: ${message}`,
        failureClass,
        screenshotBase64
      };
    }
  }

  async destroySession(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;

    this.sessions.delete(sessionId);
    this.cookieDismissAttempted.delete(sessionId);

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
    this.cookieDismissAttempted.clear();
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

  private waitForLoadIfNavigating(wc: WebContents): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(resolve, 5000);
      const onLoad = () => { clearTimeout(timeout); resolve(); };
      if (wc.isLoadingMainFrame()) {
        wc.once("did-finish-load", onLoad);
      } else {
        // Check after a short delay — navigation may start asynchronously
        setTimeout(() => {
          if (wc.isLoadingMainFrame()) {
            wc.once("did-finish-load", onLoad);
          } else {
            clearTimeout(timeout);
            resolve();
          }
        }, 300);
      }
    });
  }

  /**
   * Post-action settle: waits briefly for SPA re-renders after interactions.
   * If navigation starts during the settle period, waits for it to complete.
   */
  private async postActionSettle(wc: WebContents): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (wc.isLoadingMainFrame()) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 5000);
        wc.once("did-finish-load", () => { clearTimeout(timeout); resolve(); });
      });
    }
  }

  private async dispatchKeyboardShortcut(cdp: CdpClient, shortcut: string): Promise<void> {
    const { modifiers, key } = parseKeyboardShortcut(shortcut);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", modifiers, key });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", modifiers, key });
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
