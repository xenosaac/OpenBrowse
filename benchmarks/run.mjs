/**
 * OpenBrowse performance benchmarks.
 * Run: node benchmarks/run.mjs
 * Profile: node --cpu-prof benchmarks/run.mjs
 */

import { performance, PerformanceObserver } from "node:perf_hooks";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// ── Imports ────────────────────────────────────────────────────────────────
import { buildPlannerPrompt } from "../packages/planner/dist/index.js";
import { buildHandoffArtifact, renderHandoffMarkdown } from "../packages/observability/dist/index.js";
import {
  TaskOrchestrator,
  DefaultClarificationPolicy,
} from "../packages/orchestrator/dist/index.js";
import {
  InMemoryRunCheckpointStore,
  InMemoryWorkflowLogStore,
  SqliteDatabase,
  SqliteRunCheckpointStore,
  SqliteWorkflowLogStore,
} from "../packages/memory-store/dist/index.js";

// ── Helpers ────────────────────────────────────────────────────────────────
function bench(label, fn, iterations = 10_000) {
  // warmup
  for (let i = 0; i < Math.min(100, iterations / 10); i++) fn();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsed = performance.now() - start;

  const opsPerSec = Math.round((iterations / elapsed) * 1000);
  const usPerOp = ((elapsed / iterations) * 1000).toFixed(2);
  console.log(`  ${label.padEnd(52)} ${String(opsPerSec).padStart(8)} ops/s   ${usPerOp.padStart(8)} µs/op`);
  return { label, opsPerSec, usPerOp: parseFloat(usPerOp) };
}

async function benchAsync(label, fn, iterations = 1_000) {
  for (let i = 0; i < Math.min(20, iterations / 10); i++) await fn();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) await fn();
  const elapsed = performance.now() - start;

  const opsPerSec = Math.round((iterations / elapsed) * 1000);
  const usPerOp = ((elapsed / iterations) * 1000).toFixed(2);
  console.log(`  ${label.padEnd(52)} ${String(opsPerSec).padStart(8)} ops/s   ${usPerOp.padStart(8)} µs/op`);
  return { label, opsPerSec, usPerOp: parseFloat(usPerOp) };
}

function section(title) {
  console.log(`\n${"─".repeat(72)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(72));
}

// ── Fixtures ───────────────────────────────────────────────────────────────
const orchestrator = new TaskOrchestrator({ clarificationPolicy: new DefaultClarificationPolicy() });

function makeIntent(id = "intent_1") {
  return { id, source: "desktop", goal: "Find the best flight from SFO to NYC next Tuesday", constraints: ["prefer direct flights", "economy class"], metadata: {} };
}

function makePageElement(i) {
  return {
    id: `el_${i}`,
    role: i % 5 === 0 ? "button" : i % 5 === 1 ? "link" : i % 5 === 2 ? "textbox" : i % 5 === 3 ? "combobox" : "checkbox",
    label: `Element label ${i} with some descriptive text`,
    value: i % 3 === 0 ? `value_${i}` : undefined,
    isActionable: i % 2 === 0,
    href: i % 5 === 1 ? `https://example.com/page/${i}` : undefined,
    inputType: i % 5 === 2 ? "text" : undefined,
    disabled: i % 7 === 0 ? true : undefined,
    boundingVisible: i % 4 !== 0,
  };
}

function makePageModel(elementCount = 50) {
  return {
    id: `page_${elementCount}`,
    url: "https://flights.example.com/search?origin=SFO&destination=NYC",
    title: "Flight Search Results — Example Flights",
    summary: "Flight Search Results — Example Flights - Find cheap flights",
    elements: Array.from({ length: elementCount }, (_, i) => makePageElement(i)),
    visibleText: "Lorem ipsum dolor sit amet ".repeat(100),
    createdAt: new Date().toISOString(),
  };
}

