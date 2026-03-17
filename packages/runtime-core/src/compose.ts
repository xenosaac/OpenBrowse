import type { BrowserKernel } from "@openbrowse/browser-runtime";
import type { ChatBridge } from "@openbrowse/chat-bridge";
import type { RuntimeConfig, RuntimeDescriptor, RuntimeSettings, TaskIntent, TaskRun, WorkflowEvent } from "@openbrowse/contracts";
import {
  InMemoryBookmarkStore,
  InMemoryBrowserProfileStore,
  InMemoryBrowsingHistoryStore,
  InMemoryChatBridgeStateStore,
  InMemoryChatSessionStore,
  InMemoryCookieContainerStore,
  InMemoryPreferenceStore,
  InMemoryRunCheckpointStore,
  InMemorySessionTrackingStore,
  InMemoryStandaloneTabStore,
  InMemoryWorkflowLogStore,
  type BookmarkStore,
  type BrowserProfileStore,
  type BrowsingHistoryStore,
  type ChatBridgeStateStore,
  type ChatSessionStore,
  type CookieContainerStore,
  type PreferenceStore,
  type RunCheckpointStore,
  type SessionTrackingStore,
  type StandaloneTabStore,
  type WorkflowLogStore
} from "@openbrowse/memory-store/memory";
import { EventBus } from "@openbrowse/observability";
import { DefaultClarificationPolicy, TaskOrchestrator } from "@openbrowse/orchestrator";
import type { PlannerGateway } from "@openbrowse/planner";
import { IntervalWatchScheduler } from "@openbrowse/scheduler";
import { DefaultApprovalPolicy } from "@openbrowse/security";
import { buildRuntimeDescriptor } from "./runtimeDescriptor.js";
import type { RuntimeServices } from "./types.js";

// ---------------------------------------------------------------------------
// Storage bundle
// ---------------------------------------------------------------------------

export interface StorageBundle {
  workflowLogStore: WorkflowLogStore;
  runCheckpointStore: RunCheckpointStore;
  preferenceStore: PreferenceStore;
  sessionTrackingStore: SessionTrackingStore;
  chatSessionStore: ChatSessionStore;
  bookmarkStore: BookmarkStore;
  browsingHistoryStore: BrowsingHistoryStore;
  browserProfileStore: BrowserProfileStore;
  cookieContainerStore: CookieContainerStore;
  standaloneTabStore: StandaloneTabStore;
  chatBridgeStateStore: ChatBridgeStateStore;
  sqliteDb?: { close(): void };
  storageDescriptor: RuntimeDescriptor["storage"];
}

/**
 * Creates storage services with SQLite when a dbPath is provided, falling back
 * to in-memory stores on failure or when no path is given.
 */
