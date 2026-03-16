import test from "node:test";
import assert from "node:assert/strict";

import { createPlanner, createChatBridge } from "../packages/runtime-core/dist/factories.js";
import { StubPlannerGateway } from "../packages/planner/dist/PlannerGateway.js";
import { ClaudePlannerGateway } from "../packages/planner/dist/ClaudePlannerGateway.js";
import { StubChatBridge } from "../packages/chat-bridge/dist/ChatBridge.js";
import { TelegramChatBridge } from "../packages/chat-bridge/dist/TelegramChatBridge.js";
import { createDefaultRuntimeSettings, DEFAULT_ANTHROPIC_MODEL } from "../packages/contracts/dist/runtime.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSettings(overrides = {}) {
  return { ...createDefaultRuntimeSettings(), ...overrides };
}

// ---------------------------------------------------------------------------
// createPlanner
// ---------------------------------------------------------------------------

test("createPlanner: returns StubPlannerGateway when enableModelPlanner=false and no API key", () => {
  const result = createPlanner(false, makeSettings());
  assert.ok(result.planner instanceof StubPlannerGateway);
  assert.equal(result.descriptor.mode, "stub");
  assert.match(result.descriptor.detail, /no Anthropic API key/);
});

test("createPlanner: returns StubPlannerGateway when enableModelPlanner=false even with API key", () => {
  const result = createPlanner(false, makeSettings({ anthropicApiKey: "sk-test-key" }));
  assert.ok(result.planner instanceof StubPlannerGateway);
  assert.equal(result.descriptor.mode, "stub");
  assert.match(result.descriptor.detail, /available but currently disabled/);
});

test("createPlanner: returns ClaudePlannerGateway when enabled with API key in settings", () => {
  const result = createPlanner(true, makeSettings({ anthropicApiKey: "sk-test-key" }));
  assert.ok(result.planner instanceof ClaudePlannerGateway);
  assert.equal(result.descriptor.mode, "live");
  assert.match(result.descriptor.detail, /Anthropic-backed planner/);
});

test("createPlanner: uses custom model from settings", () => {
  const result = createPlanner(true, makeSettings({
    anthropicApiKey: "sk-test-key",
    plannerModel: "claude-haiku-4-5-20251001"
  }));
  assert.ok(result.planner instanceof ClaudePlannerGateway);
  assert.match(result.descriptor.detail, /claude-haiku-4-5-20251001/);
});

test("createPlanner: uses DEFAULT_ANTHROPIC_MODEL when plannerModel is empty", () => {
  const result = createPlanner(true, makeSettings({
    anthropicApiKey: "sk-test-key",
    plannerModel: ""
  }));
  assert.ok(result.planner instanceof ClaudePlannerGateway);
  assert.match(result.descriptor.detail, new RegExp(DEFAULT_ANTHROPIC_MODEL));
});

test("createPlanner: falls back to process.env.ANTHROPIC_API_KEY", () => {
  const original = process.env.ANTHROPIC_API_KEY;
  try {
    process.env.ANTHROPIC_API_KEY = "sk-env-key";
    const result = createPlanner(true, makeSettings({ anthropicApiKey: "" }));
    assert.ok(result.planner instanceof ClaudePlannerGateway);
    assert.equal(result.descriptor.mode, "live");
  } finally {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  }
});

test("createPlanner: returns stub when enabled but no API key anywhere", () => {
  const original = process.env.ANTHROPIC_API_KEY;
  try {
    delete process.env.ANTHROPIC_API_KEY;
    const result = createPlanner(true, makeSettings({ anthropicApiKey: "" }));
    assert.ok(result.planner instanceof StubPlannerGateway);
    assert.equal(result.descriptor.mode, "stub");
    assert.match(result.descriptor.detail, /no Anthropic API key/);
  } finally {
    if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
  }
});

test("createPlanner: trims whitespace from API key", () => {
  const result = createPlanner(true, makeSettings({ anthropicApiKey: "  sk-test-key  " }));
  assert.ok(result.planner instanceof ClaudePlannerGateway);
});

