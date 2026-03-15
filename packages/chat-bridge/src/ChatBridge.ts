import type { ClarificationRequest, OutboundMessage, TaskMessage } from "@openbrowse/contracts";

export interface ChatBridge {
  send(message: OutboundMessage): Promise<void>;
  sendClarification(request: ClarificationRequest): Promise<void>;
  normalizeInbound(message: TaskMessage): Promise<TaskMessage>;
  /** Returns true when the bridge is configured to forward every browser action
   *  step to the remote channel. Used by the runtime to gate verbose step messages. */
  shouldSendStepProgress(): boolean;
  /** Called when a run terminates. Implementations should clean up any pending
   *  channel state (e.g. remove stale Telegram inline keyboards). Optional so
   *  implementations that have no cleanup work can omit it. */
  clearRunState?(runId: string): Promise<void>;
}

export class StubChatBridge implements ChatBridge {
  async send(_message: OutboundMessage): Promise<void> {}

  async sendClarification(_request: ClarificationRequest): Promise<void> {}

  async normalizeInbound(message: TaskMessage): Promise<TaskMessage> {
    return message;
  }

  shouldSendStepProgress(): boolean {
    return false;
  }
}

