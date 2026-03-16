import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { TelegramChatBridge } = await import(
  "../packages/chat-bridge/dist/TelegramChatBridge.js"
);

/**
 * Creates a TelegramChatBridge with a fake bot token and temp state directory.
 * Monkey-patches bot.api methods so no network calls are made.
 * Returns the bridge, a log of API calls, and a cleanup function.
 */
function createTestBridge(configOverrides = {}) {
  const tmpDir = mkdtempSync(join(tmpdir(), "tg-bridge-test-"));
  const statePath = join(tmpDir, "state.json");

  const config = {
    botToken: "fake:token",
    statePath,
    notificationLevel: "quiet",
    pairingMode: "claim-first-private-chat",
    ...configOverrides,
  };

  const bridge = new TelegramChatBridge(config);
  const apiCalls = [];

  // Monkey-patch bot.api to capture all calls without network
  bridge.bot.api.sendMessage = async (chatId, text, options) => {
    const call = { method: "sendMessage", chatId, text, options };
    apiCalls.push(call);
    return { message_id: apiCalls.length * 100 };
  };

  bridge.bot.api.editMessageReplyMarkup = async (chatId, messageId, options) => {
    apiCalls.push({ method: "editMessageReplyMarkup", chatId, messageId, options });
    return {};
  };

  bridge.bot.api.setMyCommands = async (commands) => {
    apiCalls.push({ method: "setMyCommands", commands });
    return true;
  };

  // Prevent actual polling
  bridge.bot.start = () => {};
  bridge.bot.stop = async () => {};

  const cleanup = () => {
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  };

  return { bridge, apiCalls, config, cleanup };
}

