import { TelegramChatBridge } from "@openbrowse/chat-bridge";
import {
  DEFAULT_ANTHROPIC_MODEL,
  type RuntimeSettings
} from "@openbrowse/contracts";
import { DefaultApprovalPolicy } from "@openbrowse/security";
import type { RuntimeServices } from "./types.js";
import { wireInboundChat, wireBotCommands } from "./OpenBrowseRuntime.js";
import { buildRuntimeDescriptor } from "./runtimeDescriptor.js";
import { createPlanner, createChatBridge } from "./factories.js";
import { readStoredRuntimeSettings, RUNTIME_SETTINGS_NAMESPACE } from "./settingsStore.js";
export { buildRuntimeDescriptor } from "./runtimeDescriptor.js";
export { createPlanner, createChatBridge } from "./factories.js";
export { readStoredRuntimeSettings, RUNTIME_SETTINGS_NAMESPACE } from "./settingsStore.js";


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
  const runtimeSettings = await readStoredRuntimeSettings(services.preferenceStore);
  await applyRuntimeSettings(services, runtimeSettings, { startChatBridge: false });
  return runtimeSettings;
}

export async function getRuntimeSettings(services: RuntimeServices): Promise<RuntimeSettings> {
  const runtimeSettings = await readStoredRuntimeSettings(services.preferenceStore);
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

  const stored = await readStoredRuntimeSettings(services.preferenceStore);
  await applyRuntimeSettings(services, stored, { startChatBridge: true });
  return stored;
}
