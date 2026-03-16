import type { RuntimeDescriptor } from "@openbrowse/contracts";

/**
 * Determines the runtime phase and builds the full descriptor based on
 * which subsystems are live vs stubbed.
 *
 * Pure function — no side effects, no Electron dependency.
 */
export function buildRuntimeDescriptor(status: {
  planner: RuntimeDescriptor["planner"];
  browser: RuntimeDescriptor["browser"];
  chatBridge: RuntimeDescriptor["chatBridge"];
  storage: RuntimeDescriptor["storage"];
  hasDemos?: boolean;
}): RuntimeDescriptor {
  const browserLive = status.browser.mode !== "stub";
  const chatLive = status.chatBridge.mode !== "stub";

  if (!browserLive) {
    return {
      phase: "phase1",
      mode: "desktop_skeleton",
      ...status,
      notes: [
        "Main, preload, and renderer are wired into a runnable Electron shell.",
        "The runtime can create, suspend, resume, and complete task runs locally.",
        "Real browser automation and remote chat are still deferred behind stub adapters."
      ],
      deferredCapabilities: [
        "Real browser automation against managed Chromium sessions",
        "Remote Telegram clarification routing",
        "Provider-backed planning as the default execution path",
        "Unified visible browser shell for task execution windows"
      ]
    };
  }

  if (!chatLive) {
    return {
      phase: "phase2",
      mode: "desktop_runtime",
      ...status,
      notes: [
        "The real Electron browser runtime is active with managed sessions and page capture.",
        "Local persistence is active, so runs and logs survive process restarts.",
        "Remote clarification is not active yet, so suspended runs must be resumed locally."
      ],
      deferredCapabilities: [
        "Remote Telegram clarification routing",
        "Unified visible browser shell for task execution windows",
        status.planner.mode === "stub"
          ? "Provider-backed planning as the default execution path"
          : "Multi-site demo task flows"
      ]
    };
  }

  if (status.hasDemos) {
    const plannerLive = status.planner.mode === "live";
    return {
      phase: "phase4",
      mode: "desktop_runtime",
      ...status,
      notes: [
        "Browser shell, Telegram bridge, local persistence, approval gates, replay, and recovery are active.",
        "Scripted demo flows and live task packs are registered.",
        plannerLive
          ? "The live Claude planner is active — live task packs can operate on real websites."
          : "The planner is in stub mode — live task packs are visible but disabled until ANTHROPIC_API_KEY is configured."
      ],
      deferredCapabilities: [
        ...(plannerLive ? [] : ["Live task pack execution (requires ANTHROPIC_API_KEY)"]),
        "Production code signing and notarization for macOS distribution",
        "User-customizable recurring task schedules beyond built-in demos"
      ]
    };
  }

  return {
    phase: "phase3",
    mode: "desktop_runtime",
    ...status,
    notes: [
      "Real browser automation, local persistence, and Telegram clarification routing are active together.",
      "Suspended runs can be resumed remotely through an authorized Telegram chat and local checkpoint store.",
      "This runtime is ready for first demo tasks once phase-specific correctness issues are closed."
    ],
    deferredCapabilities: [
      "Unified visible browser shell for task execution windows",
      status.planner.mode === "stub"
        ? "Provider-backed planning as the default execution path"
        : "Travel / appointment / unread-monitor demo flows"
    ]
  };
}
