import type {
  BrowserAction,
  BrowserActionResult,
  BrowserProfile,
  BrowserSession,
  PageModel
} from "@openbrowse/contracts";

export interface BrowserKernel {
  ensureProfile(profileId?: string): Promise<BrowserProfile>;
  attachSession(profile: BrowserProfile): Promise<BrowserSession>;
  capturePageModel(session: BrowserSession): Promise<PageModel>;
  executeAction(session: BrowserSession, action: BrowserAction): Promise<BrowserActionResult>;
}

export class StubBrowserKernel implements BrowserKernel {
  async ensureProfile(profileId = "managed-default"): Promise<BrowserProfile> {
    return {
      id: profileId,
      label: "Managed Default Profile",
      storagePath: "~/Library/Application Support/OpenBrowse/Profiles/default",
      isManaged: true
    };
  }

  async attachSession(profile: BrowserProfile): Promise<BrowserSession> {
    return {
      id: `session_${profile.id}`,
      profileId: profile.id,
      tabId: "tab_1",
      pageUrl: "about:blank",
      createdAt: new Date().toISOString()
    };
  }

  async capturePageModel(session: BrowserSession): Promise<PageModel> {
    return {
      id: `page_${session.id}`,
      url: session.pageUrl,
      title: "Placeholder Page",
      summary: "Stub page model captured from browser runtime.",
      focusedElementId: undefined,
      elements: [],
      createdAt: new Date().toISOString()
    };
  }

  async executeAction(session: BrowserSession, action: BrowserAction): Promise<BrowserActionResult> {
    return {
      ok: true,
      action,
      pageModelId: `page_${session.id}`,
      summary: `Executed stub browser action: ${action.description}`
    };
  }
}

