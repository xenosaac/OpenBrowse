import type { ClarificationRequest, OutboundMessage, TaskMessage } from "@openbrowse/contracts";

export interface ChatBridge {
  send(message: OutboundMessage): Promise<void>;
  sendClarification(request: ClarificationRequest): Promise<void>;
  normalizeInbound(message: TaskMessage): Promise<TaskMessage>;
}

export class StubChatBridge implements ChatBridge {
  async send(_message: OutboundMessage): Promise<void> {}

  async sendClarification(_request: ClarificationRequest): Promise<void> {}

  async normalizeInbound(message: TaskMessage): Promise<TaskMessage> {
    return message;
  }
}

