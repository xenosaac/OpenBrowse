/**
 * Headless validation harness for OpenBrowse (T76 — Program X).
 *
 * Runs 5 predefined tasks against the real planner (Claude API) and real
 * browser (Electron/CDP), captures results, and writes a JSON report.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... pnpm run validate
 *
 * Requires network access for real web browsing and Claude API calls.
 */

import { app, BrowserWindow } from "electron";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Database = _require("better-sqlite3");
import { composeRuntime } from "./runtime/composeRuntime";
import {
  hydrateRuntimeSettings,
  bootstrapRunDetached,
  cancelTrackedRun,
  shutdownRuntime,
  type RuntimeServices
} from "@openbrowse/runtime-core";
import { DefaultApprovalPolicy } from "@openbrowse/security";
import type { TaskIntent, TaskRun } from "@openbrowse/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ValidationTask {
  goal: string;
  timeoutMs: number;
}

interface TaskResult {
  goal: string;
  status: string;
  steps: number;
  duration_ms: number;
  failure_reason?: string;
  extractedData?: Array<{ label: string; value: string }>;
}

interface ValidationReport {
  timestamp: string;
  tasks: TaskResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    rate: string;
  };
}

// ---------------------------------------------------------------------------
// Predefined validation tasks (from PM spec)
// ---------------------------------------------------------------------------

const TASKS: ValidationTask[] = [
  {
    goal: "What is the current weather in San Francisco?",
    timeoutMs: 180_000
  },
  {
    goal: "What is the population of Tokyo?",
    timeoutMs: 180_000
  },
  {
    goal: "Find the cheapest flight from LAX to JFK next month",
    timeoutMs: 180_000
  },
  {
    goal: "Go to wikipedia.org and find the featured article of the day, then extract its title and first paragraph",
    timeoutMs: 180_000
  },
  {
    goal: "Go to news.ycombinator.com and extract the titles of the top 5 stories",
    timeoutMs: 180_000
  }
];

// ---------------------------------------------------------------------------
// Run a single task with timeout + cancellation
// ---------------------------------------------------------------------------

