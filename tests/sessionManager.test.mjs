import test from "node:test";
import assert from "node:assert/strict";

import { SessionManager } from "../packages/runtime-core/dist/SessionManager.js";

// --- Helpers ---

let sessionCounter = 0;

function makeBrowserKernel(overrides = {}) {
  const createdSessions = [];
  const destroyedSessions = [];
  const sessionsMap = overrides.sessionsMap ?? {};

  return {
    createdSessions,
    destroyedSessions,
    kernel: {
      getSession: async (id) => sessionsMap[id] ?? null,
      ensureProfile: async (profileId) => ({ id: profileId, name: profileId, dataDir: `/tmp/${profileId}` }),
      attachSession: async (profile, opts) => {
        const session = {
          id: overrides.nextSessionId ?? `session_${++sessionCounter}`,
          profileId: profile.id,
          state: "attached",
          ...opts,
        };
        createdSessions.push(session);
        return session;
      },
      destroySession: async (id) => {
        destroyedSessions.push(id);
        if (overrides.destroyThrows) throw new Error("already gone");
      },
    },
  };
}

function makeRun(overrides = {}) {
  return {
    id: overrides.id ?? "run_1",
    taskIntentId: "intent_1",
    status: overrides.status ?? "running",
    goal: overrides.goal ?? "Test task",
    source: overrides.source ?? "desktop",
    profileId: overrides.profileId ?? "default",
    constraints: [],
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    checkpoint: {
      step: 1,
      browserSessionId: overrides.browserSessionId ?? null,
      summary: "",
      ...overrides.checkpoint,
    },
  };
}

// --- sessionIdsForRun ---

test("sessionIdsForRun returns empty array for unknown run", () => {
  const { kernel } = makeBrowserKernel();
  const sm = new SessionManager(kernel);

  assert.deepEqual(sm.sessionIdsForRun("unknown"), []);
});

// --- attachForRun — new session ---

test("attachForRun creates new session", async () => {
  const { kernel, createdSessions } = makeBrowserKernel();
  const sm = new SessionManager(kernel);
  const run = makeRun();

  const result = await sm.attachForRun(run);

  assert.equal(createdSessions.length, 1);
  assert.equal(result.profileId, "default");
  assert.equal(result.session.state, "attached");
  assert.deepEqual(sm.sessionIdsForRun("run_1"), [result.session.id]);
});

test("attachForRun passes correct metadata to attachSession", async () => {
  const { kernel, createdSessions } = makeBrowserKernel();
  const sm = new SessionManager(kernel);
  const run = makeRun({ goal: "Search for flights", source: "telegram" });

  await sm.attachForRun(run);

  const session = createdSessions[0];
  assert.equal(session.runId, "run_1");
  assert.equal(session.taskLabel, "Search for flights");
  assert.equal(session.source, "telegram");
  assert.equal(session.isBackground, true); // source !== "desktop"
});

test("attachForRun isBackground false for desktop source", async () => {
  const { kernel, createdSessions } = makeBrowserKernel();
  const sm = new SessionManager(kernel);
  const run = makeRun({ source: "desktop" });

  await sm.attachForRun(run);

  assert.equal(createdSessions[0].isBackground, false);
});

// --- attachForRun — reuse ---

test("attachForRun reuses active session when reuse=true", async () => {
  const activeSession = { id: "sess_existing", state: "attached", profileId: "default" };
  const { kernel, createdSessions } = makeBrowserKernel({
    sessionsMap: { sess_existing: activeSession },
  });
  const sm = new SessionManager(kernel);
  const run = makeRun({ checkpoint: { browserSessionId: "sess_existing" } });

  const result = await sm.attachForRun(run, { reuse: true });

  assert.equal(result.session.id, "sess_existing");
  assert.equal(result.profileId, "default");
  assert.equal(createdSessions.length, 0); // No new session created
  assert.deepEqual(sm.sessionIdsForRun("run_1"), ["sess_existing"]);
});

test("attachForRun creates new when reuse=true but session terminated", async () => {
  const terminatedSession = { id: "sess_old", state: "terminated", profileId: "default" };
  const { kernel, createdSessions } = makeBrowserKernel({
    sessionsMap: { sess_old: terminatedSession },
  });
  const sm = new SessionManager(kernel);
  const run = makeRun({ checkpoint: { browserSessionId: "sess_old" } });

  const result = await sm.attachForRun(run, { reuse: true });

  assert.equal(createdSessions.length, 1);
  assert.notEqual(result.session.id, "sess_old");
});

