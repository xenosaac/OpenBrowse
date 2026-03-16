import {
  createDefaultRuntimeSettings,
  type RiskClassPolicies,
  type RuntimeSettings
} from "@openbrowse/contracts";
import type { PreferenceStore } from "@openbrowse/memory-store/memory";

export const RUNTIME_SETTINGS_NAMESPACE = "runtime_settings";

/**
 * Reads all runtime settings from the preference store, filling in defaults
 * for any missing keys.
 */
export async function readStoredRuntimeSettings(preferenceStore: PreferenceStore): Promise<RuntimeSettings> {
  const defaults = createDefaultRuntimeSettings();
  const [anthropicApiKey, plannerModel, telegramBotToken, telegramChatId, telegramNotificationLevel, riskClassPoliciesRaw] = await Promise.all([
    preferenceStore.get(RUNTIME_SETTINGS_NAMESPACE, "anthropic_api_key"),
    preferenceStore.get(RUNTIME_SETTINGS_NAMESPACE, "planner_model"),
    preferenceStore.get(RUNTIME_SETTINGS_NAMESPACE, "telegram_bot_token"),
    preferenceStore.get(RUNTIME_SETTINGS_NAMESPACE, "telegram_chat_id"),
    preferenceStore.get(RUNTIME_SETTINGS_NAMESPACE, "telegram_notification_level"),
    preferenceStore.get(RUNTIME_SETTINGS_NAMESPACE, "risk_class_policies")
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
