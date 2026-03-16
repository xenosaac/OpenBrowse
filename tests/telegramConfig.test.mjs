import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { resolveTelegramConfig } from "../packages/chat-bridge/dist/TelegramConfig.js";

describe("resolveTelegramConfig", () => {
  const envKeys = [
    "OPENBROWSE_TELEGRAM_BOT_TOKEN",
    "OPENBROWSE_TELEGRAM_CHAT_ID",
    "OPENBROWSE_TELEGRAM_STATE_PATH",
    "OPENBROWSE_TELEGRAM_NOTIFY_LEVEL",
  ];
  const savedEnv = {};

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it("returns null when no botToken provided", () => {
    const result = resolveTelegramConfig();
    assert.equal(result, null);
  });

  it("returns null when overrides have no botToken and env is empty", () => {
    const result = resolveTelegramConfig({ chatId: "123" });
    assert.equal(result, null);
  });

  it("returns config when botToken provided via override", () => {
    const result = resolveTelegramConfig({ botToken: "tok_123" });
    assert.notEqual(result, null);
    assert.equal(result.botToken, "tok_123");
  });

  it("returns config when botToken provided via env", () => {
    process.env.OPENBROWSE_TELEGRAM_BOT_TOKEN = "env_tok";
    const result = resolveTelegramConfig();
    assert.notEqual(result, null);
    assert.equal(result.botToken, "env_tok");
  });

  it("override botToken takes precedence over env", () => {
    process.env.OPENBROWSE_TELEGRAM_BOT_TOKEN = "env_tok";
    const result = resolveTelegramConfig({ botToken: "override_tok" });
    assert.equal(result.botToken, "override_tok");
  });

  it("chatId from override takes precedence over env", () => {
    process.env.OPENBROWSE_TELEGRAM_CHAT_ID = "env_chat";
    const result = resolveTelegramConfig({ botToken: "tok", chatId: "over_chat" });
    assert.equal(result.chatId, "over_chat");
  });

  it("chatId from env when no override", () => {
    process.env.OPENBROWSE_TELEGRAM_CHAT_ID = "env_chat";
    const result = resolveTelegramConfig({ botToken: "tok" });
    assert.equal(result.chatId, "env_chat");
  });

  it("chatId is undefined when neither override nor env", () => {
    const result = resolveTelegramConfig({ botToken: "tok" });
    assert.equal(result.chatId, undefined);
  });

  it("statePath defaults to ./openbrowse-telegram-state.json", () => {
    const result = resolveTelegramConfig({ botToken: "tok" });
    assert.equal(result.statePath, "./openbrowse-telegram-state.json");
  });

  it("statePath from env", () => {
    process.env.OPENBROWSE_TELEGRAM_STATE_PATH = "/tmp/state.json";
    const result = resolveTelegramConfig({ botToken: "tok" });
    assert.equal(result.statePath, "/tmp/state.json");
  });

  it("statePath override takes precedence", () => {
    process.env.OPENBROWSE_TELEGRAM_STATE_PATH = "/tmp/state.json";
    const result = resolveTelegramConfig({ botToken: "tok", statePath: "/custom.json" });
    assert.equal(result.statePath, "/custom.json");
  });

  it("pairingMode defaults to claim-first-private-chat when no chatId", () => {
    const result = resolveTelegramConfig({ botToken: "tok" });
    assert.equal(result.pairingMode, "claim-first-private-chat");
  });

  it("pairingMode defaults to configured-only when chatId provided", () => {
    const result = resolveTelegramConfig({ botToken: "tok", chatId: "123" });
    assert.equal(result.pairingMode, "configured-only");
  });

  it("pairingMode override takes precedence", () => {
    const result = resolveTelegramConfig({
      botToken: "tok",
      chatId: "123",
      pairingMode: "claim-first-private-chat",
    });
    assert.equal(result.pairingMode, "claim-first-private-chat");
  });

  it("notificationLevel defaults to quiet", () => {
    const result = resolveTelegramConfig({ botToken: "tok" });
    assert.equal(result.notificationLevel, "quiet");
  });

  it("notificationLevel verbose from env", () => {
    process.env.OPENBROWSE_TELEGRAM_NOTIFY_LEVEL = "verbose";
    const result = resolveTelegramConfig({ botToken: "tok" });
    assert.equal(result.notificationLevel, "verbose");
  });

  it("notificationLevel non-verbose env defaults to quiet", () => {
    process.env.OPENBROWSE_TELEGRAM_NOTIFY_LEVEL = "anything_else";
    const result = resolveTelegramConfig({ botToken: "tok" });
    assert.equal(result.notificationLevel, "quiet");
  });

  it("notificationLevel override takes precedence over env", () => {
    process.env.OPENBROWSE_TELEGRAM_NOTIFY_LEVEL = "quiet";
    const result = resolveTelegramConfig({
      botToken: "tok",
      notificationLevel: "verbose",
    });
    assert.equal(result.notificationLevel, "verbose");
  });
});
