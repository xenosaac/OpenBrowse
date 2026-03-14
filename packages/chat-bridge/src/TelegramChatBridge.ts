import { Bot, InlineKeyboard } from "grammy";
import type { ClarificationRequest, OutboundMessage, TaskMessage } from "@openbrowse/contracts";
import type { ChatBridge } from "./ChatBridge.js";
import type { TelegramConfig } from "./TelegramConfig.js";
import { TelegramStateStore } from "./TelegramStateStore.js";

export type InboundMessageHandler = (message: TaskMessage) => Promise<void>;

export class TelegramChatBridge implements ChatBridge {
  private readonly bot: Bot;
  private readonly stateStore: TelegramStateStore;
  private onInbound: InboundMessageHandler | null = null;
  private started = false;

  constructor(private readonly config: TelegramConfig) {
    this.bot = new Bot(config.botToken);
    this.stateStore = new TelegramStateStore(config.statePath);
    this.setupListeners();
  }

  setInboundHandler(handler: InboundMessageHandler): void {
    this.onInbound = handler;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    await this.stateStore.load();
    if (this.config.chatId) {
      await this.stateStore.approveChat(this.config.chatId);
    }

    this.bot.start();
    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    await this.bot.stop();
    this.started = false;
  }

  async send(message: OutboundMessage): Promise<void> {
    const chatId = await this.resolveOutboundChatId();
    if (!chatId) {
      return;
    }

    try {
      await this.sendSplitMessages(chatId, message.text);
    } catch (err) {
      console.error("[telegram] Failed to send message:", err instanceof Error ? err.message : err);
    }
  }

  async sendClarification(request: ClarificationRequest): Promise<void> {
    const chatId = await this.resolveOutboundChatId();
    if (!chatId) {
      return;
    }

    try {
      const keyboard = new InlineKeyboard();

      for (const option of request.options) {
        keyboard.text(option.label, `clarify:${request.id}:${option.id}`).row();
      }

      const escapedContext = request.contextSummary.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
      const text = [
        `*OpenBrowse clarification*`,
        `run: \`${request.runId}\``,
        "",
        request.question,
        "",
        `_${escapedContext}_`
      ].join("\n");

      const sent = await this.bot.api.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: request.options.length > 0 ? keyboard : undefined
      });

      await this.stateStore.registerClarification({
        requestId: request.id,
        runId: request.runId,
        chatId,
        messageId: sent.message_id,
        createdAt: request.createdAt
      });
    } catch (err) {
      console.error("[telegram] Failed to send clarification:", err instanceof Error ? err.message : err);
      // Fall back to plain text without Markdown if parse failed
      try {
        const plainText = `OpenBrowse clarification\nrun: ${request.runId}\n\n${request.question}\n\n${request.contextSummary}`;
        const sent = await this.bot.api.sendMessage(chatId, plainText);
        await this.stateStore.registerClarification({
          requestId: request.id,
          runId: request.runId,
          chatId,
          messageId: sent.message_id,
          createdAt: request.createdAt
        });
      } catch (fallbackErr) {
        console.error("[telegram] Fallback send also failed:", fallbackErr instanceof Error ? fallbackErr.message : fallbackErr);
      }
    }
  }

  async normalizeInbound(message: TaskMessage): Promise<TaskMessage> {
    return message;
  }

  private async sendSplitMessages(chatId: string, text: string): Promise<void> {
    const MAX_LENGTH = 4000;
    if (text.length <= MAX_LENGTH) {
      await this.bot.api.sendMessage(chatId, text);
      return;
    }

    const lines = text.split("\n");
    let chunk = "";
    for (const line of lines) {
      if (chunk.length + line.length + 1 > MAX_LENGTH && chunk.length > 0) {
        await this.bot.api.sendMessage(chatId, chunk);
        chunk = "";
      }
      chunk += (chunk.length > 0 ? "\n" : "") + line;
    }
    if (chunk.length > 0) {
      await this.bot.api.sendMessage(chatId, chunk);
    }
  }

  private async resolveOutboundChatId(): Promise<string | null> {
    if (this.config.chatId) {
      return this.config.chatId;
    }

    return this.stateStore.getPrimaryChatId();
  }

  private setupListeners(): void {
    this.bot.on("callback_query:data", async (ctx) => {
      const authorization = await this.ensureAuthorizedPrivateChat(ctx);
      if (authorization.kind !== "accepted") {
        return;
      }

      const data = ctx.callbackQuery.data;
      if (!data.startsWith("clarify:")) {
        return;
      }

      const [, requestId, optionId] = data.split(":");
      const runId = await this.stateStore.resolveByRequestId(requestId, authorization.chatId);

      if (!runId) {
        await ctx.answerCallbackQuery({ text: "This clarification has expired." });
        return;
      }

      await ctx.answerCallbackQuery({ text: "Answer received." });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });

      if (this.onInbound) {
        await this.onInbound({
          id: `tg_${ctx.callbackQuery.id}`,
          channel: "telegram",
          runId,
          text: optionId,
          createdAt: new Date().toISOString()
        });
      }
    });

    this.bot.on("message:text", async (ctx) => {
      const authorization = await this.ensureAuthorizedPrivateChat(ctx);
      if (authorization.kind !== "accepted") {
        return;
      }

      const replyToMessageId = ctx.message.reply_to_message?.message_id;
      let runId: string | undefined;

      if (replyToMessageId) {
        runId = (await this.stateStore.resolveByReplyTarget(
          authorization.chatId,
          replyToMessageId
        )) ?? undefined;
      }

      if (this.onInbound) {
        await this.onInbound({
          id: `tg_${ctx.message.message_id}`,
          channel: "telegram",
          runId,
          text: ctx.message.text,
          createdAt: new Date().toISOString()
        });
      }
    });
  }

  private async ensureAuthorizedPrivateChat(
    ctx: {
      chat?: { id: number | string; type?: string };
      callbackQuery?: { message?: { chat?: { id: number | string; type?: string } } };
      reply?: (text: string) => Promise<unknown>;
      answerCallbackQuery?: (options: { text: string }) => Promise<unknown>;
    }
  ): Promise<{ kind: "accepted"; chatId: string } | { kind: "rejected" }> {
    const chat = ctx.chat ?? ctx.callbackQuery?.message?.chat;
    if (!chat || chat.type !== "private") {
      return { kind: "rejected" };
    }

    const chatId = String(chat.id);

    if (this.config.chatId && chatId !== this.config.chatId) {
      await this.respondUnauthorized(ctx, "This OpenBrowse instance is paired to a different Telegram chat.");
      return { kind: "rejected" };
    }

    if (this.stateStore.hasApprovedChat(chatId)) {
      return { kind: "accepted", chatId };
    }

    if (
      this.config.pairingMode === "claim-first-private-chat" &&
      !this.stateStore.hasAnyApprovedChats()
    ) {
      await this.stateStore.approveChat(chatId);
      await this.respondUnauthorized(
        ctx,
        "This chat is now paired with OpenBrowse on this Mac. Send your next message again to continue."
      );
      return { kind: "rejected" };
    }

    await this.respondUnauthorized(ctx, "This chat is not authorized for this OpenBrowse instance.");
    return { kind: "rejected" };
  }

  private async respondUnauthorized(
    ctx: {
      reply?: (text: string) => Promise<unknown>;
      answerCallbackQuery?: (options: { text: string }) => Promise<unknown>;
    },
    text: string
  ): Promise<void> {
    if (ctx.answerCallbackQuery) {
      await ctx.answerCallbackQuery({ text });
      return;
    }

    if (ctx.reply) {
      await ctx.reply(text);
    }
  }
}
