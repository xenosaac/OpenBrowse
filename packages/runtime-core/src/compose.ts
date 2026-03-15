import type { BrowserKernel } from "@openbrowse/browser-runtime";
import type { ChatBridge } from "@openbrowse/chat-bridge";
import type { RuntimeConfig, RuntimeDescriptor, RuntimeSettings, TaskIntent, WorkflowEvent } from "@openbrowse/contracts";
import {
  InMemoryPreferenceStore,
  InMemoryRunCheckpointStore,
  InMemoryWorkflowLogStore,
  type PreferenceStore,
  type RunCheckpointStore,
  type WorkflowLogStore
} from "@openbrowse/memory-store/memory";
import { EventBus } from "@openbrowse/observability";
import { DefaultClarificationPolicy, TaskOrchestrator } from "@openbrowse/orchestrator";
import type { PlannerGateway } from "@openbrowse/planner";
import { IntervalWatchScheduler } from "@openbrowse/scheduler";
import { DefaultApprovalPolicy } from "@openbrowse/security";
import { bootstrapRun as bootstrapRuntimeRun } from "./OpenBrowseRuntime.js";
import { buildRuntimeDescriptor } from "./settings.js";
import type { RuntimeServices } from "./types.js";

// ---------------------------------------------------------------------------
// Storage bundle
// ---------------------------------------------------------------------------

export interface StorageBundle {
  workflowLogStore: WorkflowLogStore;
  runCheckpointStore: RunCheckpointStore;
  preferenceStore: PreferenceStore;
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
        SqlitePreferenceStore
      } = await import("@openbrowse/memory-store/sqlite");

      const db = new SqliteDatabase(dbPath);
      return {
        workflowLogStore: new SqliteWorkflowLogStore(db),
        runCheckpointStore: new SqliteRunCheckpointStore(db),
        preferenceStore: new SqlitePreferenceStore(db),
        sqliteDb: db,
        storageDescriptor: {
          mode: "sqlite",
          detail: `Local SQLite persistence is enabled at ${dbPath}.`
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[runtime] Failed to initialize SQLite store, falling back to memory:", message);
      return {
        workflowLogStore: new InMemoryWorkflowLogStore(),
        runCheckpointStore: new InMemoryRunCheckpointStore(),
        preferenceStore: new InMemoryPreferenceStore(),
        storageDescriptor: {
          mode: "memory",
          detail: `Falling back to in-memory storage because SQLite failed to initialize: ${message}`
        }
      };
    }
  }

  return {
    workflowLogStore: new InMemoryWorkflowLogStore(),
    runCheckpointStore: new InMemoryRunCheckpointStore(),
    preferenceStore: new InMemoryPreferenceStore(),
    storageDescriptor: {
      mode: "memory",
      detail: "Falling back to in-memory storage because no desktop app data path was provided."
    }
  };
}

// ---------------------------------------------------------------------------
// Service assembly
// ---------------------------------------------------------------------------

export interface AssembleServicesParams {
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
  workflowLogStore: WorkflowLogStore;
  runCheckpointStore: RunCheckpointStore;
  preferenceStore: PreferenceStore;
  sqliteDb?: { close(): void };
  storageDescriptor: RuntimeDescriptor["storage"];
  hasDemos?: boolean;
  telegramStatePath: string;
}

/**
 * Assembles the full RuntimeServices object from pre-built subsystem parts.
 * Owns the scheduler, event bus, orchestrator, and security policy construction.
 */
export function assembleRuntimeServices(params: AssembleServicesParams): RuntimeServices {
  // The scheduler needs a forward reference to services so it can call bootstrapRun.
  let services!: RuntimeServices;

  const scheduler = new IntervalWatchScheduler(async (intent) => {
    const schedulerIntent: TaskIntent = {
      ...intent,
      id: `${intent.id}_${Date.now()}`,
      source: "scheduler",
      createdAt: new Date().toISOString()
    };
    await bootstrapRuntimeRun(services, schedulerIntent);
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
    workflowLogStore: params.workflowLogStore
  };

  return services;
}