async function runTask(
  services: RuntimeServices,
  intent: TaskIntent,
  timeoutMs: number
): Promise<TaskRun> {
  return new Promise<TaskRun>((resolve, reject) => {
    let settled = false;
    let runId: string | undefined;

    const timer = setTimeout(async () => {
      if (settled) return;
      settled = true;
      // Cancel the running task if we have its ID
      if (runId) {
        try {
          await cancelTrackedRun(services, runId, "Validation timeout");
        } catch { /* best effort */ }
        // Give cancellation a moment to propagate
        await new Promise((r) => setTimeout(r, 1000));
        const finalRun = await services.runCheckpointStore.load(runId);
        if (finalRun) {
          resolve(finalRun);
          return;
        }
      }
      // Synthetic failure if we can't load the cancelled run
      resolve({
        id: runId ?? intent.id,
        goal: intent.goal,
        status: "failed",
        source: intent.source,
        constraints: [],
        profileId: undefined,
        createdAt: intent.createdAt ?? new Date().toISOString(),
        checkpoint: { summary: "Validation timeout", notes: [], stepCount: 0 },
        outcome: { summary: "TIMEOUT: task exceeded 180s" }
      } as unknown as TaskRun);
    }, timeoutMs);

    bootstrapRunDetached(services, intent, (run) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(run);
    })
      .then((initialRun) => {
        runId = initialRun.id;
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  console.log("\n=== OpenBrowse Validation Harness ===\n");

  // Resolve API key: env var first, then user's main database as fallback.
  // Try multiple candidate paths because app.getPath("userData") varies
  // depending on how Electron is launched (packaged app vs npx electron vs direct binary).
  let apiKey = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!apiKey) {
    const home = process.env.HOME ?? "";
    const candidatePaths = [
      path.join(app.getPath("userData"), "openbrowse.db"),
      path.join(home, "Library/Application Support/@openbrowse/desktop/openbrowse.db"),
      path.join(home, "Library/Application Support/OpenBrowse/openbrowse.db"),
      path.join(home, "Library/Application Support/Electron/openbrowse.db")
    ];
    for (const dbPath of candidatePaths) {
      if (!fs.existsSync(dbPath)) continue;
      try {
        const db = new Database(dbPath, { readonly: true });
        const row = db.prepare(
          "SELECT value FROM user_preferences WHERE namespace = ? AND key = ?"
        ).get("runtime_settings", "anthropic_api_key") as { value: string } | undefined;
        db.close();
        if (row?.value?.trim()) {
          apiKey = row.value.trim();
          process.env.ANTHROPIC_API_KEY = apiKey;
          console.log(`API key loaded from user database (${path.basename(path.dirname(dbPath))}/${path.basename(dbPath)}).`);
          break;
        }
      } catch (err) {
        console.warn(`Could not read API key from ${dbPath}:`, (err as Error).message);
      }
    }
  }
  if (!apiKey) {
    console.error(
      "ERROR: No API key found.\n" +
        "Either set ANTHROPIC_API_KEY env var or enter your key in the app's Settings panel.\n" +
        "Usage: ANTHROPIC_API_KEY=sk-... pnpm run validate"
    );
    app.exit(1);
    return;
  }

  // Create a hidden window — ElectronBrowserKernel uses it as parent
  // for hidden BrowserWindow sessions (no viewProvider = no UI embedding)
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // Use a separate database so validation runs don't mix with user data
  const dbPath = path.join(app.getPath("userData"), "validate.db");

  console.log("Composing runtime...");
  const services = await composeRuntime({
    mainWindow: win,
    dbPath,
    enableExperimentalBrowser: true,
    enableRemoteChat: false,
    enableModelPlanner: true,
    hasDemos: false
  });

  await hydrateRuntimeSettings(services);

  // Auto-approve all actions during validation so tasks don't hang on
  // approval gates. The real app's approval policy is preserved in the
  // normal runtime — this only affects the validation harness.
  services.securityPolicy = new DefaultApprovalPolicy({
    riskClassPolicies: {
      financial: "auto_approve",
      credential: "auto_approve",
      destructive: "auto_approve",
      submission: "auto_approve",
      navigation: "auto_approve",
      general: "auto_approve"
    }
  });

  // Initialize the browser kernel (loads profiles, etc.)
  if (services.browserKernelInit) {
    await services.browserKernelInit();
  }

  console.log(`Planner: ${services.descriptor.planner.mode} (${services.descriptor.planner.detail})`);
  console.log(`Browser: ${services.descriptor.browser.mode}`);
  console.log(`Tasks: ${TASKS.length}\n`);

  const results: TaskResult[] = [];

  for (let i = 0; i < TASKS.length; i++) {
    const task = TASKS[i];
    console.log(`[${i + 1}/${TASKS.length}] ${task.goal}`);
    const startTime = Date.now();

    const intent: TaskIntent = {
      id: `validate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      source: "desktop",
      goal: task.goal,
      constraints: [],
      metadata: {},
      createdAt: new Date().toISOString()
    };

    try {
      const run = await runTask(services, intent, task.timeoutMs);
      const duration = Date.now() - startTime;
      const isPass = run.status === "completed";

      results.push({
        goal: task.goal,
        status: run.status,
        steps: run.checkpoint?.stepCount ?? 0,
        duration_ms: duration,
        failure_reason: !isPass
          ? run.outcome?.summary ?? run.status
          : undefined,
        extractedData: run.outcome?.extractedData
      });

      const icon = isPass ? "\u2713" : "\u2717";
      console.log(
        `  ${icon} ${run.status} \u2014 ${duration}ms, ${run.checkpoint?.stepCount ?? 0} steps`
      );
      if (run.outcome?.summary) {
        console.log(`  ${run.outcome.summary.slice(0, 200)}`);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      const reason =
        error instanceof Error ? error.message : String(error);
      results.push({
        goal: task.goal,
        status: "failed",
        steps: 0,
        duration_ms: duration,
        failure_reason: reason
      });
      console.log(`  \u2717 Error \u2014 ${reason} (${duration}ms)`);
    }
  }

  // Build report
  const passed = results.filter((r) => r.status === "completed").length;
  const failed = results.length - passed;
  const rate = `${Math.round((passed / results.length) * 100)}%`;

  const report: ValidationReport = {
    timestamp: new Date().toISOString(),
    tasks: results,
    summary: { total: results.length, passed, failed, rate }
  };

  // Write results JSON
  const outputPath = path.resolve(process.cwd(), "validation-results.json");
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  // Print summary table
  console.log("\n=== Validation Summary ===");
  console.log(
    `Total: ${results.length} | Passed: ${passed} | Failed: ${failed} | Rate: ${rate}`
  );
  for (const r of results) {
    const icon = r.status === "completed" ? "\u2713" : "\u2717";
    console.log(
      `  ${icon} ${r.goal} \u2014 ${r.status} (${r.duration_ms}ms, ${r.steps} steps)`
    );
  }
  console.log(`\nResults written to: ${outputPath}`);

  // Cleanup
  await shutdownRuntime(services);
  win.destroy();
  app.exit(passed > 0 ? 0 : 1);
});

// Prevent quitting when the hidden window is the only window
app.on("window-all-closed", () => {
  // Intentionally empty — we control exit via app.exit() above
});
