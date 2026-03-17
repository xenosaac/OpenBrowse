import test from "node:test";
import assert from "node:assert/strict";

import {
  assembleRuntimeServices,
  createRuntimeStorage,
} from "../packages/runtime-core/dist/compose.js";
import { createDefaultRuntimeSettings } from "../packages/contracts/dist/index.js";

// ---------------------------------------------------------------------------
// Helpers — minimal stubs for required params
// ---------------------------------------------------------------------------

function stubBrowserKernel() {
  return {
    init: async () => {},
    createSession: async () => null,
    getSession: () => null,
    destroySession: async () => {},
    executeAction: async () => ({ success: false, error: "stub" }),
  };
}

function stubPlanner() {
  return {
    decide: async () => ({ type: "task_complete", reasoning: "stub" }),
  };
}

function stubChatBridge() {
  return {
    send: async () => {},
    sendClarification: async () => {},
    normalizeInbound: async (m) => m,
    shouldSendStepProgress: () => false,
    clearRunState: async () => {},
  };
}

async function makeStorageBundle() {
  return createRuntimeStorage(undefined);
}

function makeRuntimeConfig() {
  return {
    platform: "macos",
    siliconOnly: true,
    appName: "OpenBrowse",
    workflowLogPath: "/tmp/test-wf",
    managedProfilesPath: "/tmp/test-profiles",
  };
}

async function makeAssembleParams(overrides = {}) {
  const storage = await makeStorageBundle();
  return {
    runtimeConfig: makeRuntimeConfig(),
    runtimeSettings: createDefaultRuntimeSettings(),
    planner: stubPlanner(),
    plannerDescriptor: { mode: "stub", detail: "test" },
    chatBridge: stubChatBridge(),
    chatBridgeDescriptor: { mode: "stub", detail: "test" },
    browserKernel: stubBrowserKernel(),
    browserDescriptor: { mode: "stub", detail: "test" },
    ...storage,
    hasDemos: false,
    telegramStatePath: "/tmp/test-tg-state.json",
    schedulerDispatch: async () => {},
    ...overrides,
  };
}

// ===========================================================================
// createRuntimeStorage
// ===========================================================================

test("createRuntimeStorage — no dbPath returns in-memory bundle", async () => {
  const bundle = await createRuntimeStorage(undefined);
  assert.equal(bundle.storageDescriptor.mode, "memory");
  assert.ok(bundle.storageDescriptor.detail.includes("no desktop app data path"));
  assert.equal(bundle.sqliteDb, undefined);
});

test("createRuntimeStorage — all 11 store properties present", async () => {
  const bundle = await createRuntimeStorage(undefined);
  const expectedStores = [
    "workflowLogStore", "runCheckpointStore", "preferenceStore",
    "sessionTrackingStore", "chatSessionStore", "bookmarkStore",
    "browsingHistoryStore", "browserProfileStore", "cookieContainerStore",
    "standaloneTabStore", "chatBridgeStateStore",
  ];
  for (const store of expectedStores) {
    assert.ok(bundle[store] !== undefined, `missing store: ${store}`);
  }
});

test("createRuntimeStorage — invalid dbPath falls back to memory", async () => {
  const bundle = await createRuntimeStorage("/nonexistent/path/db.sqlite");
  assert.equal(bundle.storageDescriptor.mode, "memory");
  assert.ok(bundle.storageDescriptor.detail.includes("SQLite failed"));
});

// ===========================================================================
// assembleRuntimeServices
// ===========================================================================

test("assembleRuntimeServices — returns object with all RuntimeServices keys", async () => {
  const params = await makeAssembleParams();
  const services = assembleRuntimeServices(params);

  const requiredKeys = [
    "descriptor", "browserKernel", "chatBridge", "eventBus",
    "orchestrator", "planner", "preferenceStore", "runCheckpointStore",
    "runtimeConfig", "runtimeSettings", "scheduler", "securityPolicy",
    "telegramStatePath", "workflowLogStore", "pendingCancellations",
  ];
  for (const key of requiredKeys) {
    assert.ok(key in services, `missing key: ${key}`);
  }
});

test("assembleRuntimeServices — passes through store instances", async () => {
  const params = await makeAssembleParams();
  const services = assembleRuntimeServices(params);

  assert.equal(services.workflowLogStore, params.workflowLogStore);
  assert.equal(services.runCheckpointStore, params.runCheckpointStore);
  assert.equal(services.preferenceStore, params.preferenceStore);
  assert.equal(services.bookmarkStore, params.bookmarkStore);
  assert.equal(services.browsingHistoryStore, params.browsingHistoryStore);
});

test("assembleRuntimeServices — passes through browserKernel and chatBridge", async () => {
  const params = await makeAssembleParams();
  const services = assembleRuntimeServices(params);

  assert.equal(services.browserKernel, params.browserKernel);
  assert.equal(services.chatBridge, params.chatBridge);
  assert.equal(services.planner, params.planner);
});

test("assembleRuntimeServices — passes through runtimeConfig and runtimeSettings", async () => {
  const params = await makeAssembleParams();
  const services = assembleRuntimeServices(params);

  assert.equal(services.runtimeConfig, params.runtimeConfig);
  assert.equal(services.runtimeSettings, params.runtimeSettings);
});

