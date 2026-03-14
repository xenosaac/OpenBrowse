import type { BrowserShellTabDescriptor, TaskRun } from "@openbrowse/contracts";
import type { RuntimeServices } from "./types.js";

/**
 * Returns all runs across all statuses, sorted by most recently updated first.
 */
export async function listAllRuns(services: RuntimeServices): Promise<TaskRun[]> {
  const runs = await services.runCheckpointStore.listAll();
  return runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Derives shell tab descriptors by cross-joining active runs with live browser
 * sessions. This is the canonical source for the shell:tabs:list IPC channel.
 */
export async function queryShellTabs(services: RuntimeServices): Promise<BrowserShellTabDescriptor[]> {
  const allRuns = await services.runCheckpointStore.listAll();
  const runtimeSessions = await services.browserKernel.listSessions();
  const sessionMap = new Map(runtimeSessions.map((s) => [s.runId, s]));

  const tabs: BrowserShellTabDescriptor[] = [];

  for (const run of allRuns) {
    if (!run.checkpoint.browserSessionId) continue;
    const session = sessionMap.get(run.id);
    if (!session) continue;

    tabs.push({
      id: session.id,
      runId: run.id,
      groupId: run.id,
      title: run.goal,
      url: session.pageUrl || run.checkpoint.lastKnownUrl || "about:blank",
      profileId: session.profileId,
      source: run.source,
      status: run.status,
      isBackground: run.source === "scheduler",
      closable: true
    });
  }

  return tabs.sort((a, b) => {
    const aRun = allRuns.find((r) => r.id === a.runId);
    const bRun = allRuns.find((r) => r.id === b.runId);
    return (bRun?.updatedAt ?? "").localeCompare(aRun?.updatedAt ?? "");
  });
}
