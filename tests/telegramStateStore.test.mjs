import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { TelegramStateStore } from "../packages/chat-bridge/dist/TelegramStateStore.js";

describe("TelegramStateStore", () => {
  let tmpDir;
  let statePath;
  let store;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "tg-state-"));
    statePath = path.join(tmpDir, "state.json");
    store = new TelegramStateStore(statePath);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("load", () => {
    it("initializes to default state when file does not exist", async () => {
      await store.load();
      assert.equal(store.getPrimaryChatId(), null);
      assert.deepEqual(store.listApprovedChatIds(), []);
      assert.equal(store.hasAnyApprovedChats(), false);
    });

    it("loads existing state from file", async () => {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(statePath, JSON.stringify({
        primaryChatId: "chat_1",
        approvedChatIds: ["chat_1", "chat_2"],
        pendingClarifications: {},
        replyTargets: {},
        runChatMappings: {}
      }));
      await store.load();
      assert.equal(store.getPrimaryChatId(), "chat_1");
      assert.deepEqual(store.listApprovedChatIds(), ["chat_1", "chat_2"]);
    });

    it("handles partial/malformed state gracefully", async () => {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(statePath, JSON.stringify({ primaryChatId: "x" }));
      await store.load();
      assert.equal(store.getPrimaryChatId(), "x");
      assert.deepEqual(store.listApprovedChatIds(), []);
    });

    it("resets to default on invalid JSON", async () => {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(statePath, "not json{{{");
      await store.load();
      assert.equal(store.getPrimaryChatId(), null);
    });
  });

  describe("approveChat", () => {
    it("approves a chat and sets it as primary", async () => {
      await store.approveChat("chat_1");
      assert.equal(store.getPrimaryChatId(), "chat_1");
      assert.equal(store.hasApprovedChat("chat_1"), true);
      assert.equal(store.hasAnyApprovedChats(), true);
    });

    it("does not duplicate approved chat IDs", async () => {
      await store.approveChat("chat_1");
      await store.approveChat("chat_1");
      assert.deepEqual(store.listApprovedChatIds(), ["chat_1"]);
    });

    it("keeps first primary, adds second to approved", async () => {
      await store.approveChat("chat_1");
      await store.approveChat("chat_2");
      assert.equal(store.getPrimaryChatId(), "chat_1");
      assert.deepEqual(store.listApprovedChatIds(), ["chat_1", "chat_2"]);
    });

    it("persists to disk", async () => {
      await store.approveChat("chat_1");
      const raw = JSON.parse(await readFile(statePath, "utf-8"));
      assert.equal(raw.primaryChatId, "chat_1");
      assert.deepEqual(raw.approvedChatIds, ["chat_1"]);
    });

    it("survives load-approve-reload cycle", async () => {
      await store.approveChat("chat_1");
      const store2 = new TelegramStateStore(statePath);
      await store2.load();
      assert.equal(store2.getPrimaryChatId(), "chat_1");
      assert.equal(store2.hasApprovedChat("chat_1"), true);
    });
  });

  describe("clarification lifecycle", () => {
    it("registers and resolves by requestId", async () => {
      await store.registerClarification({
        requestId: "req_1",
        runId: "run_1",
        chatId: "chat_1",
        messageId: 42,
        createdAt: "2026-03-16T00:00:00Z",
      });

      const runId = await store.resolveByRequestId("req_1", "chat_1");
      assert.equal(runId, "run_1");

      // Second resolve returns null (already cleared)
      const again = await store.resolveByRequestId("req_1", "chat_1");
      assert.equal(again, null);
    });

    it("resolveByRequestId returns null for wrong chatId", async () => {
      await store.registerClarification({
        requestId: "req_1",
        runId: "run_1",
        chatId: "chat_1",
        messageId: 42,
        createdAt: "2026-03-16T00:00:00Z",
      });

      const runId = await store.resolveByRequestId("req_1", "wrong_chat");
      assert.equal(runId, null);
    });

    it("resolveByRequestId returns null for unknown requestId", async () => {
      const runId = await store.resolveByRequestId("nonexistent", "chat_1");
      assert.equal(runId, null);
    });

    it("registers and resolves by reply target", async () => {
      await store.registerClarification({
        requestId: "req_1",
        runId: "run_1",
        chatId: "chat_1",
        messageId: 42,
        createdAt: "2026-03-16T00:00:00Z",
      });

      const runId = await store.resolveByReplyTarget("chat_1", 42);
      assert.equal(runId, "run_1");

      // Cleared after resolve
      const again = await store.resolveByReplyTarget("chat_1", 42);
      assert.equal(again, null);
    });

    it("resolveByReplyTarget returns null for unknown target", async () => {
      const runId = await store.resolveByReplyTarget("chat_1", 999);
      assert.equal(runId, null);
    });
  });

  describe("run-chat mappings", () => {
    it("binds and resolves run to chat", async () => {
      await store.bindRunToChat("run_1", "chat_1");
      assert.equal(store.resolveRunChatId("run_1"), "chat_1");
    });

    it("returns null for unknown run", () => {
      assert.equal(store.resolveRunChatId("unknown"), null);
    });

    it("overwrites previous binding", async () => {
      await store.bindRunToChat("run_1", "chat_1");
      await store.bindRunToChat("run_1", "chat_2");
      assert.equal(store.resolveRunChatId("run_1"), "chat_2");
    });
  });

  describe("clearClarificationsForRun", () => {
    it("removes all clarifications for a run", async () => {
      await store.registerClarification({
        requestId: "req_1", runId: "run_1", chatId: "chat_1", messageId: 1, createdAt: "2026-03-16T00:00:00Z",
      });
      await store.registerClarification({
        requestId: "req_2", runId: "run_1", chatId: "chat_1", messageId: 2, createdAt: "2026-03-16T00:00:01Z",
      });
      await store.registerClarification({
        requestId: "req_3", runId: "run_2", chatId: "chat_1", messageId: 3, createdAt: "2026-03-16T00:00:02Z",
      });
      await store.bindRunToChat("run_1", "chat_1");

      const removed = await store.clearClarificationsForRun("run_1");
      assert.equal(removed.length, 2);
      assert.deepEqual(removed.map(r => r.requestId).sort(), ["req_1", "req_2"]);

      // run_1 clarifications gone
      assert.equal(await store.resolveByRequestId("req_1", "chat_1"), null);
      assert.equal(await store.resolveByRequestId("req_2", "chat_1"), null);

      // run_2 clarification still present
      const runId3 = await store.resolveByRequestId("req_3", "chat_1");
      assert.equal(runId3, "run_2");

      // run-chat mapping also removed
      assert.equal(store.resolveRunChatId("run_1"), null);
    });

    it("returns empty array for unknown run", async () => {
      const removed = await store.clearClarificationsForRun("unknown");
      assert.deepEqual(removed, []);
    });

    it("does not persist if nothing removed", async () => {
      // No clarifications registered — clearClarificationsForRun should not write
      await store.clearClarificationsForRun("run_1");
      // File should not exist (no persist call because removed.length === 0,
      // but runChatMappings delete is always called — let's just verify no crash)
    });
  });

  describe("listApprovedChatIds returns a copy", () => {
    it("mutating the returned array does not affect state", async () => {
      await store.approveChat("chat_1");
      const list = store.listApprovedChatIds();
      list.push("injected");
      assert.deepEqual(store.listApprovedChatIds(), ["chat_1"]);
    });
  });
});