test("assembleRuntimeServices — creates EventBus instance", async () => {
  const params = await makeAssembleParams();
  const services = assembleRuntimeServices(params);

  assert.ok(services.eventBus);
  assert.equal(typeof services.eventBus.publish, "function");
  assert.equal(typeof services.eventBus.subscribe, "function");
});

test("assembleRuntimeServices — creates TaskOrchestrator", async () => {
  const params = await makeAssembleParams();
  const services = assembleRuntimeServices(params);

  assert.ok(services.orchestrator);
  assert.equal(typeof services.orchestrator.createRun, "function");
  assert.equal(typeof services.orchestrator.startRun, "function");
});

test("assembleRuntimeServices — creates DefaultApprovalPolicy as securityPolicy", async () => {
  const params = await makeAssembleParams();
  const services = assembleRuntimeServices(params);

  assert.ok(services.securityPolicy);
  assert.equal(typeof services.securityPolicy.requiresApproval, "function");
});

test("assembleRuntimeServices — creates scheduler with dispatch capability", async () => {
  const params = await makeAssembleParams();
  const services = assembleRuntimeServices(params);

  assert.ok(services.scheduler);
  assert.equal(typeof services.scheduler.registerWatch, "function");
  assert.equal(typeof services.scheduler.unregisterWatch, "function");
});

test("assembleRuntimeServices — hasDemos propagated", async () => {
  const params = await makeAssembleParams({ hasDemos: true });
  const services = assembleRuntimeServices(params);

  assert.equal(services.hasDemos, true);
});

test("assembleRuntimeServices — hasDemos false", async () => {
  const params = await makeAssembleParams({ hasDemos: false });
  const services = assembleRuntimeServices(params);

  assert.equal(services.hasDemos, false);
});

test("assembleRuntimeServices — telegramStatePath propagated", async () => {
  const params = await makeAssembleParams({ telegramStatePath: "/custom/path.json" });
  const services = assembleRuntimeServices(params);

  assert.equal(services.telegramStatePath, "/custom/path.json");
});

test("assembleRuntimeServices — sqliteDb passed through (undefined for in-memory)", async () => {
  const params = await makeAssembleParams();
  const services = assembleRuntimeServices(params);

  assert.equal(services.sqliteDb, undefined);
});

test("assembleRuntimeServices — descriptor built from subsystem descriptors", async () => {
  const params = await makeAssembleParams({
    plannerDescriptor: { mode: "live", detail: "Claude live" },
    browserDescriptor: { mode: "stub", detail: "stub browser" },
    chatBridgeDescriptor: { mode: "stub", detail: "stub chat" },
  });
  const services = assembleRuntimeServices(params);

  assert.ok(services.descriptor);
  assert.equal(services.descriptor.planner.mode, "live");
  assert.equal(services.descriptor.browser.mode, "stub");
  assert.equal(services.descriptor.chatBridge.mode, "stub");
});

test("assembleRuntimeServices — browserKernelInit and chatBridgeInit passed through", async () => {
  const bInit = async () => {};
  const cInit = async () => {};
  const params = await makeAssembleParams({
    browserKernelInit: bInit,
    chatBridgeInit: cInit,
  });
  const services = assembleRuntimeServices(params);

  assert.equal(services.browserKernelInit, bInit);
  assert.equal(services.chatBridgeInit, cInit);
});

test("assembleRuntimeServices — schedulerDispatch is used by scheduler", async (t) => {
  let dispatched = false;
  const params = await makeAssembleParams({
    schedulerDispatch: async () => { dispatched = true; },
  });
  const services = assembleRuntimeServices(params);

  // Register a watch and trigger it — the dispatch should be called
  const watchId = await services.scheduler.registerWatch({
    id: "test-intent",
    goal: "test",
    source: "scheduler",
    constraints: [],
    createdAt: new Date().toISOString(),
  }, 0.001);

  // Wait for the scheduler to fire (0.001 * 60000ms = 60ms, give extra margin)
  await new Promise((resolve) => setTimeout(resolve, 200));

  services.scheduler.dispose();

  assert.equal(dispatched, true, "schedulerDispatch should have been called");
});

test("assembleRuntimeServices — riskClassPolicies from settings used in securityPolicy", async () => {
  const settings = createDefaultRuntimeSettings();
  settings.riskClassPolicies = { financial: "always_ask" };
  const params = await makeAssembleParams({ runtimeSettings: settings });
  const services = assembleRuntimeServices(params);

  // Financial actions should require approval due to always_ask policy
  const run = {
    id: "run_test",
    taskIntentId: "test",
    status: "running",
    goal: "test",
    source: "desktop",
    constraints: [],
    metadata: { approval_mode: "auto" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    checkpoint: { summary: "", notes: [], stepCount: 0, actionHistory: [], consecutiveSoftFailures: 0 },
  };
  const action = { type: "click", targetId: "el_1", description: "Pay now with credit card" };
  const result = services.securityPolicy.requiresApproval(run, action);
  assert.equal(result, true);
});

test("assembleRuntimeServices — pendingCancellations is an empty Set", async () => {
  const params = await makeAssembleParams();
  const services = assembleRuntimeServices(params);
  assert.ok(services.pendingCancellations instanceof Set);
  assert.equal(services.pendingCancellations.size, 0);
});
