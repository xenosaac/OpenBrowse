import type { BrowserKernel } from "@openbrowse/browser-runtime";
import type { BrowserSession, TaskRun } from "@openbrowse/contracts";

/**
 * Manages browser session lifecycle with a reverse index (runId → sessionIds)
 * to prevent session orphaning on resume.
 */
export class SessionManager {
  private readonly runSessions = new Map<string, Set<string>>();

  constructor(private readonly browserKernel: BrowserKernel) {}

  /**
   * Create an additional browser session (tab) for a run without
   * cleaning up existing sessions. Used for multi-tab agent work.
   */
  async openAdditionalTab(
    run: TaskRun
  ): Promise<{ session: BrowserSession; profileId: string }> {
    const profile = await this.browserKernel.ensureProfile(run.profileId);
    const session = await this.browserKernel.attachSession(profile, {
      runId: run.id,
      groupId: run.id,
      taskLabel: run.goal,
      source: run.source,
      status: run.status,
      isBackground: run.source !== "desktop"
    });
    this.track(run.id, session.id);
    return { session, profileId: profile.id };
  }

  async attachForRun(
    run: TaskRun,
    options: { reuse?: boolean } = {}
  ): Promise<{ session: BrowserSession; profileId: string }> {
    // Attempt to reuse active session if requested
    if (options.reuse && run.checkpoint.browserSessionId) {
      const existing = await this.browserKernel.getSession(run.checkpoint.browserSessionId);
      if (existing && existing.state !== "terminated") {
        this.track(run.id, existing.id);
        return { session: existing, profileId: existing.profileId };
      }
    }

    // Clean up orphaned sessions before creating a new one
    await this.cleanupOrphans(run.id);

    const profile = await this.browserKernel.ensureProfile(run.profileId);
    const session = await this.browserKernel.attachSession(profile, {
      runId: run.id,
      groupId: run.id,
      taskLabel: run.goal,
      source: run.source,
      status: run.status,
      isBackground: run.source !== "desktop"
    });

    this.track(run.id, session.id);
    return { session, profileId: profile.id };
  }

  sessionIdsForRun(runId: string): string[] {
    return [...(this.runSessions.get(runId) ?? [])];
  }

  async cleanupRun(runId: string): Promise<void> {
    const ids = this.runSessions.get(runId);
    if (!ids) return;
    for (const id of ids) {
      try { await this.browserKernel.destroySession(id); } catch { /* already gone */ }
    }
    this.runSessions.delete(runId);
  }

  async cleanupOrphans(runId: string, keepId?: string): Promise<void> {
    const ids = this.runSessions.get(runId);
    if (!ids) return;
    for (const id of ids) {
      if (id === keepId) continue;
      try { await this.browserKernel.destroySession(id); } catch { /* already gone */ }
    }
    if (keepId && ids.has(keepId)) {
      this.runSessions.set(runId, new Set([keepId]));
    } else {
      this.runSessions.delete(runId);
    }
  }

  async getSession(sessionId: string): Promise<BrowserSession | null> {
    return this.browserKernel.getSession(sessionId);
  }

  private track(runId: string, sessionId: string): void {
    let set = this.runSessions.get(runId);
    if (!set) { set = new Set(); this.runSessions.set(runId, set); }
    set.add(sessionId);
  }
}
