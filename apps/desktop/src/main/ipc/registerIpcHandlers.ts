import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import type { TaskIntent, TaskMessage } from "@openbrowse/contracts";
import { LogReplayer } from "@openbrowse/observability";
import {
  bootstrapRunDetached,
  cancelTrackedRun,
  describeRuntime,
  getRuntimeSettings,
  handleInboundMessage,
  saveRuntimeSettings,
  type RuntimeServices
} from "@openbrowse/runtime-core";
import { listTaskPacks, getTaskPack } from "@openbrowse/taskpacks";
import type { DemoRegistry } from "@openbrowse/demo-flows";
import type { AppBrowserShell } from "../browser/AppBrowserShell";
import type { BrowserViewportBounds, RuntimeSettings } from "@openbrowse/contracts";

export interface IpcSurface {
  register(channel: string, handlerName: string): void;
}

export function registerIpcHandlers(
  services: RuntimeServices,
  browserShell: AppBrowserShell,
  mainWindow: BrowserWindow,
  demoRegistry: DemoRegistry
): void {
  const replayer = new LogReplayer(services.workflowLogStore);

  const register = (
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<unknown>
  ): void => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, handler);
  };

  register("task:start", async (_event, intent: TaskIntent) => {
    const run = await bootstrapRunDetached(services, intent, async (updatedRun) => {
      mainWindow.webContents.send("runtime:event", { type: "run_updated", run: updatedRun });
    });
    mainWindow.webContents.send("runtime:event", { type: "run_updated", run });
    return run;
  });

  register("task:resume", async (_event, message: TaskMessage) => {
    const run = await handleInboundMessage(services, message);
    if (run) {
      mainWindow.webContents.send("runtime:event", { type: "run_updated", run });
    }
    return run;
  });

  register("task:cancel", async (_event, runId: string) => {
    const run = await cancelTrackedRun(services, runId, "Run cancelled by user.");
    if (run) {
      mainWindow.webContents.send("runtime:event", { type: "run_updated", run });
    }
    return run;
  });

  register("runs:list", async () => {
    const store = services.runCheckpointStore;
    const running = await store.listByStatus("running");
    const suspended = await store.listByStatus("suspended_for_clarification");
    const approvals = await store.listByStatus("suspended_for_approval");
    const completed = await store.listByStatus("completed");
    const failed = await store.listByStatus("failed");
    const cancelled = await store.listByStatus("cancelled");
    const allRuns = [...running, ...suspended, ...approvals, ...completed, ...failed, ...cancelled];
    return allRuns;
  });

  register("runs:get", async (_event, runId: string) => {
    return services.runCheckpointStore.load(runId);
  });

  register("profiles:list", async () => {
    return services.browserKernel.listProfiles();
  });

  register("runtime:describe", async () => {
    return describeRuntime(services);
  });

  register("settings:get", async () => {
    return getRuntimeSettings(services);
  });

  register("settings:save", async (_event, settings: RuntimeSettings) => {
    const saved = await saveRuntimeSettings(services, settings);
    const descriptor = describeRuntime(services);
    mainWindow.webContents.send("runtime:event", {
      type: "runtime_ready",
      descriptor
    });
    return { settings: saved, descriptor };
  });

  register("logs:list", async (_event, runId: string) => {
    return services.workflowLogStore.listByRun(runId);
  });

  register("logs:replay", async (_event, runId: string) => {
    return replayer.replay(runId);
  });

  register("shell:tabs:list", async () => {
    const allRuns = await services.runCheckpointStore.listAll();
    const runtimeSessions = await services.browserKernel.listSessions();
    const sessionMap = new Map(runtimeSessions.map((session) => [session.runId, session]));

    return allRuns
      .filter((run) => run.checkpoint.browserSessionId)
      .map((run) => {
        const session = sessionMap.get(run.id);
        if (!session) {
          return null;
        }

        return {
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
        };
      })
      .filter((tab): tab is NonNullable<typeof tab> => Boolean(tab))
      .sort((a, b) => {
        const aRun = allRuns.find((run) => run.id === a.runId);
        const bRun = allRuns.find((run) => run.id === b.runId);
        return (bRun?.updatedAt ?? "").localeCompare(aRun?.updatedAt ?? "");
      });
  });

  // Demo registry handlers
  register("demo:list", async () => {
    return demoRegistry.list();
  });

  register("demo:run", async (_event, demoId: string) => {
    const run = await demoRegistry.run(demoId, services);
    mainWindow.webContents.send("runtime:event", { type: "run_updated", run });
    return run;
  });

  register("demo:watch", async (_event, params: { demoId: string; intervalMinutes: number }) => {
    const watchId = await demoRegistry.registerWatch(params.demoId, services, params.intervalMinutes);
    return watchId;
  });

  register("taskpacks:list", async () => {
    const plannerIsLive = services.descriptor.planner.mode === "live";
    return listTaskPacks().map((p) => ({
      id: p.id,
      label: p.label,
      category: p.category,
      description: p.description,
      requiresLivePlanner: p.requiresLivePlanner,
      available: !p.requiresLivePlanner || plannerIsLive,
      unavailableReason: p.requiresLivePlanner && !plannerIsLive
        ? "Requires a live AI planner. Set ANTHROPIC_API_KEY to enable."
        : undefined
    }));
  });

  register("taskpacks:run", async (_event, packId: string) => {
    const pack = getTaskPack(packId);
    if (!pack) throw new Error(`Unknown task pack: ${packId}`);

    if (pack.requiresLivePlanner && services.descriptor.planner.mode !== "live") {
      throw new Error(
        `Task pack "${pack.label}" requires a live AI planner, but the planner is in ${services.descriptor.planner.mode} mode. Configure ANTHROPIC_API_KEY to enable live task packs.`
      );
    }

    const intent = pack.createIntent();
    const run = await bootstrapRunDetached(services, intent, async (updatedRun) => {
      mainWindow.webContents.send("runtime:event", { type: "run_updated", run: updatedRun });
    });
    mainWindow.webContents.send("runtime:event", { type: "run_updated", run });
    return run;
  });

  register("browser:show", async (_event, sessionId: string) => {
    browserShell.showSession(sessionId);
    return { ok: true };
  });

  register("browser:hide", async () => {
    browserShell.hideAllSessions();
    return { ok: true };
  });

  register("browser:active", async () => {
    return browserShell.getActiveSessionId();
  });

  register("browser:viewport:set", async (_event, bounds: BrowserViewportBounds) => {
    browserShell.setViewportBounds(bounds);
    return { ok: true };
  });

  register("browser:viewport:clear", async () => {
    browserShell.clearViewportBounds();
    return { ok: true };
  });

  register("browser:close-group", async (_event, groupId: string) => {
    const run = await cancelTrackedRun(services, groupId, "Run cancelled from browser group close.");
    if (run) {
      mainWindow.webContents.send("runtime:event", { type: "run_updated", run });
    }
    return run;
  });
}
