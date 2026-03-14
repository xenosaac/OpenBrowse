export type TelegramPairingMode = "configured-only" | "claim-first-private-chat";

export interface TelegramConfig {
  botToken: string;
  chatId?: string;
  statePath: string;
  pairingMode: TelegramPairingMode;
}

export function resolveTelegramConfig(overrides: Partial<TelegramConfig> = {}): TelegramConfig | null {
  const botToken = overrides.botToken ?? process.env.OPENBROWSE_TELEGRAM_BOT_TOKEN;
  const chatId = overrides.chatId ?? process.env.OPENBROWSE_TELEGRAM_CHAT_ID;
  const statePath =
    overrides.statePath ??
    process.env.OPENBROWSE_TELEGRAM_STATE_PATH ??
    "./openbrowse-telegram-state.json";

  if (!botToken) {
    return null;
  }

  return {
    botToken,
    chatId,
    statePath,
    pairingMode: overrides.pairingMode ?? (chatId ? "configured-only" : "claim-first-private-chat")
  };
}