test("createPlanner: whitespace-only API key treated as empty", () => {
  const original = process.env.ANTHROPIC_API_KEY;
  try {
    delete process.env.ANTHROPIC_API_KEY;
    const result = createPlanner(true, makeSettings({ anthropicApiKey: "   " }));
    assert.ok(result.planner instanceof StubPlannerGateway);
  } finally {
    if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
  }
});

test("createPlanner: trims whitespace from model name", () => {
  const result = createPlanner(true, makeSettings({
    anthropicApiKey: "sk-test-key",
    plannerModel: "  claude-haiku-4-5-20251001  "
  }));
  assert.match(result.descriptor.detail, /claude-haiku-4-5-20251001/);
});

// ---------------------------------------------------------------------------
// createChatBridge
// ---------------------------------------------------------------------------

test("createChatBridge: returns StubChatBridge when enableRemoteChat=false", () => {
  const result = createChatBridge(false, "/tmp/state.json", makeSettings({
    telegramBotToken: "123:ABC"
  }));
  assert.ok(result.chatBridge instanceof StubChatBridge);
  assert.equal(result.descriptor.mode, "stub");
  assert.match(result.descriptor.detail, /disabled for this runtime/);
  assert.equal(result.chatBridgeInit, undefined);
});

test("createChatBridge: returns StubChatBridge when enabled but no bot token", () => {
  const result = createChatBridge(true, "/tmp/state.json", makeSettings({
    telegramBotToken: ""
  }));
  assert.ok(result.chatBridge instanceof StubChatBridge);
  assert.equal(result.descriptor.mode, "stub");
  assert.match(result.descriptor.detail, /bot token is not configured/);
});

test("createChatBridge: returns TelegramChatBridge when enabled with bot token", () => {
  const result = createChatBridge(true, "/tmp/state.json", makeSettings({
    telegramBotToken: "123:ABC"
  }));
  assert.ok(result.chatBridge instanceof TelegramChatBridge);
  assert.equal(result.descriptor.mode, "live");
  assert.match(result.descriptor.detail, /first-private-chat pairing/);
  assert.equal(typeof result.chatBridgeInit, "function");
});

test("createChatBridge: with chatId shows locked-to-chat message", () => {
  const result = createChatBridge(true, "/tmp/state.json", makeSettings({
    telegramBotToken: "123:ABC",
    telegramChatId: "456789"
  }));
  assert.ok(result.chatBridge instanceof TelegramChatBridge);
  assert.match(result.descriptor.detail, /locked to the configured chat/);
});

test("createChatBridge: without chatId shows pairing mode", () => {
  const result = createChatBridge(true, "/tmp/state.json", makeSettings({
    telegramBotToken: "123:ABC",
    telegramChatId: ""
  }));
  assert.ok(result.chatBridge instanceof TelegramChatBridge);
  assert.match(result.descriptor.detail, /first-private-chat pairing/);
});

test("createChatBridge: trims whitespace from bot token", () => {
  const result = createChatBridge(true, "/tmp/state.json", makeSettings({
    telegramBotToken: "  123:ABC  "
  }));
  assert.ok(result.chatBridge instanceof TelegramChatBridge);
});

test("createChatBridge: whitespace-only bot token treated as empty", () => {
  const result = createChatBridge(true, "/tmp/state.json", makeSettings({
    telegramBotToken: "   "
  }));
  assert.ok(result.chatBridge instanceof StubChatBridge);
});

test("createChatBridge: trims whitespace from chatId", () => {
  const result = createChatBridge(true, "/tmp/state.json", makeSettings({
    telegramBotToken: "123:ABC",
    telegramChatId: "  456  "
  }));
  assert.match(result.descriptor.detail, /locked to the configured chat/);
});

test("createChatBridge: chatBridgeInit is a callable function", () => {
  const result = createChatBridge(true, "/tmp/state.json", makeSettings({
    telegramBotToken: "123:ABC"
  }));
  // chatBridgeInit should be a function that returns a Promise
  assert.equal(typeof result.chatBridgeInit, "function");
});

test("createChatBridge: stub result has no chatBridgeInit", () => {
  const result = createChatBridge(false, "/tmp/state.json", makeSettings());
  assert.equal(result.chatBridgeInit, undefined);
});
