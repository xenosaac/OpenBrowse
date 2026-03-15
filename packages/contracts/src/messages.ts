export type MessageChannel = "desktop" | "telegram" | "scheduler";

export interface TaskMessage {
  id: string;
  channel: MessageChannel;
  runId?: string;
  /** Channel-specific routing id. For Telegram: the numeric chat_id as a string. */
  chatId?: string;
  text: string;
  createdAt: string;
}

export interface OutboundMessage {
  channel: MessageChannel;
  runId: string;
  text: string;
}

