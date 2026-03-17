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
  lastExtractedData?: Array<{ label: string; value: string }>;
}

export interface WatchScheduler {
  registerWatch(intent: TaskIntent, intervalMinutes: number): Promise<string>;
  unregisterWatch?(watchId: string): Promise<void>;
  listWatches?(): Promise<RegisteredWatch[]>;
  setOnChanged?(cb: () => void): void;
  getWatchData?(watchId: string): Array<{ label: string; value: string }> | undefined;
  updateWatchData?(watchId: string, data: Array<{ label: string; value: string }>): void;
  dispose?(): Promise<void>;
}

export type WatchDispatcher = (intent: TaskIntent, watchId: string) => Promise<void>;

export interface WatchRetryPolicy {
  minuteMs?: number;
  multiplier?: number;
  maxBackoffMinutes?: number;
}

export interface WatchSchedulerOptions extends WatchRetryPolicy {
  onChanged?: () => void;
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
  private _onChanged?: () => void;

  constructor(
    private readonly dispatch: WatchDispatcher,
    options: WatchSchedulerOptions = {}
  ) {
    this.minuteMs = options.minuteMs ?? 60_000;
    this.multiplier = options.multiplier ?? 2;
    this.maxBackoffMinutes = options.maxBackoffMinutes ?? 60;
    this._onChanged = options.onChanged;
  }

  /** Set or replace the change callback (called on register, unregister, updateWatchData). */
  setOnChanged(cb: () => void): void {
    this._onChanged = cb;
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
    this._onChanged?.();
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
      await this.dispatch(runtime.descriptor.intent, watchId);
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
    this._onChanged?.();
  }

  async listWatches(): Promise<RegisteredWatch[]> {
    return [...this.watches.values()].map((runtime) => ({ ...runtime.descriptor }));
  }

  getWatchData(watchId: string): Array<{ label: string; value: string }> | undefined {
    return this.watches.get(watchId)?.descriptor.lastExtractedData;
  }

  updateWatchData(watchId: string, data: Array<{ label: string; value: string }>): void {
    const runtime = this.watches.get(watchId);
    if (runtime) {
      runtime.descriptor.lastExtractedData = data;
      this._onChanged?.();
    }
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
