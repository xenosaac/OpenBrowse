import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

interface PendingClarificationRecord {
  requestId: string;
  runId: string;
  chatId: string;
  messageId: number;
  createdAt: string;
}

interface TelegramBridgeState {
  primaryChatId: string | null;
  approvedChatIds: string[];
  pendingClarifications: Record<string, PendingClarificationRecord>;
  replyTargets: Record<string, string>;
}

function createDefaultState(): TelegramBridgeState {
  return {
    primaryChatId: null,
    approvedChatIds: [],
    pendingClarifications: {},
    replyTargets: {}
  };
}

function replyTargetKey(chatId: string, messageId: number): string {
  return `${chatId}:${messageId}`;
}

export class TelegramStateStore {
  private state: TelegramBridgeState = createDefaultState();

  constructor(private readonly statePath: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.statePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<TelegramBridgeState>;
      this.state = {
        primaryChatId: parsed.primaryChatId ?? null,
        approvedChatIds: parsed.approvedChatIds ?? [],
        pendingClarifications: parsed.pendingClarifications ?? {},
        replyTargets: parsed.replyTargets ?? {}
      };
    } catch {
      this.state = createDefaultState();
    }
  }

  getPrimaryChatId(): string | null {
    return this.state.primaryChatId;
  }

  listApprovedChatIds(): string[] {
    return [...this.state.approvedChatIds];
  }

  hasApprovedChat(chatId: string): boolean {
    return this.state.approvedChatIds.includes(chatId);
  }

  hasAnyApprovedChats(): boolean {
    return this.state.approvedChatIds.length > 0;
  }

  async approveChat(chatId: string): Promise<void> {
    if (!this.state.approvedChatIds.includes(chatId)) {
      this.state.approvedChatIds.push(chatId);
    }

    if (!this.state.primaryChatId) {
      this.state.primaryChatId = chatId;
    }

    await this.persist();
  }

  async registerClarification(params: {
    requestId: string;
    runId: string;
    chatId: string;
    messageId: number;
    createdAt: string;
  }): Promise<void> {
    this.state.pendingClarifications[params.requestId] = {
      requestId: params.requestId,
      runId: params.runId,
      chatId: params.chatId,
      messageId: params.messageId,
      createdAt: params.createdAt
    };
    this.state.replyTargets[replyTargetKey(params.chatId, params.messageId)] = params.requestId;
    await this.persist();
  }

  async resolveByRequestId(requestId: string, chatId: string): Promise<string | null> {
    const record = this.state.pendingClarifications[requestId];
    if (!record || record.chatId !== chatId) {
      return null;
    }

    delete this.state.pendingClarifications[requestId];
    delete this.state.replyTargets[replyTargetKey(record.chatId, record.messageId)];
    await this.persist();
    return record.runId;
  }

  async resolveByReplyTarget(chatId: string, messageId: number): Promise<string | null> {
    const requestId = this.state.replyTargets[replyTargetKey(chatId, messageId)];
    if (!requestId) {
      return null;
    }

    return this.resolveByRequestId(requestId, chatId);
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    await writeFile(this.statePath, JSON.stringify(this.state, null, 2), "utf-8");
  }
}
