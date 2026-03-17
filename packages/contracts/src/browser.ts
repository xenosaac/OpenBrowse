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
  | "screenshot"
  | "go_back"
  | "read_text"
  | "wait_for_text"
  | "wait_for_navigation"
  | "save_note";

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
  pressed?: boolean | "mixed";
  invalid?: boolean;
  text?: string;
  description?: string;
  level?: number;
  current?: string;
  sort?: string;
  roleDescription?: string;
  valueNow?: number;
  valueMin?: number;
  valueMax?: number;
  valueText?: string;
  orientation?: "horizontal" | "vertical";
  autocomplete?: "inline" | "list" | "both";
  multiselectable?: boolean;
  required?: boolean;
  hasPopup?: string;
  busy?: boolean;
  live?: string;
  options?: Array<{ value: string; label: string }>;
  keyShortcuts?: string;
  landmark?: string;
  inShadowDom?: boolean;
  iframeIndex?: number;
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
  cookieBannerDetected?: boolean;
  scrollY?: number;
  activeDialog?: { label: string };
  tables?: Array<{
    caption?: string;
    headers: string[];
    rowCount: number;
    sampleRows?: string[][];
  }>;
  landmarks?: Array<{ role: string; label: string }>;
  iframeCount?: number;
  iframeSources?: string[];
}

export interface BrowserAction {
  type: BrowserActionType;
  targetId?: string;
  value?: string;
  description: string;
  interactionHint?: string;
  clearFirst?: boolean;
}

export interface BrowserActionResult {
  ok: boolean;
  action: BrowserAction;
  pageModelId?: string;
  summary: string;
  failureClass?: BrowserActionFailureClass;
  screenshotBase64?: string;
  extractedText?: string;
}
