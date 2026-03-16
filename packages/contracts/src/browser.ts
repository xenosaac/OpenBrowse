import type { TaskSource, TaskStatus } from "./tasks.js";

export type BrowserActionType =
  | "navigate"
  | "click"
  | "type"
  | "scroll"
  | "select"
  | "wait"
  | "extract"
  | "focus"
  | "hover"
  | "keyboard_shortcut"
  | "pressKey"
  | "screenshot";

export type BrowserActionFailureClass =
  | "element_not_found"
  | "navigation_timeout"
  | "network_error"
  | "interaction_failed"
  | "validation_error"
  | "unknown";

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
  href?: string;
  inputType?: string;
  disabled?: boolean;
  readonly?: boolean;
  checked?: boolean;
  selected?: boolean;
  expanded?: boolean;
  invalid?: boolean;
  text?: string;
  description?: string;
  level?: number;
  current?: string;
  sort?: string;
  options?: Array<{ value: string; label: string }>;
  boundingVisible?: boolean;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export type PageType = "search_results" | "form" | "login" | "checkout" | "article" | "unknown";

export interface PageFormField {
  ref: string;
  label: string;
  type: string;
  required: boolean;
  currentValue: string;
  validationMessage?: string;
}

export interface PageFormSummary {
  action: string;
  method: string;
  fieldCount: number;
  fields?: PageFormField[];
  submitRef?: string;
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
  pageType?: PageType;
  forms?: PageFormSummary[];
  alerts?: string[];
  captchaDetected?: boolean;
  scrollY?: number;
  activeDialog?: { label: string };
}

export interface BrowserAction {
  type: BrowserActionType;
  targetId?: string;
  value?: string;
  description: string;
  interactionHint?: string;
}

export interface BrowserActionResult {
  ok: boolean;
  action: BrowserAction;
  pageModelId?: string;
  summary: string;
  failureClass?: BrowserActionFailureClass;
  screenshotBase64?: string;
}
