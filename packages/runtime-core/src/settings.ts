import { StubChatBridge, TelegramChatBridge, resolveTelegramConfig, type ChatBridge, type TelegramNotificationLevel } from "@openbrowse/chat-bridge";
import {
  createDefaultRuntimeSettings,
  DEFAULT_ANTHROPIC_MODEL,
  type RuntimeDescriptor,
  type RuntimeSettings
} from "@openbrowse/contracts";
import { StubPlannerGateway, ClaudePlannerGateway, type PlannerGateway } from "@openbrowse/planner";
import type { RuntimeServices } from "./types.js";
import { wireInboundChat, wireBotCommands } from "./OpenBrowseRuntime.js";

export const RUNTIME_SETTINGS_NAMESPACE = "runtime_settings";

// --- Planner factory ---

export function createPlanner(
  enableModelPlanner: boolean,
  runtimeSettings: RuntimeSettings
): {
  planner: PlannerGateway;
  descriptor: RuntimeDescriptor["planner"];
} {
  const apiKey = runtimeSettings.anthropicApiKey.trim() || process.env.ANTHROPIC_API_KEY;
  const model = runtimeSettings.plannerModel.trim() || DEFAULT_ANTHROPIC_MODEL;
  if (enableModelPlanner && apiKey) {
    return {
      planner: new ClaudePlannerGateway({ apiKey, model }),
      descriptor: {
        mode: "live",
        detail: `Anthropic-backed planner is active for browser task decisions using ${model}.`
      }
    };
  }

  return {
    planner: new StubPlannerGateway(),
    descriptor: {
      mode: "stub",
      detail: apiKey
        ? "Model planner is available but currently disabled."
        : "Planner is running in stub mode because no Anthropic API key is configured."
    }
  };
}

// --- Chat bridge factory ---

export function createChatBridge(
  enableRemoteChat: boolean,
  telegramStatePath: string,
  runtimeSettings: RuntimeSettings
): {
  chatBridge: ChatBridge;
  chatBridgeInit?: () => Promise<void>;
  descriptor: RuntimeDescriptor["chatBridge"];
} {
  const telegramConfig = resolveTelegramConfig({
    botToken: runtimeSettings.telegramBotToken.trim() || undefined,
    chatId: runtimeSettings.telegramChatId.trim() || undefined,
    statePath: telegramStatePath,
    notificationLevel: (runtimeSettings.telegramNotificationLevel as TelegramNotificationLevel) ?? "quiet"
  });
  if (enableRemoteChat && telegramConfig) {
    const bridge = new TelegramChatBridge(telegramConfig);
    return {
      chatBridge: bridge,
      chatBridgeInit: () => bridge.start(),
      descriptor: {
        mode: "live",
        detail: telegramConfig.chatId
          ? "Telegram bridge is active and locked to the configured chat."
          : "Telegram bridge is active in first-private-chat pairing mode."
      }
    };
  }

  return {
    chatBridge: new StubChatBridge(),
    descriptor: {
      mode: "stub",
      detail: enableRemoteChat
        ? "Telegram bridge is unavailable because the bot token is not configured."
        : "Telegram bridge is disabled for this runtime."
    }
  };
}

// --- Runtime descriptor builder ---

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

// --- Settings persistence helpers ---

async function readStoredRuntimeSettings(services: RuntimeServices): Promise<RuntimeSettings> {
  const defaults = createDefaultRuntimeSettings();
  const [anthropicApiKey, plannerModel, telegramBotToken, telegramChatId, telegramNotificationLevel] = await Promise.all([
    services.preferenceStore.get(RUNTIME_SETTINGS_NAMESPACE, "anthropic_api_key"),
    services.preferenceStore.get(RUNTIME_SETTINGS_NAMESPACE, "planner_model"),
    services.preferenceStore.get(RUNTIME_SETTINGS_NAMESPACE, "telegram_bot_token"),
    services.preferenceStore.get(RUNTIME_SETTINGS_NAMESPACE, "telegram_chat_id"),
    services.preferenceStore.get(RUNTIME_SETTINGS_NAMESPACE, "telegram_notification_level")
  ]);

  return {
    anthropicApiKey: anthropicApiKey?.value ?? defaults.anthropicApiKey,
    plannerModel: plannerModel?.value ?? defaults.plannerModel,
    telegramBotToken: telegramBotToken?.value ?? defaults.telegramBotToken,
    telegramChatId: telegramChatId?.value ?? defaults.telegramChatId,
    telegramNotificationLevel:
      (telegramNotificationLevel?.value as RuntimeSettings["telegramNotificationLevel"]) ??
      defaults.telegramNotificationLevel
  };
}

