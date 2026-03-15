export type TelegramPairingMode = "configured-only" | "claim-first-private-chat";
export type TelegramNotificationLevel = "quiet" | "verbose";

export interface TelegramConfig {
  botToken: string;
  chatId?: string;
  statePath: string;
  pairingMode: TelegramPairingMode;
  /** "quiet" (default): only suspension + terminal events.
   *  "verbose": every browser action step. */
  notificationLevel: TelegramNotificationLevel;
}

export function resolveTelegramConfig(overrides: Partial<TelegramConfig> = {}): TelegramConfig | null {
  const botToken = overrides.botToken ?? process.env.OPENBROWSE_TELEGRAM_BOT_TOKEN;
  const chatId = overrides.chatId ?? process.env.OPENBROWSE_TELEGRAM_CHAT_ID;
  const statePath =
    overrides.statePath ??
    process.env.OPENBROWSE_TELEGRAM_STATE_PATH ??
    "./openbrowse-telegram-state.json";
  const notificationLevel: TelegramNotificationLevel =
    overrides.notificationLevel ??
    (process.env.OPENBROWSE_TELEGRAM_NOTIFY_LEVEL === "verbose" ? "verbose" : "quiet");

  if (!botToken) {
    return null;
  }

  return {
    botToken,
    chatId,
    statePath,
    pairingMode: overrides.pairingMode ?? (chatId ? "configured-only" : "claim-first-private-chat"),
    notificationLevel
  };
}
