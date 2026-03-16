import test from "node:test";
import assert from "node:assert/strict";

import { listAllRuns, queryShellTabs } from "../packages/runtime-core/dist/queries.js";

// --- Helpers ---

function makeRun(overrides = {}) {
  return {
    id: overrides.id ?? "run_1",
    taskIntentId: "intent_1",
    status: overrides.status ?? "running",
    goal: overrides.goal ?? "Test task",
    source: overrides.source ?? "desktop",
    constraints: [],
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
    checkpoint: {
      step: 1,
      browserSessionId: overrides.browserSessionId ?? "sess_1",
      lastKnownUrl: overrides.lastKnownUrl,
      summary: "",
      ...overrides.checkpoint,
    },
  };
}

function makeSession(overrides = {}) {
  return {
    id: overrides.id ?? "sess_1",
    runId: overrides.runId ?? "run_1",
    groupId: overrides.groupId ?? "run_1",
    profileId: overrides.profileId ?? "profile_default",
    tabId: overrides.tabId ?? "tab_1",
    taskLabel: overrides.taskLabel ?? "Test task",
    source: overrides.source ?? "desktop",
    status: overrides.status ?? "running",
    isBackground: overrides.isBackground ?? false,
    pageUrl: overrides.pageUrl ?? "https://example.com",
    state: overrides.state ?? "attached",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeServices(runs = [], sessions = []) {
  return {
    runCheckpointStore: {
      listAll: async () => [...runs],
    },
    browserKernel: {
      listSessions: async () => [...sessions],
    },
  };
}

// --- listAllRuns ---

test("listAllRuns: returns empty array when no runs", async () => {
  const services = makeServices();
  const result = await listAllRuns(services);
  assert.deepEqual(result, []);
});

test("listAllRuns: returns single run", async () => {
  const run = makeRun();
  const services = makeServices([run]);
  const result = await listAllRuns(services);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "run_1");
});

test("listAllRuns: sorts by updatedAt descending", async () => {
  const run1 = makeRun({ id: "run_old", updatedAt: "2026-01-01T00:00:00.000Z" });
  const run2 = makeRun({ id: "run_new", updatedAt: "2026-01-02T00:00:00.000Z" });
  const run3 = makeRun({ id: "run_mid", updatedAt: "2026-01-01T12:00:00.000Z" });
  const services = makeServices([run1, run2, run3]);

  const result = await listAllRuns(services);
  assert.deepEqual(result.map((r) => r.id), ["run_new", "run_mid", "run_old"]);
});

// --- queryShellTabs ---

test("queryShellTabs: returns empty when no runs", async () => {
  const services = makeServices([], []);
  const result = await queryShellTabs(services);
  assert.deepEqual(result, []);
});

test("queryShellTabs: returns empty when runs have no browserSessionId", async () => {
  const run = makeRun({ browserSessionId: undefined, checkpoint: { step: 1 } });
  const services = makeServices([run], []);
  const result = await queryShellTabs(services);
  assert.deepEqual(result, []);
});

test("queryShellTabs: returns empty when run has session id but no matching live session", async () => {
  const run = makeRun({ browserSessionId: "sess_orphan" });
  const services = makeServices([run], []);
  const result = await queryShellTabs(services);
  assert.deepEqual(result, []);
});

test("queryShellTabs: maps run + session into tab descriptor", async () => {
  const run = makeRun({
    id: "run_1",
    goal: "Book flight",
    source: "desktop",
    status: "running",
    browserSessionId: "sess_1",
  });
  const session = makeSession({
    id: "sess_1",
    runId: "run_1",
    profileId: "prof_1",
    pageUrl: "https://flights.example.com",
  });
  const services = makeServices([run], [session]);

  const result = await queryShellTabs(services);
  assert.equal(result.length, 1);
  const tab = result[0];
  assert.equal(tab.id, "sess_1");
  assert.equal(tab.runId, "run_1");
  assert.equal(tab.groupId, "run_1");
  assert.equal(tab.title, "Book flight");
  assert.equal(tab.url, "https://flights.example.com");
  assert.equal(tab.profileId, "prof_1");
  assert.equal(tab.source, "desktop");
  assert.equal(tab.status, "running");
  assert.equal(tab.isBackground, false);
  assert.equal(tab.closable, true);
});

test("queryShellTabs: isBackground is true for scheduler source", async () => {
  const run = makeRun({ id: "run_sched", source: "scheduler", browserSessionId: "sess_s" });
  const session = makeSession({ id: "sess_s", runId: "run_sched" });
  const services = makeServices([run], [session]);

  const result = await queryShellTabs(services);
  assert.equal(result[0].isBackground, true);
});

test("queryShellTabs: falls back to lastKnownUrl when session pageUrl is empty", async () => {
  const run = makeRun({ id: "run_1", browserSessionId: "sess_1", lastKnownUrl: "https://fallback.com" });
  const session = makeSession({ id: "sess_1", runId: "run_1", pageUrl: "" });
  const services = makeServices([run], [session]);

  const result = await queryShellTabs(services);
  assert.equal(result[0].url, "https://fallback.com");
});

test("queryShellTabs: falls back to about:blank when no URLs available", async () => {
  const run = makeRun({ id: "run_1", browserSessionId: "sess_1", lastKnownUrl: undefined, checkpoint: { step: 1, browserSessionId: "sess_1" } });
  const session = makeSession({ id: "sess_1", runId: "run_1", pageUrl: "" });
  const services = makeServices([run], [session]);

  const result = await queryShellTabs(services);
  assert.equal(result[0].url, "about:blank");
});

test("queryShellTabs: sorts tabs by updatedAt descending", async () => {
  const run1 = makeRun({ id: "run_old", updatedAt: "2026-01-01T00:00:00.000Z", browserSessionId: "sess_old" });
  const run2 = makeRun({ id: "run_new", updatedAt: "2026-01-02T00:00:00.000Z", browserSessionId: "sess_new" });
  const sess1 = makeSession({ id: "sess_old", runId: "run_old" });
  const sess2 = makeSession({ id: "sess_new", runId: "run_new" });
  const services = makeServices([run1, run2], [sess1, sess2]);

  const result = await queryShellTabs(services);
  assert.deepEqual(result.map((t) => t.runId), ["run_new", "run_old"]);
});

test("queryShellTabs: filters out runs without matching sessions", async () => {
  const run1 = makeRun({ id: "run_1", browserSessionId: "sess_1" });
  const run2 = makeRun({ id: "run_2", browserSessionId: "sess_2" });
  // Only session for run_1 exists
  const sess1 = makeSession({ id: "sess_1", runId: "run_1" });
  const services = makeServices([run1, run2], [sess1]);

  const result = await queryShellTabs(services);
  assert.equal(result.length, 1);
  assert.equal(result[0].runId, "run_1");
});
