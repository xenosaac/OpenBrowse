import type { BrowserKernel } from "@openbrowse/browser-runtime";
import type { ChatBridge } from "@openbrowse/chat-bridge";
import type {
  RuntimeConfig,
  RuntimeDescriptor,
  RuntimeSettings,
  TaskIntent,
  TaskRun,
  WorkflowEvent
} from "@openbrowse/contracts";
import type {
  BookmarkStore,
  BrowserProfileStore,
  BrowsingHistoryStore,
  ChatBridgeStateStore,
  ChatSessionStore,
  CookieContainerStore,
  PreferenceStore,
  RunCheckpointStore,
  SessionTrackingStore,
  StandaloneTabStore,
  WorkflowLogStore
} from "@openbrowse/memory-store";
import type { EventBus } from "@openbrowse/observability";
import type { TaskOrchestrator } from "@openbrowse/orchestrator";
import type { PlannerGateway } from "@openbrowse/planner";
import type { WatchScheduler } from "@openbrowse/scheduler";
import type { ApprovalPolicy } from "@openbrowse/security";

export interface RuntimeExecutionResolver {
  resolveForIntent?(intent: TaskIntent, services: RuntimeServices): Promise<RuntimeServices | null>;
  resolveForRun?(run: TaskRun, services: RuntimeServices): Promise<RuntimeServices | null>;
}

export interface RuntimeServices {
  descriptor: RuntimeDescriptor;
  browserKernel: BrowserKernel;
  browserKernelInit?: () => Promise<void>;
  chatBridge: ChatBridge;
  chatBridgeInit?: () => Promise<void>;
  executionResolver?: RuntimeExecutionResolver;
  eventBus: EventBus<{ workflow: WorkflowEvent }>;
  hasDemos?: boolean;
  orchestrator: TaskOrchestrator;
  planner: PlannerGateway;
  preferenceStore: PreferenceStore;
  runCheckpointStore: RunCheckpointStore;
  runtimeConfig: RuntimeConfig;
  runtimeSettings: RuntimeSettings;
  scheduler: WatchScheduler;
  securityPolicy: ApprovalPolicy;
  sqliteDb?: { close(): void };
  telegramStatePath: string;
  workflowLogStore: WorkflowLogStore;
  // Phase A stores — optional until all consumers migrate
  sessionTrackingStore?: SessionTrackingStore;
  chatSessionStore?: ChatSessionStore;
  bookmarkStore?: BookmarkStore;
  browsingHistoryStore?: BrowsingHistoryStore;
  browserProfileStore?: BrowserProfileStore;
  cookieContainerStore?: CookieContainerStore;
  standaloneTabStore?: StandaloneTabStore;
  chatBridgeStateStore?: ChatBridgeStateStore;
  /** Shared set for cooperative cancellation — cancelTrackedRun adds here,
   *  CancellationController checks here in isCancelled(). */
  pendingCancellations: Set<string>;
}