describe("TelegramChatBridge", () => {
  // ── shouldSendStepProgress ────────────────────────────────────────────────
  describe("shouldSendStepProgress", () => {
    it("returns true when notificationLevel is verbose", () => {
      const { bridge, cleanup } = createTestBridge({ notificationLevel: "verbose" });
      assert.equal(bridge.shouldSendStepProgress(), true);
      cleanup();
    });

    it("returns false when notificationLevel is quiet", () => {
      const { bridge, cleanup } = createTestBridge({ notificationLevel: "quiet" });
      assert.equal(bridge.shouldSendStepProgress(), false);
      cleanup();
    });

    it("returns false when notificationLevel is undefined", () => {
      const { bridge, cleanup } = createTestBridge({ notificationLevel: undefined });
      assert.equal(bridge.shouldSendStepProgress(), false);
      cleanup();
    });
  });

  // ── normalizeInbound ──────────────────────────────────────────────────────
  describe("normalizeInbound", () => {
    it("returns the same message unchanged", async () => {
      const { bridge, cleanup } = createTestBridge();
      const msg = { id: "m1", channel: "telegram", text: "hello", createdAt: "2026-03-16" };
      const result = await bridge.normalizeInbound(msg);
      assert.deepStrictEqual(result, msg);
      cleanup();
    });
  });

  // ── start / stop ──────────────────────────────────────────────────────────
  describe("start", () => {
    it("registers commands and starts bot", async () => {
      const { bridge, apiCalls, cleanup } = createTestBridge();
      await bridge.start();
      const setCmd = apiCalls.find(c => c.method === "setMyCommands");
      assert.ok(setCmd, "setMyCommands should be called");
      assert.equal(setCmd.commands.length, 4);
      assert.equal(bridge.started, true);
      cleanup();
    });

    it("is idempotent — second call is no-op", async () => {
      const { bridge, apiCalls, cleanup } = createTestBridge();
      await bridge.start();
      const callCount1 = apiCalls.length;
      await bridge.start();
      assert.equal(apiCalls.length, callCount1, "no new API calls on second start");
      cleanup();
    });

    it("auto-approves config.chatId on start", async () => {
      const { bridge, cleanup } = createTestBridge({ chatId: "12345" });
      await bridge.start();
      assert.equal(bridge.stateStore.hasApprovedChat("12345"), true);
      cleanup();
    });

    it("handles setMyCommands failure gracefully", async () => {
      const { bridge, cleanup } = createTestBridge();
      bridge.bot.api.setMyCommands = async () => { throw new Error("network"); };
      // Should not throw
      await bridge.start();
      assert.equal(bridge.started, true);
      cleanup();
    });
  });

  describe("stop", () => {
    it("no-op when not started", async () => {
      const { bridge, cleanup } = createTestBridge();
      await bridge.stop(); // should not throw
      assert.equal(bridge.started, false);
      cleanup();
    });

    it("clears started flag", async () => {
      const { bridge, cleanup } = createTestBridge();
      await bridge.start();
      assert.equal(bridge.started, true);
      await bridge.stop();
      assert.equal(bridge.started, false);
      cleanup();
    });
  });

  // ── send ──────────────────────────────────────────────────────────────────
  describe("send", () => {
    it("sends to config.chatId when no run binding", async () => {
      const { bridge, apiCalls, cleanup } = createTestBridge({ chatId: "555" });
      await bridge.start();
      await bridge.send({ channel: "telegram", runId: "run1", text: "hello" });
      assert.equal(apiCalls.filter(c => c.method === "sendMessage").length, 1);
      const msg = apiCalls.find(c => c.method === "sendMessage" && c.text === "hello");
      assert.equal(msg.chatId, "555");
      cleanup();
    });

    it("sends to run-bound chatId over config.chatId", async () => {
      const { bridge, apiCalls, cleanup } = createTestBridge({ chatId: "555" });
      await bridge.start();
      await bridge.bindRunToChat("run1", "999");
      await bridge.send({ channel: "telegram", runId: "run1", text: "hi" });
      const msg = apiCalls.find(c => c.method === "sendMessage" && c.text === "hi");
      assert.equal(msg.chatId, "999");
      cleanup();
    });

    it("sends to primary approved chat when no config.chatId and no run binding", async () => {
      const { bridge, apiCalls, cleanup } = createTestBridge({ chatId: undefined });
      await bridge.start();
      // Manually approve a chat
      await bridge.stateStore.approveChat("777");
      await bridge.send({ channel: "telegram", runId: "run1", text: "msg" });
      const msg = apiCalls.find(c => c.method === "sendMessage" && c.text === "msg");
      assert.equal(msg.chatId, "777");
      cleanup();
    });

    it("silently returns when no chatId can be resolved", async () => {
      const { bridge, apiCalls, cleanup } = createTestBridge({ chatId: undefined });
      await bridge.start();
      await bridge.send({ channel: "telegram", runId: "run1", text: "msg" });
      const msgs = apiCalls.filter(c => c.method === "sendMessage");
      assert.equal(msgs.length, 0, "no sendMessage when no chatId");
      cleanup();
    });

    it("swallows send errors", async () => {
      const { bridge, cleanup } = createTestBridge({ chatId: "555" });
      await bridge.start();
      bridge.bot.api.sendMessage = async () => { throw new Error("fail"); };
      // Should not throw
      await bridge.send({ channel: "telegram", runId: "run1", text: "hi" });
      cleanup();
    });

    it("splits long messages at line boundaries", async () => {
      const { bridge, apiCalls, cleanup } = createTestBridge({ chatId: "555" });
      await bridge.start();
      // Create a text > 4000 chars with line breaks
      const line = "A".repeat(1500) + "\n";
      const text = line + line + line; // 4503 chars
      await bridge.send({ channel: "telegram", runId: "run1", text });
      const msgs = apiCalls.filter(c => c.method === "sendMessage");
      assert.ok(msgs.length >= 2, `should split into 2+ messages, got ${msgs.length}`);
      // Reassembled text should match original
      const reassembled = msgs.map(m => m.text).join("\n");
      assert.equal(reassembled, text);
      cleanup();
    });

    it("sends short message as single call", async () => {
      const { bridge, apiCalls, cleanup } = createTestBridge({ chatId: "555" });
      await bridge.start();
      await bridge.send({ channel: "telegram", runId: "r1", text: "short" });
      const msgs = apiCalls.filter(c => c.method === "sendMessage");
      assert.equal(msgs.length, 1);
      cleanup();
    });
  });

  // ── sendClarification ─────────────────────────────────────────────────────
  describe("sendClarification", () => {
    it("sends markdown with inline keyboard and registers clarification", async () => {
      const { bridge, apiCalls, cleanup } = createTestBridge({ chatId: "555" });
      await bridge.start();

      await bridge.sendClarification({
        id: "clar1",
        runId: "run1",
        question: "Which date?",
        contextSummary: "Booking a flight",
        options: [
          { id: "opt1", label: "March 20" },
          { id: "opt2", label: "March 25" },
        ],
        createdAt: "2026-03-16T00:00:00Z",
      });

      const msg = apiCalls.find(c => c.method === "sendMessage");
      assert.ok(msg, "sendMessage called");
      assert.ok(msg.text.includes("clarification"), "text mentions clarification");
      assert.ok(msg.text.includes("Which date?"), "text includes question");
      assert.ok(msg.text.includes("run1"), "text includes runId");
      assert.equal(msg.options.parse_mode, "Markdown");
      assert.ok(msg.options.reply_markup, "keyboard present");

      // Verify clarification was registered in state store
      const resolved = await bridge.stateStore.resolveByRequestId("clar1", "555");
      assert.equal(resolved, "run1");
      cleanup();
    });

    it("sends without keyboard when no options", async () => {
      const { bridge, apiCalls, cleanup } = createTestBridge({ chatId: "555" });
      await bridge.start();

      await bridge.sendClarification({
        id: "clar2",
        runId: "run2",
        question: "What URL?",
        contextSummary: "Checking prices",
        options: [],
        createdAt: "2026-03-16T00:00:00Z",
      });

      const msg = apiCalls.find(c => c.method === "sendMessage");
      assert.equal(msg.options.reply_markup, undefined, "no keyboard when no options");
      cleanup();
    });

    it("falls back to plain text on markdown error", async () => {
      const { bridge, apiCalls, cleanup } = createTestBridge({ chatId: "555" });
      await bridge.start();

      let callCount = 0;
      bridge.bot.api.sendMessage = async (chatId, text, options) => {
        callCount++;
        if (callCount === 1) throw new Error("Markdown parse failed");
        apiCalls.push({ method: "sendMessage", chatId, text, options });
        return { message_id: 200 };
      };

      await bridge.sendClarification({
        id: "clar3",
        runId: "run3",
        question: "Which date?",
        contextSummary: "test",
        options: [],
        createdAt: "2026-03-16T00:00:00Z",
      });

      const fallback = apiCalls.find(c => c.method === "sendMessage");
      assert.ok(fallback, "fallback plain text sent");
      assert.ok(!fallback.options?.parse_mode, "no parse_mode on fallback");
      assert.ok(fallback.text.includes("Which date?"), "fallback includes question");
      cleanup();
    });

    it("silently fails when both markdown and fallback fail", async () => {
      const { bridge, cleanup } = createTestBridge({ chatId: "555" });
      await bridge.start();
      bridge.bot.api.sendMessage = async () => { throw new Error("always fail"); };

      // Should not throw
      await bridge.sendClarification({
        id: "clar4",
        runId: "run4",
        question: "Q?",
        contextSummary: "ctx",
        options: [],
        createdAt: "2026-03-16T00:00:00Z",
      });
      cleanup();
    });

    it("escapes Markdown special characters in context", async () => {
      const { bridge, apiCalls, cleanup } = createTestBridge({ chatId: "555" });
      await bridge.start();

      await bridge.sendClarification({
        id: "clar5",
        runId: "run5",
        question: "Q?",
        contextSummary: "price_range [100-200]",
        options: [],
        createdAt: "2026-03-16T00:00:00Z",
      });

      const msg = apiCalls.find(c => c.method === "sendMessage");
      // _ [ ] - should be escaped
      assert.ok(msg.text.includes("price\\_range"), "underscore escaped");
      assert.ok(msg.text.includes("\\["), "bracket escaped");
      cleanup();
    });

    it("silently returns when no chatId resolved", async () => {
      const { bridge, apiCalls, cleanup } = createTestBridge({ chatId: undefined });
      await bridge.start();

      await bridge.sendClarification({
        id: "clar6",
        runId: "run6",
        question: "Q?",
        contextSummary: "",
        options: [],
        createdAt: "2026-03-16T00:00:00Z",
      });

      assert.equal(apiCalls.filter(c => c.method === "sendMessage").length, 0);
      cleanup();
    });
  });

  // ── bindRunToChat ─────────────────────────────────────────────────────────
  describe("bindRunToChat", () => {
    it("delegates to stateStore", async () => {
      const { bridge, cleanup } = createTestBridge();
      await bridge.stateStore.load();
      await bridge.bindRunToChat("run1", "chat1");
      assert.equal(bridge.stateStore.resolveRunChatId("run1"), "chat1");
      cleanup();
    });
  });

  // ── clearRunState ─────────────────────────────────────────────────────────
  describe("clearRunState", () => {
    it("removes stale clarifications and edits keyboard", async () => {
      const { bridge, apiCalls, cleanup } = createTestBridge({ chatId: "555" });
      await bridge.start();

      // Register a clarification first
      await bridge.sendClarification({
        id: "clar-clear",
        runId: "run-clear",
        question: "Q?",
        contextSummary: "",
        options: [{ id: "o1", label: "A" }],
        createdAt: "2026-03-16T00:00:00Z",
      });

      const sendCall = apiCalls.find(c => c.method === "sendMessage");
      assert.ok(sendCall, "clarification sent");

      await bridge.clearRunState("run-clear");

      const editCall = apiCalls.find(c => c.method === "editMessageReplyMarkup");
      assert.ok(editCall, "editMessageReplyMarkup called");
      assert.equal(editCall.chatId, "555");
      assert.deepStrictEqual(editCall.options.reply_markup, undefined);
      cleanup();
    });

    it("no-op for unknown runId", async () => {
      const { bridge, apiCalls, cleanup } = createTestBridge({ chatId: "555" });
      await bridge.start();
      await bridge.clearRunState("unknown");
      assert.equal(apiCalls.filter(c => c.method === "editMessageReplyMarkup").length, 0);
      cleanup();
    });

    it("swallows editMessageReplyMarkup errors", async () => {
      const { bridge, apiCalls, cleanup } = createTestBridge({ chatId: "555" });
      await bridge.start();

      await bridge.sendClarification({
        id: "clar-err",
        runId: "run-err",
        question: "Q?",
        contextSummary: "",
        options: [{ id: "o1", label: "A" }],
        createdAt: "2026-03-16T00:00:00Z",
      });

      bridge.bot.api.editMessageReplyMarkup = async () => { throw new Error("expired"); };

      // Should not throw
      await bridge.clearRunState("run-err");
      cleanup();
    });
  });

  // ── setInboundHandler / setCommandHandler ─────────────────────────────────
  describe("setInboundHandler", () => {
    it("stores the handler", () => {
      const { bridge, cleanup } = createTestBridge();
      const handler = async () => {};
      bridge.setInboundHandler(handler);
      assert.equal(bridge.onInbound, handler);
      cleanup();
    });
  });

  describe("setCommandHandler", () => {
    it("stores the handler", () => {
      const { bridge, cleanup } = createTestBridge();
      const handler = async () => {};
      bridge.setCommandHandler(handler);
      assert.equal(bridge.commandHandler, handler);
      cleanup();
    });
  });

  // ── resolveOutboundChatId (tested via send) ───────────────────────────────
  describe("resolveOutboundChatId priority", () => {
    it("run binding > config.chatId > primary approved", async () => {
      const { bridge, apiCalls, cleanup } = createTestBridge({ chatId: "config-chat" });
      await bridge.start();
      await bridge.stateStore.approveChat("primary-chat");
      await bridge.bindRunToChat("run1", "run-chat");

      // Send with runId that has a binding → should use run-chat
      await bridge.send({ channel: "telegram", runId: "run1", text: "1" });
      assert.equal(apiCalls.at(-1).chatId, "run-chat");

      // Send with unknown runId → should use config.chatId
      await bridge.send({ channel: "telegram", runId: "run-unknown", text: "2" });
      assert.equal(apiCalls.at(-1).chatId, "config-chat");
      cleanup();
    });
  });
});
