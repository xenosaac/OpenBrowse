import {
  createDefaultRuntimeSettings,
  type RiskClassPolicies,
  type RuntimeSettings
} from "@openbrowse/contracts";
import type { PreferenceStore } from "@openbrowse/memory-store/memory";

export const RUNTIME_SETTINGS_NAMESPACE = "runtime_settings";

const VALID_RISK_CLASSES = new Set(["financial", "credential", "destructive", "submission", "navigation", "general"]);
const VALID_POLICIES = new Set(["always_ask", "auto_approve", "default"]);

/**
 * Validates and sanitizes a parsed value into a RiskClassPolicies object.
 * Strips any keys that aren't valid RiskClass names and any values that
 * aren't valid RiskClassPolicy strings.  Returns {} for non-object input.
 */
export function validateRiskClassPolicies(parsed: unknown): RiskClassPolicies {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const result: RiskClassPolicies = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (VALID_RISK_CLASSES.has(key) && typeof value === "string" && VALID_POLICIES.has(value)) {
      (result as Record<string, string>)[key] = value;
    }
  }
  return result;
}

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
    try { riskClassPolicies = validateRiskClassPolicies(JSON.parse(riskClassPoliciesRaw.value)); } catch { /* use default */ }
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
