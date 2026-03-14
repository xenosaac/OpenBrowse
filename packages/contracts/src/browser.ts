import type { TaskSource, TaskStatus } from "./tasks.js";

export type BrowserActionType =
  | "navigate"
  | "click"
  | "type"
  | "scroll"
  | "select"
  | "wait"
  | "extract";

export type BrowserSessionState = "warm" | "attached" | "terminated";

export interface BrowserProfile {
  id: string;
  label: string;
  storagePath: string;
  isManaged: boolean;
}

export interface ManagedProfileRequest {
  label: string;
}

export interface BrowserSession {
  id: string;
  runId: string;
  groupId: string;
  profileId: string;
  tabId: string;
  taskLabel: string;
  source: TaskSource;
  status: TaskStatus;
  isBackground: boolean;
  pageUrl: string;
  state: BrowserSessionState;
  createdAt: string;
  updatedAt: string;
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
  visibleText?: string;
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
