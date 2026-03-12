export type BrowserActionType =
  | "navigate"
  | "click"
  | "type"
  | "scroll"
  | "select"
  | "wait"
  | "extract";

export interface BrowserProfile {
  id: string;
  label: string;
  storagePath: string;
  isManaged: boolean;
}

export interface BrowserSession {
  id: string;
  profileId: string;
  tabId: string;
  pageUrl: string;
  createdAt: string;
}

export interface PageElementModel {
  id: string;
  role: string;
  label: string;
  value?: string;
  isActionable: boolean;
}

export interface PageModel {
  id: string;
  url: string;
  title: string;
  summary: string;
  focusedElementId?: string;
  elements: PageElementModel[];
  createdAt: string;
}

export interface BrowserAction {
  type: BrowserActionType;
  targetId?: string;
  value?: string;
  description: string;
}

export interface BrowserActionResult {
  ok: boolean;
  action: BrowserAction;
  pageModelId?: string;
  summary: string;
}