export async function createRuntimeStorage(dbPath?: string): Promise<StorageBundle> {
  if (dbPath) {
    try {
      const {
        SqliteDatabase,
        SqliteWorkflowLogStore,
        SqliteRunCheckpointStore,
        SqlitePreferenceStore,
        SqliteSessionTrackingStore,
        SqliteChatSessionStore,
        SqliteBookmarkStore,
        SqliteBrowsingHistoryStore,
        SqliteBrowserProfileStore,
        SqliteCookieContainerStore,
        SqliteStandaloneTabStore,
        SqliteChatBridgeStateStore
      } = await import("@openbrowse/memory-store/sqlite");

      const db = new SqliteDatabase(dbPath);
      return {
        workflowLogStore: new SqliteWorkflowLogStore(db),
        runCheckpointStore: new SqliteRunCheckpointStore(db),
        preferenceStore: new SqlitePreferenceStore(db),
        sessionTrackingStore: new SqliteSessionTrackingStore(db),
        chatSessionStore: new SqliteChatSessionStore(db),
        bookmarkStore: new SqliteBookmarkStore(db),
        browsingHistoryStore: new SqliteBrowsingHistoryStore(db),
        browserProfileStore: new SqliteBrowserProfileStore(db),
        cookieContainerStore: new SqliteCookieContainerStore(db),
        standaloneTabStore: new SqliteStandaloneTabStore(db),
        chatBridgeStateStore: new SqliteChatBridgeStateStore(db),
        sqliteDb: db,
        storageDescriptor: {
          mode: "sqlite",
          detail: `Local SQLite persistence is enabled at ${dbPath}.`
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[runtime] Failed to initialize SQLite store, falling back to memory:", message);
      return createInMemoryBundle(
        `Falling back to in-memory storage because SQLite failed to initialize: ${message}`
      );
    }
  }

  return createInMemoryBundle(
    "Falling back to in-memory storage because no desktop app data path was provided."
  );
}

function createInMemoryBundle(detail: string): StorageBundle {
  return {
    workflowLogStore: new InMemoryWorkflowLogStore(),
    runCheckpointStore: new InMemoryRunCheckpointStore(),
    preferenceStore: new InMemoryPreferenceStore(),
    sessionTrackingStore: new InMemorySessionTrackingStore(),
    chatSessionStore: new InMemoryChatSessionStore(),
    bookmarkStore: new InMemoryBookmarkStore(),
    browsingHistoryStore: new InMemoryBrowsingHistoryStore(),
    browserProfileStore: new InMemoryBrowserProfileStore(),
    cookieContainerStore: new InMemoryCookieContainerStore(),
    standaloneTabStore: new InMemoryStandaloneTabStore(),
    chatBridgeStateStore: new InMemoryChatBridgeStateStore(),
    storageDescriptor: { mode: "memory", detail }
  };
}

// ---------------------------------------------------------------------------
// Service assembly
// ---------------------------------------------------------------------------

export interface AssembleServicesParams extends StorageBundle {
  runtimeConfig: RuntimeConfig;
  runtimeSettings: RuntimeSettings;
  planner: PlannerGateway;
  plannerDescriptor: RuntimeDescriptor["planner"];
  chatBridge: ChatBridge;
  chatBridgeInit?: () => Promise<void>;
  chatBridgeDescriptor: RuntimeDescriptor["chatBridge"];
  browserKernel: BrowserKernel;
  browserKernelInit?: () => Promise<void>;
  browserDescriptor: RuntimeDescriptor["browser"];
  hasDemos?: boolean;
  telegramStatePath: string;
  /** Scheduler dispatch function — called when a watch fires to bootstrap a new run. */
  schedulerDispatch: (services: RuntimeServices, intent: TaskIntent) => Promise<unknown>;
}

export interface WatchChangeInfo {
  changed: boolean;
  diff?: string;
}

/**
 * Compares two sets of extracted data items and returns a change summary.
 * @internal Exported for testing only.
 */
export function compareExtractedData(
  previous: Array<{ label: string; value: string }> | undefined,
  current: Array<{ label: string; value: string }> | undefined
): WatchChangeInfo {
  if (!previous || previous.length === 0) {
    return { changed: false }; // First run or no data — no comparison possible
  }
  if (!current || current.length === 0) {
    return { changed: true, diff: "No data extracted (previously had data)" };
  }

  const prevMap = new Map(previous.map((d) => [d.label, d.value]));
  const diffs: string[] = [];

  for (const item of current) {
    const prevValue = prevMap.get(item.label);
    if (prevValue === undefined) {
      diffs.push(`+ ${item.label}: ${item.value}`);
    } else if (prevValue !== item.value) {
      diffs.push(`${item.label}: ${prevValue} → ${item.value}`);
    }
    prevMap.delete(item.label);
  }
  for (const [label, value] of prevMap) {
    diffs.push(`- ${label}: ${value}`);
  }

  if (diffs.length === 0) {
    return { changed: false };
  }
  return { changed: true, diff: diffs.join("\n") };
}

/**
 * Formats a concise watch notification for Telegram delivery.
 * @internal Exported for testing only.
 */
export function formatWatchNotification(run: TaskRun, changeInfo?: WatchChangeInfo): string {
  const isSuccess = run.status === "completed";
  const statusIcon = isSuccess ? "\u2713" : "\u2717";
  const statusText = isSuccess ? "Completed" : "Failed";

  const lines: string[] = [
    `[Watch] ${run.goal}`,
    `Status: ${statusIcon} ${statusText}`
  ];

  if (changeInfo) {
    lines.push(changeInfo.changed ? "[CHANGED]" : "[No change]");
  }

  if (run.outcome?.summary) {
    lines.push("", run.outcome.summary);
  }

  if (changeInfo?.changed && changeInfo.diff) {
    lines.push("", "Changes:", changeInfo.diff);
  }

  if (run.outcome?.extractedData && run.outcome.extractedData.length > 0) {
    lines.push("");
    for (const item of run.outcome.extractedData) {
      lines.push(`${item.label}: ${item.value}`);
    }
  }

  return lines.join("\n");
}

/**
 * Assembles the full RuntimeServices object from pre-built subsystem parts.
 * Owns the scheduler, event bus, orchestrator, and security policy construction.
 */
export function assembleRuntimeServices(params: AssembleServicesParams): RuntimeServices {
  // The scheduler needs a forward reference to services so it can call bootstrapRun.
  let services!: RuntimeServices;

  const scheduler = new IntervalWatchScheduler(async (intent, watchId) => {
    const schedulerIntent: TaskIntent = {
      ...intent,
      id: `${intent.id}_${Date.now()}`,
      source: "scheduler",
      createdAt: new Date().toISOString()
    };
    try {
      const result = await params.schedulerDispatch(services, schedulerIntent);
      // Send concise watch-specific notification via Telegram
      const run = result as TaskRun | undefined;
      if (run && run.status && run.goal) {
        // Compare extractedData with previous run
        const previousData = scheduler.getWatchData(watchId);
        const currentData = run.outcome?.extractedData;
        const changeInfo = compareExtractedData(previousData, currentData);

        // Update watch with current data for next comparison
        if (currentData && currentData.length > 0) {
          scheduler.updateWatchData(watchId, currentData);
        }

        const text = formatWatchNotification(run, changeInfo);
        void services.chatBridge.send({ channel: "telegram", runId: run.id, text })
          .catch((err: unknown) => console.error("[scheduler] Watch notification failed:", err instanceof Error ? err.message : err));
      }
    } catch (error) {
      // Send failure notification for initialization crashes
      const errorMsg = error instanceof Error ? error.message : String(error);
      const text = `[Watch] ${intent.goal}\nStatus: \u2717 Error\n\n${errorMsg}`;
      void services.chatBridge.send({ channel: "telegram", runId: intent.id, text })
        .catch(() => {});
      throw error; // re-throw so scheduler handles backoff
    }
  });

  services = {
    descriptor: buildRuntimeDescriptor({
      planner: params.plannerDescriptor,
      browser: params.browserDescriptor,
      chatBridge: params.chatBridgeDescriptor,
      storage: params.storageDescriptor,
      hasDemos: params.hasDemos
    }),
    browserKernel: params.browserKernel,
    browserKernelInit: params.browserKernelInit,
    chatBridge: params.chatBridge,
    chatBridgeInit: params.chatBridgeInit,
    eventBus: new EventBus<{ workflow: WorkflowEvent }>(),
    hasDemos: params.hasDemos,
    orchestrator: new TaskOrchestrator({
      clarificationPolicy: new DefaultClarificationPolicy()
    }),
    planner: params.planner,
    preferenceStore: params.preferenceStore,
    runCheckpointStore: params.runCheckpointStore,
    runtimeConfig: params.runtimeConfig,
    runtimeSettings: params.runtimeSettings,
    scheduler,
    securityPolicy: new DefaultApprovalPolicy({
      riskClassPolicies: params.runtimeSettings.riskClassPolicies
    }),
    sqliteDb: params.sqliteDb,
    telegramStatePath: params.telegramStatePath,
    workflowLogStore: params.workflowLogStore,
    sessionTrackingStore: params.sessionTrackingStore,
    chatSessionStore: params.chatSessionStore,
    bookmarkStore: params.bookmarkStore,
    browsingHistoryStore: params.browsingHistoryStore,
    browserProfileStore: params.browserProfileStore,
    cookieContainerStore: params.cookieContainerStore,
    standaloneTabStore: params.standaloneTabStore,
    chatBridgeStateStore: params.chatBridgeStateStore,
    pendingCancellations: new Set<string>()
  };

  return services;
}