async function upsertRuntimeSetting(
  services: RuntimeServices,
  preferenceKey: string,
  value: string
): Promise<void> {
  const existing = await services.preferenceStore.get(RUNTIME_SETTINGS_NAMESPACE, preferenceKey);
  const nextValue = value.trim();

  if (!nextValue) {
    if (existing) {
      await services.preferenceStore.delete(existing.id);
    }
    return;
  }

  await services.preferenceStore.upsert({
    id: existing?.id ?? `pref_${preferenceKey}`,
    namespace: RUNTIME_SETTINGS_NAMESPACE,
    key: preferenceKey,
    value: nextValue,
    capturedAt: new Date().toISOString()
  });
}

async function applyRuntimeSettings(
  services: RuntimeServices,
  runtimeSettings: RuntimeSettings,
  options: { startChatBridge: boolean }
): Promise<void> {
  if (services.chatBridge instanceof TelegramChatBridge) {
    await services.chatBridge.stop();
  }

  const enableModelPlanner =
    Boolean(runtimeSettings.anthropicApiKey.trim() || process.env.ANTHROPIC_API_KEY) &&
    process.env.OPENBROWSE_DISABLE_MODEL_PLANNER !== "1";
  const enableRemoteChat = process.env.OPENBROWSE_DISABLE_TELEGRAM !== "1";

  const plannerSetup = createPlanner(enableModelPlanner, runtimeSettings);
  const chatBridgeSetup = createChatBridge(enableRemoteChat, services.telegramStatePath, runtimeSettings);

  services.runtimeSettings = runtimeSettings;
  services.planner = plannerSetup.planner;
  services.chatBridge = chatBridgeSetup.chatBridge;
  services.chatBridgeInit = chatBridgeSetup.chatBridgeInit;
  services.descriptor = buildRuntimeDescriptor({
    planner: plannerSetup.descriptor,
    browser: services.descriptor.browser,
    chatBridge: chatBridgeSetup.descriptor,
    storage: services.descriptor.storage,
    hasDemos: services.hasDemos
  });

  wireInboundChat(services);
  wireBotCommands(services);

  if (options.startChatBridge) {
    await services.chatBridgeInit?.();
  }
}

// --- Public settings API ---

export async function hydrateRuntimeSettings(services: RuntimeServices): Promise<RuntimeSettings> {
  const runtimeSettings = await readStoredRuntimeSettings(services);
  await applyRuntimeSettings(services, runtimeSettings, { startChatBridge: false });
  return runtimeSettings;
}

export async function getRuntimeSettings(services: RuntimeServices): Promise<RuntimeSettings> {
  const runtimeSettings = await readStoredRuntimeSettings(services);
  services.runtimeSettings = runtimeSettings;
  return runtimeSettings;
}

export async function saveRuntimeSettings(
  services: RuntimeServices,
  nextSettings: RuntimeSettings
): Promise<RuntimeSettings> {
  await upsertRuntimeSetting(services, "anthropic_api_key", nextSettings.anthropicApiKey);
  await upsertRuntimeSetting(services, "planner_model", nextSettings.plannerModel || DEFAULT_ANTHROPIC_MODEL);
  await upsertRuntimeSetting(services, "telegram_bot_token", nextSettings.telegramBotToken);
  await upsertRuntimeSetting(services, "telegram_chat_id", nextSettings.telegramChatId);
  await upsertRuntimeSetting(services, "telegram_notification_level", nextSettings.telegramNotificationLevel ?? "quiet");

  const stored = await readStoredRuntimeSettings(services);
  await applyRuntimeSettings(services, stored, { startChatBridge: true });
  return stored;
}
