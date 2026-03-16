import type {
  BrowserAction,
  BrowserActionResult,
  BrowserProfile,
  ManagedProfileRequest,
  BrowserSession,
  PageModel,
  TaskSource,
  TaskStatus
} from "@openbrowse/contracts";

export interface AttachSessionOptions {
  runId: string;
  groupId: string;
  taskLabel: string;
  source: TaskSource;
  status: TaskStatus;
  isBackground: boolean;
}

export interface BrowserKernel {
  listProfiles(): Promise<BrowserProfile[]>;
  listSessions(): Promise<BrowserSession[]>;
  createManagedProfile(request: ManagedProfileRequest): Promise<BrowserProfile>;
  ensureProfile(profileId?: string): Promise<BrowserProfile>;
  attachSession(profile: BrowserProfile, options?: AttachSessionOptions): Promise<BrowserSession>;
  capturePageModel(session: BrowserSession): Promise<PageModel>;
  executeAction(session: BrowserSession, action: BrowserAction): Promise<BrowserActionResult>;
  destroySession(sessionId: string): Promise<void>;
  destroyAllSessions(): Promise<void>;
  getSession(sessionId: string): Promise<BrowserSession | null>;
}

export class StubBrowserKernel implements BrowserKernel {
  private readonly sessions = new Map<string, BrowserSession>();
  private pageModelOverrideFn?: (session: BrowserSession) => PageModel | undefined;

  /**
   * Set an optional callback that produces simulated page models.
   * When set, `capturePageModel()` will call this function first and
   * return its result if non-undefined. Used by demo scenarios.
   */
  setPageModelOverride(fn: (session: BrowserSession) => PageModel | undefined): void {
    this.pageModelOverrideFn = fn;
  }

  async listProfiles(): Promise<BrowserProfile[]> {
    return [await this.ensureProfile()];
  }

  async listSessions(): Promise<BrowserSession[]> {
    return [...this.sessions.values()];
  }

  async createManagedProfile(request: ManagedProfileRequest): Promise<BrowserProfile> {
    return {
      id: `managed_${request.label.toLowerCase().replace(/\s+/g, "_")}`,
      label: request.label,
      storagePath: `~/Library/Application Support/OpenBrowse/Profiles/${request.label}`,
      isManaged: true
    };
  }

  async ensureProfile(profileId = "managed-default"): Promise<BrowserProfile> {
    return {
      id: profileId,
      label: "Managed Default Profile",
      storagePath: "~/Library/Application Support/OpenBrowse/Profiles/default",
      isManaged: true
    };
  }

  async attachSession(profile: BrowserProfile, options?: AttachSessionOptions): Promise<BrowserSession> {
    const now = new Date().toISOString();
    const session: BrowserSession = {
      id: `session_${options?.runId ?? profile.id}_${Date.now()}`,
      runId: options?.runId ?? `run_${profile.id}`,
      groupId: options?.groupId ?? options?.runId ?? `run_${profile.id}`,
      profileId: profile.id,
      tabId: `tab_${options?.runId ?? profile.id}`,
      taskLabel: options?.taskLabel ?? profile.label,
      source: options?.source ?? "desktop",
      status: options?.status ?? "running",
      isBackground: options?.isBackground ?? false,
      pageUrl: "about:blank",
      state: "attached",
      createdAt: now,
      updatedAt: now
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async capturePageModel(session: BrowserSession): Promise<PageModel> {
    if (this.pageModelOverrideFn) {
      const override = this.pageModelOverrideFn(session);
      if (override) {
        return override;
      }
    }

    return {
      id: `page_${session.id}`,
      url: session.pageUrl,
      title: "Placeholder Page",
      summary: "Stub page model captured from browser runtime.",
      focusedElementId: undefined,
      elements: [],
      visibleText: "",
      createdAt: new Date().toISOString()
    };
  }

  async executeAction(session: BrowserSession, action: BrowserAction): Promise<BrowserActionResult> {
    // Track URL changes from navigate actions
    if (action.type === "navigate" && action.value) {
      const s = this.sessions.get(session.id);
      if (s) {
        s.pageUrl = action.value;
      }
    }

    return {
      ok: true,
      action,
      pageModelId: `page_${session.id}`,
      summary: `Executed stub browser action: ${action.description}`,
      extractedText: action.type === "read_text" ? "(stub: no text available)" : undefined,
      ...(action.type === "wait_for_text" ? { summary: `Stub: waited for text "${(action.value ?? "").slice(0, 60)}"` } : {})
    };
  }

  async destroySession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async destroyAllSessions(): Promise<void> {
    this.sessions.clear();
  }

  async getSession(sessionId: string): Promise<BrowserSession | null> {
    return this.sessions.get(sessionId) ?? null;
  }
}
