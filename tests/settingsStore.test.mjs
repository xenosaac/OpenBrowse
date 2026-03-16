import test from "node:test";
import assert from "node:assert/strict";

import { readStoredRuntimeSettings, RUNTIME_SETTINGS_NAMESPACE, validateRiskClassPolicies } from "../packages/runtime-core/dist/settingsStore.js";
import { createDefaultRuntimeSettings, DEFAULT_ANTHROPIC_MODEL } from "../packages/contracts/dist/runtime.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a mock PreferenceStore backed by a simple Map. */
function createMockPreferenceStore(entries = {}) {
  const store = new Map();
  for (const [key, value] of Object.entries(entries)) {
    store.set(`${RUNTIME_SETTINGS_NAMESPACE}:${key}`, {
      id: `pref_${key}`,
      namespace: RUNTIME_SETTINGS_NAMESPACE,
      key,
      value,
      capturedAt: new Date().toISOString()
    });
  }
  return {
    get: async (namespace, key) => store.get(`${namespace}:${key}`) ?? null,
    upsert: async () => {},
    list: async () => [],
    delete: async () => false,
    deleteByKey: async () => false,
    saveNamespaceSettings: async () => {}
  };
}

// ---------------------------------------------------------------------------
// RUNTIME_SETTINGS_NAMESPACE
// ---------------------------------------------------------------------------

test("RUNTIME_SETTINGS_NAMESPACE is 'runtime_settings'", () => {
  assert.equal(RUNTIME_SETTINGS_NAMESPACE, "runtime_settings");
});

// ---------------------------------------------------------------------------
// readStoredRuntimeSettings — defaults
// ---------------------------------------------------------------------------

test("returns all defaults when store is empty", async () => {
  const store = createMockPreferenceStore();
  const settings = await readStoredRuntimeSettings(store);
  const defaults = createDefaultRuntimeSettings();

  assert.equal(settings.anthropicApiKey, defaults.anthropicApiKey);
  assert.equal(settings.plannerModel, defaults.plannerModel);
  assert.equal(settings.telegramBotToken, defaults.telegramBotToken);
  assert.equal(settings.telegramChatId, defaults.telegramChatId);
  assert.equal(settings.telegramNotificationLevel, defaults.telegramNotificationLevel);
  assert.deepEqual(settings.riskClassPolicies, {});
});

test("default anthropicApiKey is empty string", async () => {
  const store = createMockPreferenceStore();
  const settings = await readStoredRuntimeSettings(store);
  assert.equal(settings.anthropicApiKey, "");
});

test("default plannerModel is DEFAULT_ANTHROPIC_MODEL", async () => {
  const store = createMockPreferenceStore();
  const settings = await readStoredRuntimeSettings(store);
  assert.equal(settings.plannerModel, DEFAULT_ANTHROPIC_MODEL);
});

test("default telegramNotificationLevel is 'quiet'", async () => {
  const store = createMockPreferenceStore();
  const settings = await readStoredRuntimeSettings(store);
  assert.equal(settings.telegramNotificationLevel, "quiet");
});

// ---------------------------------------------------------------------------
// readStoredRuntimeSettings — stored values
// ---------------------------------------------------------------------------

test("reads stored anthropicApiKey", async () => {
  const store = createMockPreferenceStore({ anthropic_api_key: "sk-test-key-123" });
  const settings = await readStoredRuntimeSettings(store);
  assert.equal(settings.anthropicApiKey, "sk-test-key-123");
});

test("reads stored plannerModel", async () => {
  const store = createMockPreferenceStore({ planner_model: "claude-opus-4-6" });
  const settings = await readStoredRuntimeSettings(store);
  assert.equal(settings.plannerModel, "claude-opus-4-6");
});

test("reads stored telegramBotToken", async () => {
  const store = createMockPreferenceStore({ telegram_bot_token: "123456:ABC-DEF" });
  const settings = await readStoredRuntimeSettings(store);
  assert.equal(settings.telegramBotToken, "123456:ABC-DEF");
});

