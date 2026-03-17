import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildStartupDiagnostic,
  formatDiagnosticLog
} from "../packages/runtime-core/src/buildStartupDiagnostic.ts";

describe("buildStartupDiagnostic", () => {
  it("returns a complete diagnostic with all fields populated", () => {
    const now = new Date("2026-03-17T12:00:00Z");
    const diag = buildStartupDiagnostic(
      {
        appVersion: "0.1.0",
        schemaVersion: 4,
        runCount: 54,
        watchCount: 3,
        telegramConfigured: true,
        plannerApiKeyPresent: true
      },
      now
    );
    assert.equal(diag.appVersion, "0.1.0");
    assert.equal(diag.schemaVersion, 4);
    assert.equal(diag.runCount, 54);
    assert.equal(diag.watchCount, 3);
    assert.equal(diag.telegramConfigured, true);
    assert.equal(diag.plannerApiKeyPresent, true);
    assert.equal(diag.timestamp, "2026-03-17T12:00:00.000Z");
  });

  it("returns a diagnostic for a fresh install with zero runs and watches", () => {
    const diag = buildStartupDiagnostic({
      appVersion: "0.1.0",
      schemaVersion: 4,
      runCount: 0,
      watchCount: 0,
      telegramConfigured: false,
      plannerApiKeyPresent: false
    });
    assert.equal(diag.runCount, 0);
    assert.equal(diag.watchCount, 0);
    assert.equal(diag.telegramConfigured, false);
    assert.equal(diag.plannerApiKeyPresent, false);
    assert.ok(diag.timestamp); // auto-generated
  });

  it("uses current time when no explicit date is provided", () => {
    const before = new Date().toISOString();
    const diag = buildStartupDiagnostic({
      appVersion: "0.1.0",
      schemaVersion: 4,
      runCount: 10,
      watchCount: 1,
      telegramConfigured: false,
      plannerApiKeyPresent: true
    });
    const after = new Date().toISOString();
    assert.ok(diag.timestamp >= before);
    assert.ok(diag.timestamp <= after);
  });
});

describe("formatDiagnosticLog", () => {
  it("formats a populated diagnostic as a multi-line log string", () => {
    const diag = buildStartupDiagnostic(
      {
        appVersion: "0.1.0",
        schemaVersion: 4,
        runCount: 54,
        watchCount: 3,
        telegramConfigured: true,
        plannerApiKeyPresent: true
      },
      new Date("2026-03-17T12:00:00Z")
    );
    const log = formatDiagnosticLog(diag);
    assert.ok(log.includes("OpenBrowse v0.1.0"));
    assert.ok(log.includes("DB schema: v4"));
    assert.ok(log.includes("Runs: 54"));
    assert.ok(log.includes("Watches: 3"));
    assert.ok(log.includes("Telegram: configured"));
    assert.ok(log.includes("Planner API key: present"));
  });

  it("formats unconfigured services correctly", () => {
    const diag = buildStartupDiagnostic(
      {
        appVersion: "0.1.0",
        schemaVersion: 4,
        runCount: 0,
        watchCount: 0,
        telegramConfigured: false,
        plannerApiKeyPresent: false
      },
      new Date("2026-03-17T12:00:00Z")
    );
    const log = formatDiagnosticLog(diag);
    assert.ok(log.includes("Telegram: not configured"));
    assert.ok(log.includes("Planner API key: missing"));
    assert.ok(log.includes("Runs: 0"));
    assert.ok(log.includes("Watches: 0"));
  });
});
