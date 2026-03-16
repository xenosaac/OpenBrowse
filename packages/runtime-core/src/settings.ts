import { StubChatBridge, TelegramChatBridge, resolveTelegramConfig, type ChatBridge, type TelegramNotificationLevel } from "@openbrowse/chat-bridge";
import {
  createDefaultRuntimeSettings,
  DEFAULT_ANTHROPIC_MODEL,
  type RiskClassPolicies,
  type RuntimeDescriptor,
  type RuntimeSettings
} from "@openbrowse/contracts";
import { StubPlannerGateway, ClaudePlannerGateway, type PlannerGateway } from "@openbrowse/planner";
import { DefaultApprovalPolicy } from "@openbrowse/security";
import type { RuntimeServices } from "./types.js";
import { wireInboundChat, wireBotCommands } from "./OpenBrowseRuntime.js";
import { buildRuntimeDescriptor } from "./runtimeDescriptor.js";
export { buildRuntimeDescriptor } from "./runtimeDescriptor.js";

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

// --- Settings persistence helpers ---

async function readStoredRuntimeSettings(services: RuntimeServices): Promise<RuntimeSettings> {
  const defaults = createDefaultRuntimeSettings();
  const [anthropicApiKey, plannerModel, telegramBotToken, telegramChatId, telegramNotificationLevel, riskClassPoliciesRaw] = await Promise.all([
    services.preferenceStore.get(RUNTIME_SETTINGS_NAMESPACE, "anthropic_api_key"),
    services.preferenceStore.get(RUNTIME_SETTINGS_NAMESPACE, "planner_model"),
    services.preferenceStore.get(RUNTIME_SETTINGS_NAMESPACE, "telegram_bot_token"),
    services.preferenceStore.get(RUNTIME_SETTINGS_NAMESPACE, "telegram_chat_id"),
    services.preferenceStore.get(RUNTIME_SETTINGS_NAMESPACE, "telegram_notification_level"),
    services.preferenceStore.get(RUNTIME_SETTINGS_NAMESPACE, "risk_class_policies")
  ]);

  let riskClassPolicies: RiskClassPolicies = {};
  if (riskClassPoliciesRaw?.value) {
    try { riskClassPolicies = JSON.parse(riskClassPoliciesRaw.value); } catch { /* use default */ }
  }

  return {
    anthropicApiKey: anthropicApiKey?.value ?? defaults.anthropicApiKey,
    plannerModel: plannerModel?.value ?? defaults.plannerModel,
    telegramBotToken: telegramBotToken?.value ?? defaults.telegramBotToken,
    telegramChatId: telegramChatId?.value ?? defaults.telegramChatId,
    telegramNotificationLevel:
      (telegramNotificationLevel?.value as RuntimeSettings["telegramNotificationLevel"]) ??
      defaults.telegramNotificationLevel,
    riskClassPolicies
  };
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
  services.securityPolicy = new DefaultApprovalPolicy({
    riskClassPolicies: runtimeSettings.riskClassPolicies
  });
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
  await services.preferenceStore.saveNamespaceSettings(RUNTIME_SETTINGS_NAMESPACE, [
    { key: "anthropic_api_key", value: nextSettings.anthropicApiKey },
    { key: "planner_model", value: nextSettings.plannerModel || DEFAULT_ANTHROPIC_MODEL },
    { key: "telegram_bot_token", value: nextSettings.telegramBotToken },
    { key: "telegram_chat_id", value: nextSettings.telegramChatId },
    { key: "telegram_notification_level", value: nextSettings.telegramNotificationLevel ?? "quiet" },
    { key: "risk_class_policies", value: JSON.stringify(nextSettings.riskClassPolicies ?? {}) }
  ]);

  const stored = await readStoredRuntimeSettings(services);
  await applyRuntimeSettings(services, stored, { startChatBridge: true });
  return stored;
}
