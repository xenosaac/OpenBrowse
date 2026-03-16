import { StubChatBridge, TelegramChatBridge, resolveTelegramConfig, type ChatBridge, type TelegramNotificationLevel } from "@openbrowse/chat-bridge";
import {
  DEFAULT_ANTHROPIC_MODEL,
  type RuntimeDescriptor,
  type RuntimeSettings
} from "@openbrowse/contracts";
import { StubPlannerGateway, ClaudePlannerGateway, type PlannerGateway } from "@openbrowse/planner";

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