function makeActionRecord(step) {
  return {
    step,
    type: step % 3 === 0 ? "click" : step % 3 === 1 ? "type" : "navigate",
    description: `Action description for step ${step} with enough detail`,
    ok: step % 4 !== 3,
    failureClass: step % 4 === 3 ? "element_not_found" : undefined,
    url: "https://flights.example.com/search",
    createdAt: new Date().toISOString(),
  };
}

function makeRun(actionCount = 0, softFailures = 0) {
  let run = orchestrator.startRun(orchestrator.createRun(makeIntent(`intent_${actionCount}`)));
  // Simulate some page observations
  for (let i = 0; i < Math.min(actionCount, 3); i++) {
    run = orchestrator.observePage(run, makePageModel(50), `session_${i}`);
    run = orchestrator.recordBrowserResult(run, {
      ok: true,
      action: { type: "click", description: `Action ${i}`, targetId: `el_${i}` },
      pageModelId: `page_${i}`,
      summary: `Executed click: Action ${i}`,
    });
  }
  // Override action history to desired size
  run = {
    ...run,
    checkpoint: {
      ...run.checkpoint,
      actionHistory: Array.from({ length: actionCount }, (_, i) => makeActionRecord(i)),
      consecutiveSoftFailures: softFailures,
      stepCount: actionCount,
    },
  };
  return run;
}

// ── Benchmark sections ─────────────────────────────────────────────────────

const results = [];

section("1. buildPlannerPrompt — prompt construction");
results.push(bench("prompt: 0 actions, 20 elements", () =>
  buildPlannerPrompt(makeRun(0), makePageModel(20))));
results.push(bench("prompt: 5 actions, 50 elements", () =>
  buildPlannerPrompt(makeRun(5), makePageModel(50))));
results.push(bench("prompt: 10 actions (max history), 50 elements", () =>
  buildPlannerPrompt(makeRun(10), makePageModel(50))));
results.push(bench("prompt: 10 actions, 200 elements (max)", () =>
  buildPlannerPrompt(makeRun(10), makePageModel(200))));
results.push(bench("prompt: 10 actions, 5 soft failures", () =>
  buildPlannerPrompt(makeRun(10, 5), makePageModel(50))));

section("2. buildHandoffArtifact + renderHandoffMarkdown");
const runSimple = makeRun(0);
const runMedium = makeRun(5);
const runFull = makeRun(10, 3);
results.push(bench("buildHandoffArtifact: 0 actions", () => buildHandoffArtifact(runSimple)));
results.push(bench("buildHandoffArtifact: 5 actions", () => buildHandoffArtifact(runMedium)));
results.push(bench("buildHandoffArtifact: 10 actions + 3 soft fails", () => buildHandoffArtifact(runFull)));
results.push(bench("renderHandoffMarkdown: 0 actions", () => renderHandoffMarkdown(buildHandoffArtifact(runSimple))));
results.push(bench("renderHandoffMarkdown: 10 actions (full)", () => renderHandoffMarkdown(buildHandoffArtifact(runFull))));

section("3. Orchestrator operations");
const baseRun = orchestrator.startRun(orchestrator.createRun(makeIntent()));
const pageModel50 = makePageModel(50);
const browserResult = { ok: true, action: { type: "click", description: "Click search", targetId: "el_0" }, pageModelId: "page_x", summary: "Executed click" };
results.push(bench("orchestrator.createRun", () => orchestrator.createRun(makeIntent())));
results.push(bench("orchestrator.observePage (50 elements → update)", () => orchestrator.observePage(baseRun, pageModel50, "sess")));
results.push(bench("orchestrator.recordBrowserResult (history push)", () => orchestrator.recordBrowserResult(baseRun, browserResult)));

// Simulate growing action history
const runWith9Actions = makeRun(9);
results.push(bench("orchestrator.recordBrowserResult (history at 9→slice to 10)", () =>
  orchestrator.recordBrowserResult(runWith9Actions, browserResult)));

