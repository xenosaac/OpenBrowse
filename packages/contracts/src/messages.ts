export type MessageChannel = "desktop" | "telegram";

export interface TaskMessage {
  id: string;
  channel: MessageChannel;
  runId?: string;
  text: string;
  createdAt: string;
}

export interface OutboundMessage {
  channel: MessageChannel;
  runId: string;
  text: string;
}

