export type EventHandler<TPayload> = (payload: TPayload) => void | Promise<void>;

export class EventBus<TEvents extends Record<string, unknown>> {
  private readonly handlers = new Map<keyof TEvents, EventHandler<unknown>[]>();

  subscribe<TKey extends keyof TEvents>(eventName: TKey, handler: EventHandler<TEvents[TKey]>): void {
    const existing = this.handlers.get(eventName) ?? [];
    existing.push(handler as EventHandler<unknown>);
    this.handlers.set(eventName, existing);
  }

  async publish<TKey extends keyof TEvents>(eventName: TKey, payload: TEvents[TKey]): Promise<void> {
    const handlers = this.handlers.get(eventName) ?? [];

    for (const handler of handlers) {
      await handler(payload);
    }
  }
}

