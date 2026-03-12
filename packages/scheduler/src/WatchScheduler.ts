import type { TaskIntent } from "@openbrowse/contracts";

export interface WatchScheduler {
  registerWatch(intent: TaskIntent, intervalMinutes: number): Promise<void>;
}

export class StubWatchScheduler implements WatchScheduler {
  async registerWatch(_intent: TaskIntent, _intervalMinutes: number): Promise<void> {}
}