test("reads stored telegramChatId", async () => {
  const store = createMockPreferenceStore({ telegram_chat_id: "987654321" });
  const settings = await readStoredRuntimeSettings(store);
  assert.equal(settings.telegramChatId, "987654321");
});

test("reads stored telegramNotificationLevel", async () => {
  const store = createMockPreferenceStore({ telegram_notification_level: "verbose" });
  const settings = await readStoredRuntimeSettings(store);
  assert.equal(settings.telegramNotificationLevel, "verbose");
});

// ---------------------------------------------------------------------------
// readStoredRuntimeSettings — riskClassPolicies JSON parsing
// ---------------------------------------------------------------------------

test("parses valid riskClassPolicies JSON", async () => {
  const policies = { financial: "always_ask", navigation: "auto_approve" };
  const store = createMockPreferenceStore({ risk_class_policies: JSON.stringify(policies) });
  const settings = await readStoredRuntimeSettings(store);
  assert.deepEqual(settings.riskClassPolicies, policies);
});

test("falls back to empty object for invalid riskClassPolicies JSON", async () => {
  const store = createMockPreferenceStore({ risk_class_policies: "not-valid-json{" });
  const settings = await readStoredRuntimeSettings(store);
  assert.deepEqual(settings.riskClassPolicies, {});
});

test("falls back to empty object for empty riskClassPolicies value", async () => {
  const store = createMockPreferenceStore({ risk_class_policies: "" });
  const settings = await readStoredRuntimeSettings(store);
  assert.deepEqual(settings.riskClassPolicies, {});
});

test("parses complex riskClassPolicies with all 6 risk classes", async () => {
  const policies = {
    financial: "always_ask",
    credential: "always_ask",
    destructive: "always_ask",
    submission: "default",
    navigation: "auto_approve",
    general: "auto_approve"
  };
  const store = createMockPreferenceStore({ risk_class_policies: JSON.stringify(policies) });
  const settings = await readStoredRuntimeSettings(store);
  assert.deepEqual(settings.riskClassPolicies, policies);
});

// ---------------------------------------------------------------------------
// readStoredRuntimeSettings — partial settings
// ---------------------------------------------------------------------------

test("fills defaults for missing keys when some are present", async () => {
  const store = createMockPreferenceStore({
    anthropic_api_key: "sk-partial",
    telegram_notification_level: "verbose"
  });
  const settings = await readStoredRuntimeSettings(store);

  assert.equal(settings.anthropicApiKey, "sk-partial");
  assert.equal(settings.plannerModel, DEFAULT_ANTHROPIC_MODEL);
  assert.equal(settings.telegramBotToken, "");
  assert.equal(settings.telegramChatId, "");
  assert.equal(settings.telegramNotificationLevel, "verbose");
  assert.deepEqual(settings.riskClassPolicies, {});
});

test("reads all 6 settings simultaneously", async () => {
  const policies = { financial: "always_ask" };
  const store = createMockPreferenceStore({
    anthropic_api_key: "sk-all",
    planner_model: "claude-haiku-4-5-20251001",
    telegram_bot_token: "tok-all",
    telegram_chat_id: "chat-all",
    telegram_notification_level: "verbose",
    risk_class_policies: JSON.stringify(policies)
  });
  const settings = await readStoredRuntimeSettings(store);

  assert.equal(settings.anthropicApiKey, "sk-all");
  assert.equal(settings.plannerModel, "claude-haiku-4-5-20251001");
  assert.equal(settings.telegramBotToken, "tok-all");
  assert.equal(settings.telegramChatId, "chat-all");
  assert.equal(settings.telegramNotificationLevel, "verbose");
  assert.deepEqual(settings.riskClassPolicies, policies);
});

// ---------------------------------------------------------------------------
// readStoredRuntimeSettings — return shape
// ---------------------------------------------------------------------------

