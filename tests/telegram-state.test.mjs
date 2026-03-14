import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { TelegramStateStore } from "../packages/chat-bridge/dist/index.js";

test("telegram state store persists approved chat and reply mapping", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "openbrowse-tg-state-"));
  const statePath = path.join(tempDir, "state.json");

  const store = new TelegramStateStore(statePath);
  await store.load();
  await store.approveChat("12345");
  await store.registerClarification({
    requestId: "clarify_1",
    runId: "run_1",
    chatId: "12345",
    messageId: 99,
    createdAt: "2026-03-11T10:00:00.000Z"
  });

  const reloaded = new TelegramStateStore(statePath);
  await reloaded.load();

  assert.equal(reloaded.getPrimaryChatId(), "12345");
  assert.equal(reloaded.hasApprovedChat("12345"), true);

  const runId = await reloaded.resolveByReplyTarget("12345", 99);
  assert.equal(runId, "run_1");

  const secondLookup = await reloaded.resolveByReplyTarget("12345", 99);
  assert.equal(secondLookup, null);
});