section("4. extractPageModel script — string metrics");
// We can't run the DOM script in Node, but we measure its character count and token estimate
const { EXTRACT_PAGE_MODEL_SCRIPT } = await import("../packages/browser-runtime/dist/cdp/extractPageModel.js");
const scriptLen = EXTRACT_PAGE_MODEL_SCRIPT.length;
const estimatedTokens = Math.round(scriptLen / 4);
console.log(`  Script length: ${scriptLen} chars, ~${estimatedTokens} tokens (sent on every capturePageModel call)`);

section("5. In-memory store: checkpoint + log throughput");
const memStore = new InMemoryRunCheckpointStore();
const memLog = new InMemoryWorkflowLogStore();
const runToSave = makeRun(10);
await benchAsync("InMemoryRunCheckpointStore: save", () => memStore.save(runToSave));
await benchAsync("InMemoryRunCheckpointStore: load", () => memStore.load(runToSave.id));
await benchAsync("InMemoryRunCheckpointStore: listAll", () => memStore.listAll());

const fakeEvent = { id: `evt_${Date.now()}`, runId: runToSave.id, type: "browser_action_executed", summary: "test", createdAt: new Date().toISOString(), payload: { ok: "true", actionType: "click" } };
let evtCounter = 0;
await benchAsync("InMemoryWorkflowLogStore: append", () => {
  const e = { ...fakeEvent, id: `evt_${evtCounter++}` };
  return memLog.append(e);
});
await benchAsync("InMemoryWorkflowLogStore: listByRun (10 events)", () => memLog.listByRun(runToSave.id));

// Section 6: SQLite store benchmarks are skipped when running under system Node.js because
// better-sqlite3 is compiled as a native addon for Electron's bundled Node (NODE_MODULE_VERSION 140)
// and will fail to load under system Node.js v25+ (NODE_MODULE_VERSION 141).
// Run the app under Electron to exercise the SQLite code path.
section("6. SQLite store: checkpoint + log throughput");
let sqliteAvailable = false;
try {
  const dbPath = path.join(os.tmpdir(), `openbrowse_bench_${Date.now()}.db`);
  const sqliteDb = new SqliteDatabase(dbPath);
  await sqliteDb.migrate();
  const sqliteRunStore = new SqliteRunCheckpointStore(sqliteDb);
  const sqliteLogStore = new SqliteWorkflowLogStore(sqliteDb);
  sqliteAvailable = true;

  await benchAsync("SqliteRunCheckpointStore: save", () => sqliteRunStore.save(runToSave), 500);
  await benchAsync("SqliteRunCheckpointStore: load", () => sqliteRunStore.load(runToSave.id), 500);
  await benchAsync("SqliteRunCheckpointStore: listAll", () => sqliteRunStore.listAll(), 500);

  let sqlEvtCounter = 0;
  await benchAsync("SqliteWorkflowLogStore: append", () => {
    const e = { ...fakeEvent, id: `sql_evt_${sqlEvtCounter++}` };
    return sqliteLogStore.append(e);
  }, 500);
  await benchAsync("SqliteWorkflowLogStore: listByRun (growing)", () => sqliteLogStore.listByRun(runToSave.id), 200);

  sqliteDb.close();
  try { fs.unlinkSync(dbPath); } catch {}
} catch (err) {
  if (!sqliteAvailable) {
    console.log(`  [skipped] better-sqlite3 native addon not compatible with this Node.js version.`);
    console.log(`  Run under Electron to benchmark SQLite. (${err.message.split("\n")[0]})`);
  } else {
    throw err;
  }
}

// ── Summary ────────────────────────────────────────────────────────────────
section("Summary — slowest operations (µs/op)");
const sorted = [...results].sort((a, b) => b.usPerOp - a.usPerOp);
for (const r of sorted.slice(0, 8)) {
  console.log(`  ${r.label.padEnd(52)} ${String(r.usPerOp).padStart(8)} µs/op`);
}
console.log("");