test("returns exactly 6 keys", async () => {
  const store = createMockPreferenceStore();
  const settings = await readStoredRuntimeSettings(store);
  assert.equal(Object.keys(settings).length, 6);
  assert.ok("anthropicApiKey" in settings);
  assert.ok("plannerModel" in settings);
  assert.ok("telegramBotToken" in settings);
  assert.ok("telegramChatId" in settings);
  assert.ok("telegramNotificationLevel" in settings);
  assert.ok("riskClassPolicies" in settings);
});

test("concurrent reads with different stores return independent results", async () => {
  const storeA = createMockPreferenceStore({ anthropic_api_key: "key-A" });
  const storeB = createMockPreferenceStore({ anthropic_api_key: "key-B" });

  const [settingsA, settingsB] = await Promise.all([
    readStoredRuntimeSettings(storeA),
    readStoredRuntimeSettings(storeB)
  ]);

  assert.equal(settingsA.anthropicApiKey, "key-A");
  assert.equal(settingsB.anthropicApiKey, "key-B");
});

// ---------------------------------------------------------------------------
// validateRiskClassPolicies — shape validation
// ---------------------------------------------------------------------------

test("validateRiskClassPolicies returns {} for null", () => {
  assert.deepEqual(validateRiskClassPolicies(null), {});
});

test("validateRiskClassPolicies returns {} for number", () => {
  assert.deepEqual(validateRiskClassPolicies(42), {});
});

test("validateRiskClassPolicies returns {} for string", () => {
  assert.deepEqual(validateRiskClassPolicies("hello"), {});
});

test("validateRiskClassPolicies returns {} for array", () => {
  assert.deepEqual(validateRiskClassPolicies([1, 2, 3]), {});
});

test("validateRiskClassPolicies strips unknown keys", () => {
  assert.deepEqual(
    validateRiskClassPolicies({ bogus: "always_ask", financial: "always_ask" }),
    { financial: "always_ask" }
  );
});

test("validateRiskClassPolicies strips invalid policy values", () => {
  assert.deepEqual(
    validateRiskClassPolicies({ financial: "never", credential: "always_ask" }),
    { credential: "always_ask" }
  );
});

test("validateRiskClassPolicies strips non-string values", () => {
  assert.deepEqual(
    validateRiskClassPolicies({ financial: 123, navigation: "auto_approve" }),
    { navigation: "auto_approve" }
  );
});

test("validateRiskClassPolicies accepts all valid keys and values", () => {
  const input = {
    financial: "always_ask",
    credential: "auto_approve",
    destructive: "default",
    submission: "always_ask",
    navigation: "auto_approve",
    general: "default"
  };
  assert.deepEqual(validateRiskClassPolicies(input), input);
});

test("validateRiskClassPolicies returns {} for empty object", () => {
  assert.deepEqual(validateRiskClassPolicies({}), {});
});

// ---------------------------------------------------------------------------
// readStoredRuntimeSettings — riskClassPolicies validation integration
// ---------------------------------------------------------------------------

test("strips invalid keys from stored riskClassPolicies JSON", async () => {
  const store = createMockPreferenceStore({
    risk_class_policies: JSON.stringify({ financial: "always_ask", bogus: "default" })
  });
  const settings = await readStoredRuntimeSettings(store);
  assert.deepEqual(settings.riskClassPolicies, { financial: "always_ask" });
});

test("returns {} when stored riskClassPolicies is a JSON number", async () => {
  const store = createMockPreferenceStore({ risk_class_policies: "42" });
  const settings = await readStoredRuntimeSettings(store);
  assert.deepEqual(settings.riskClassPolicies, {});
});

test("returns {} when stored riskClassPolicies is a JSON array", async () => {
  const store = createMockPreferenceStore({ risk_class_policies: "[1,2,3]" });
  const settings = await readStoredRuntimeSettings(store);
  assert.deepEqual(settings.riskClassPolicies, {});
});
