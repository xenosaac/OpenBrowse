import type { TaskIntent } from "@openbrowse/contracts";

export interface RegisteredWatch {
  id: string;
  intent: TaskIntent;
  intervalMinutes: number;
  active: boolean;
  createdAt: string;
  nextRunAt: string;
  lastTriggeredAt?: string;
  lastCompletedAt?: string;
  consecutiveFailures: number;
  lastError?: string;
  backoffUntil?: string;
}

export interface WatchScheduler {
  registerWatch(intent: TaskIntent, intervalMinutes: number): Promise<string>;
  unregisterWatch?(watchId: string): Promise<void>;
  listWatches?(): Promise<RegisteredWatch[]>;
  dispose?(): Promise<void>;
}

export type WatchDispatcher = (intent: TaskIntent) => Promise<void>;

export interface WatchRetryPolicy {
  minuteMs?: number;
  multiplier?: number;
  maxBackoffMinutes?: number;
}

interface WatchRuntime {
  descriptor: RegisteredWatch;
  timer?: ReturnType<typeof setTimeout>;
  inFlight: boolean;
}

export class StubWatchScheduler implements WatchScheduler {
  async registerWatch(_intent: TaskIntent, _intervalMinutes: number): Promise<string> {
    return "stub-watch";
  }
}

export class IntervalWatchScheduler implements WatchScheduler {
  private readonly watches = new Map<string, WatchRuntime>();
  private readonly minuteMs: number;
  private readonly multiplier: number;
  private readonly maxBackoffMinutes: number;

  constructor(
    private readonly dispatch: WatchDispatcher,
    retryPolicy: WatchRetryPolicy = {}
  ) {
    this.minuteMs = retryPolicy.minuteMs ?? 60_000;
    this.multiplier = retryPolicy.multiplier ?? 2;
    this.maxBackoffMinutes = retryPolicy.maxBackoffMinutes ?? 60;
  }

  async registerWatch(intent: TaskIntent, intervalMinutes: number): Promise<string> {
    const watchId = `watch_${intent.id}_${Date.now()}`;
    const descriptor: RegisteredWatch = {
      id: watchId,
      intent,
      intervalMinutes,
      active: true,
      createdAt: new Date().toISOString(),
      nextRunAt: new Date(Date.now() + intervalMinutes * this.minuteMs).toISOString(),
      consecutiveFailures: 0
    };

    const runtime: WatchRuntime = {
      descriptor,
      inFlight: false
    };

    this.watches.set(watchId, runtime);
    this.scheduleNext(watchId, intervalMinutes);
    return watchId;
  }

  private scheduleNext(watchId: string, delayMinutes: number): void {
    const runtime = this.watches.get(watchId);
    if (!runtime || !runtime.descriptor.active) {
      return;
    }

    if (runtime.timer) {
      clearTimeout(runtime.timer);
    }

    const delayMs = Math.max(delayMinutes * this.minuteMs, 0);
    const nextRunAt = new Date(Date.now() + delayMs).toISOString();
    runtime.descriptor.nextRunAt = nextRunAt;
    runtime.descriptor.backoffUntil =
      delayMinutes > runtime.descriptor.intervalMinutes ? nextRunAt : undefined;

    runtime.timer = setTimeout(() => {
      void this.triggerWatch(watchId);
    }, delayMs);
  }

  private async triggerWatch(watchId: string): Promise<void> {
    const runtime = this.watches.get(watchId);
    if (!runtime || !runtime.descriptor.active || runtime.inFlight) {
      return;
    }

    runtime.inFlight = true;
    runtime.descriptor.lastTriggeredAt = new Date().toISOString();

    try {
      await this.dispatch(runtime.descriptor.intent);
      runtime.descriptor.consecutiveFailures = 0;
      runtime.descriptor.lastError = undefined;
      runtime.descriptor.lastCompletedAt = new Date().toISOString();
      this.scheduleNext(watchId, runtime.descriptor.intervalMinutes);
    } catch (error) {
      runtime.descriptor.consecutiveFailures += 1;
      runtime.descriptor.lastError =
        error instanceof Error ? error.message : String(error);

      const nextDelay = Math.min(
        runtime.descriptor.intervalMinutes * this.multiplier ** runtime.descriptor.consecutiveFailures,
        this.maxBackoffMinutes
      );
      this.scheduleNext(watchId, nextDelay);
      console.error(`[scheduler] Watch ${watchId} failed:`, error);
    } finally {
      runtime.inFlight = false;
    }
  }

  async unregisterWatch(watchId: string): Promise<void> {
    const runtime = this.watches.get(watchId);
    if (!runtime) {
      return;
    }

    if (runtime.timer) {
      clearTimeout(runtime.timer);
    }
    runtime.descriptor.active = false;
    this.watches.delete(watchId);
  }

  async listWatches(): Promise<RegisteredWatch[]> {
    return [...this.watches.values()].map((runtime) => ({ ...runtime.descriptor }));
  }

  async dispose(): Promise<void> {
    for (const runtime of this.watches.values()) {
      if (runtime.timer) {
        clearTimeout(runtime.timer);
      }
    }
    this.watches.clear();
  }
}
