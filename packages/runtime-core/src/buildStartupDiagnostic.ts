/**
 * Pure function that builds a structured startup diagnostic summary.
 * Called from bootstrap after all services are initialized.
 */

export interface StartupDiagnosticInput {
  appVersion: string;
  schemaVersion: number;
  runCount: number;
  watchCount: number;
  telegramConfigured: boolean;
  plannerApiKeyPresent: boolean;
}

export interface StartupDiagnostic extends StartupDiagnosticInput {
  timestamp: string;
}

export function buildStartupDiagnostic(
  input: StartupDiagnosticInput,
  now?: Date
): StartupDiagnostic {
  return {
    ...input,
    timestamp: (now ?? new Date()).toISOString()
  };
}

export function formatDiagnosticLog(diag: StartupDiagnostic): string {
  const lines = [
    `[startup] OpenBrowse v${diag.appVersion}`,
    `  DB schema: v${diag.schemaVersion}`,
    `  Runs: ${diag.runCount}`,
    `  Watches: ${diag.watchCount}`,
    `  Telegram: ${diag.telegramConfigured ? "configured" : "not configured"}`,
    `  Planner API key: ${diag.plannerApiKeyPresent ? "present" : "missing"}`
  ];
  return lines.join("\n");
}