test("attachForRun creates new when reuse=true but no browserSessionId", async () => {
  const { kernel, createdSessions } = makeBrowserKernel();
  const sm = new SessionManager(kernel);
  const run = makeRun();

  const result = await sm.attachForRun(run, { reuse: true });

  assert.equal(createdSessions.length, 1);
});

test("attachForRun creates new when reuse=false even if session exists", async () => {
  const activeSession = { id: "sess_existing", state: "attached", profileId: "default" };
  const { kernel, createdSessions } = makeBrowserKernel({
    sessionsMap: { sess_existing: activeSession },
  });
  const sm = new SessionManager(kernel);
  const run = makeRun({ checkpoint: { browserSessionId: "sess_existing" } });

  const result = await sm.attachForRun(run);

  assert.equal(createdSessions.length, 1);
});

// --- cleanupRun ---

test("cleanupRun destroys tracked session", async () => {
  const { kernel, destroyedSessions } = makeBrowserKernel();
  const sm = new SessionManager(kernel);
  const run = makeRun();

  const { session } = await sm.attachForRun(run);

  assert.equal(sm.sessionIdsForRun("run_1").length, 1);

  await sm.cleanupRun("run_1");

  assert.ok(destroyedSessions.includes(session.id));
  assert.deepEqual(sm.sessionIdsForRun("run_1"), []);
});

test("cleanupRun no-ops for unknown run", async () => {
  const { kernel, destroyedSessions } = makeBrowserKernel();
  const sm = new SessionManager(kernel);

  await sm.cleanupRun("nonexistent");

  assert.equal(destroyedSessions.length, 0);
});

test("cleanupRun swallows destroy errors", async () => {
  const { kernel } = makeBrowserKernel({ destroyThrows: true });
  const sm = new SessionManager(kernel);
  const run = makeRun();

  await sm.attachForRun(run);
  // Should not throw
  await sm.cleanupRun("run_1");

  assert.deepEqual(sm.sessionIdsForRun("run_1"), []);
});

// --- cleanupOrphans ---

test("cleanupOrphans destroys all except keepId", async () => {
  const { kernel, destroyedSessions } = makeBrowserKernel();
  const sm = new SessionManager(kernel);
  const run = makeRun();

  const { session: s1 } = await sm.attachForRun(run);
  const { session: s2 } = await sm.attachForRun(run);

  await sm.cleanupOrphans("run_1", s2.id);

  assert.ok(destroyedSessions.includes(s1.id));
  assert.ok(!destroyedSessions.includes(s2.id));
  assert.deepEqual(sm.sessionIdsForRun("run_1"), [s2.id]);
});

test("cleanupOrphans destroys all when no keepId", async () => {
  const { kernel, destroyedSessions } = makeBrowserKernel();
  const sm = new SessionManager(kernel);
  const run = makeRun();

  await sm.attachForRun(run);
  await sm.attachForRun(run);

  await sm.cleanupOrphans("run_1");

  assert.equal(destroyedSessions.length, 2);
  assert.deepEqual(sm.sessionIdsForRun("run_1"), []);
});

test("cleanupOrphans no-ops for unknown run", async () => {
  const { kernel, destroyedSessions } = makeBrowserKernel();
  const sm = new SessionManager(kernel);

  await sm.cleanupOrphans("nonexistent");
  assert.equal(destroyedSessions.length, 0);
});

// --- getSession ---

test("getSession delegates to browserKernel", async () => {
  const mockSession = { id: "sess_1", state: "attached", profileId: "p1" };
  const { kernel } = makeBrowserKernel({ sessionsMap: { sess_1: mockSession } });
  const sm = new SessionManager(kernel);

  const result = await sm.getSession("sess_1");
  assert.deepEqual(result, mockSession);
});

test("getSession returns null for unknown session", async () => {
  const { kernel } = makeBrowserKernel();
  const sm = new SessionManager(kernel);

  const result = await sm.getSession("unknown");
  assert.equal(result, null);
});

// --- Multiple runs tracked independently ---

test("tracks sessions independently per run", async () => {
  const { kernel } = makeBrowserKernel();
  const sm = new SessionManager(kernel);

  const run1 = makeRun({ id: "run_1" });
  const run2 = makeRun({ id: "run_2" });

  await sm.attachForRun(run1);
  await sm.attachForRun(run2);

  assert.equal(sm.sessionIdsForRun("run_1").length, 1);
  assert.equal(sm.sessionIdsForRun("run_2").length, 1);
  assert.notDeepEqual(sm.sessionIdsForRun("run_1"), sm.sessionIdsForRun("run_2"));

  await sm.cleanupRun("run_1");
  assert.deepEqual(sm.sessionIdsForRun("run_1"), []);
  assert.equal(sm.sessionIdsForRun("run_2").length, 1);
});
