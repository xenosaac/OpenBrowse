import type { RiskClassPolicies, TaskSource, TaskStatus } from "./tasks.js";

export interface RuntimeConfig {
  platform: "macos";
  siliconOnly: true;
  appName: string;
  workflowLogPath: string;
  managedProfilesPath: string;
}

export type RuntimePhase = "phase1" | "phase2" | "phase3" | "phase4" | "phase5" | "phase6" | "phase7";
export type RuntimeMode = "desktop_skeleton" | "desktop_runtime";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-4-6";
export const OPUS_ANTHROPIC_MODEL = "claude-opus-4-6";

export interface RuntimeAdapterStatus {
  mode: "stub" | "live" | "experimental";
  detail: string;
}

export interface RuntimeStorageStatus {
  mode: "sqlite" | "memory";
  detail: string;
}

export interface RuntimeDescriptor {
  phase: RuntimePhase;
  mode: RuntimeMode;
  planner: RuntimeAdapterStatus;
  browser: RuntimeAdapterStatus;
  chatBridge: RuntimeAdapterStatus;
  storage: RuntimeStorageStatus;
  notes: string[];
  deferredCapabilities: string[];
}

export interface BrowserShellTabDescriptor {
  id: string;
  runId: string;
  groupId: string;
  title: string;
  url: string;
  profileId: string;
  source: TaskSource;
  status: TaskStatus;
  isBackground: boolean;
  closable: boolean;
  faviconUrl?: string;
}

export interface BrowserViewportBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RecoverySummary {
  resumed: number;
  awaitingInput: number;
  failed: number;
  skipped: number;
}

export interface RuntimeSettings {
  anthropicApiKey: string;
  plannerModel: string;
  telegramBotToken: string;
  telegramChatId: string;
  /** Controls how many run events are forwarded to the Telegram chat.
   *  "quiet" (default) — only suspension and terminal events.
   *  "verbose" — every browser action step. */
  telegramNotificationLevel: "quiet" | "verbose";
  /** Per-risk-class approval policies. Missing keys use "default" (standard risk-level logic). */
  riskClassPolicies: RiskClassPolicies;
}

export function createDefaultRuntimeSettings(): RuntimeSettings {
  return {
    anthropicApiKey: "",
    plannerModel: DEFAULT_ANTHROPIC_MODEL,
    telegramBotToken: "",
    telegramChatId: "",
    telegramNotificationLevel: "quiet",
    riskClassPolicies: {}
  };
}
