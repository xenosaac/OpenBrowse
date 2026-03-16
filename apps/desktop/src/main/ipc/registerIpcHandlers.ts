import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import type { TaskIntent, TaskMessage } from "@openbrowse/contracts";
import { LogReplayer } from "@openbrowse/observability";
import {
  bootstrapRunDetached,
  buildHandoffArtifact,
  cancelTrackedRun,
  describeRuntime,
  getRuntimeSettings,
  handleInboundMessageDetached,
  listAllRuns,
  queryShellTabs,
  renderHandoffMarkdown,
  saveRuntimeSettings,
  type RuntimeServices
} from "@openbrowse/runtime-core";
import { listTaskPacks, getTaskPack } from "@openbrowse/taskpacks";
import type { DemoRegistry } from "@openbrowse/demo-flows";
import type { AppBrowserShell } from "../browser/AppBrowserShell";
import type { BrowserViewportBounds, RuntimeSettings } from "@openbrowse/contracts";

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

  // Wire up navigation events — forward to renderer so the address bar stays in sync.
  // Also auto-record browsing history if the store is available.
  browserShell.setNavigationCallback((sessionId, url, title) => {
    mainWindow.webContents.send("runtime:event", { type: "tab_navigated", sessionId, url, title });
    if (services.browsingHistoryStore && url && url !== "about:blank" && !url.startsWith("chrome://")) {
      const id = `hist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      services.browsingHistoryStore.record({ id, url, title: title ?? url, visitedAt: new Date().toISOString() }).catch(() => {});
    }
  });

  browserShell.setLoadingCallback((sessionId, isLoading) => {
    mainWindow.webContents.send("runtime:event", { type: "tab_loading", sessionId, isLoading });
  });

  browserShell.setFaviconCallback((sessionId, faviconUrl) => {
    mainWindow.webContents.send("runtime:event", { type: "tab_favicon", sessionId, faviconUrl });
  });

  register("task:start", async (_event, intent: TaskIntent) => {
    const run = await bootstrapRunDetached(services, intent, async (updatedRun) => {
      mainWindow.webContents.send("runtime:event", { type: "run_updated", run: updatedRun });
    });
    // If the agent reused a standalone tab, release it from standalone tracking
    // so we don't end up with two tab-bar entries for the same WebContentsView.
    if (run.checkpoint.browserSessionId && browserShell.isStandaloneTab(run.checkpoint.browserSessionId)) {
      browserShell.releaseStandaloneTab(run.checkpoint.browserSessionId);
      mainWindow.webContents.send("runtime:event", {
        type: "standalone_tab_closed",
        tabId: run.checkpoint.browserSessionId
      });
    }
    mainWindow.webContents.send("runtime:event", { type: "run_updated", run });
    return run;
  });

  register("task:resume", async (_event, message: TaskMessage) => {
    // Use the detached variant so the renderer gets an immediate response with the
    // session-attached run (browserSessionId is set), while the planner loop continues
    // in the background and sends a final run_updated when it settles.
    const run = await handleInboundMessageDetached(services, message, async (updatedRun) => {
      mainWindow.webContents.send("runtime:event", { type: "run_updated", run: updatedRun });
    });
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
    return listAllRuns(services);
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
    mainWindow.webContents.send("runtime:event", { type: "runtime_ready", descriptor });
    return { settings: saved, descriptor };
  });

  register("logs:list", async (_event, runId: string) => {
    return services.workflowLogStore.listByRun(runId);
  });

  register("logs:replay", async (_event, runId: string) => {
    return replayer.replay(runId);
  });

  // Merge agent-run tabs with standalone tabs for the unified tab bar.
  register("shell:tabs:list", async () => {
    const agentTabs = await queryShellTabs(services);
    const standaloneTabs = browserShell.listStandaloneTabs();
    return [...standaloneTabs, ...agentTabs];
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
    return demoRegistry.registerWatch(params.demoId, services, params.intervalMinutes);
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
      unavailableReason:
        p.requiresLivePlanner && !plannerIsLive
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

  // Handles both standalone tabs and agent-run groups.
  register("browser:close-group", async (_event, groupId: string) => {
    if (browserShell.isStandaloneTab(groupId)) {
      browserShell.closeStandaloneTab(groupId);
      mainWindow.webContents.send("runtime:event", { type: "standalone_tab_closed", tabId: groupId });
      return null;
    }
    const run = await cancelTrackedRun(services, groupId, "Run cancelled from browser group close.");
    if (run) {
      mainWindow.webContents.send("runtime:event", { type: "run_updated", run });
    }
    return run;
  });

  // --- Browser navigation ---

  register("browser:new-tab", async (_event, url?: string) => {
    const tab = browserShell.createStandaloneTab(url ?? "about:blank");
    mainWindow.webContents.send("runtime:event", { type: "standalone_tab_created", tab });
    return tab;
  });

  register("browser:navigate", async (_event, { sessionId, url }: { sessionId: string; url: string }) => {
    browserShell.navigateTo(sessionId, url);
    return { ok: true };
  });

  register("browser:back", async (_event, sessionId: string) => {
    browserShell.goBack(sessionId);
    return { ok: true };
  });

  register("browser:forward", async (_event, sessionId: string) => {
    browserShell.goForward(sessionId);
    return { ok: true };
  });

  register("browser:reload", async (_event, sessionId: string) => {
    browserShell.reload(sessionId);
    return { ok: true };
  });

  register("browser:nav-state", async (_event, sessionId: string) => {
    return browserShell.getNavState(sessionId);
  });

  register("browser:devtools", async (_event, sessionId: string) => {
    browserShell.openDevTools(sessionId);
    return { ok: true };
  });

  register("browser:print", async (_event, sessionId: string) => {
    browserShell.printPage(sessionId);
    return { ok: true };
  });

  register("browser:save-pdf", async (_event, sessionId: string) => {
    return browserShell.saveAsPdf(sessionId);
  });

  register("run:handoff", async (_event, runId: string) => {
    const run = await services.runCheckpointStore.load(runId);
    if (!run) return null;
    const artifact = buildHandoffArtifact(run);
    const markdown = renderHandoffMarkdown(artifact);
    return { artifact, markdown };
  });

  // --- Bookmarks ---
  if (services.bookmarkStore) {
    const bookmarks = services.bookmarkStore;

    register("bookmarks:list", async () => bookmarks.listAll());

    register("bookmarks:get-by-url", async (_event, url: string) => bookmarks.getByUrl(url));

    register("bookmarks:add", async (_event, data: { url: string; title: string; faviconUrl?: string }) => {
      const id = `bk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await bookmarks.create({
        id, url: data.url, title: data.title, tags: [],
        faviconUrl: data.faviconUrl, createdAt: new Date().toISOString()
      });
      return { id };
    });

    register("bookmarks:delete", async (_event, id: string) => bookmarks.delete(id));

    register("bookmarks:search", async (_event, query: string) => bookmarks.search(query));
  }

  // --- Chat Sessions ---
  if (services.chatSessionStore) {
    const chatStore = services.chatSessionStore;

    register("chat:sessions:list", async () => {
      const sessions = await chatStore.listSessions();
      const result = [];
      for (const s of sessions) {
        const messages = await chatStore.listMessages(s.id);
        const runIds = await chatStore.listRunIds(s.id);
        result.push({ ...s, messages, runIds });
      }
      return result;
    });

    register("chat:sessions:create", async (_event, data: { id: string; title: string; createdAt: string }) => {
      await chatStore.createSession({ ...data, updatedAt: data.createdAt });
    });

    register("chat:sessions:delete", async (_event, sessionId: string) => {
      return chatStore.deleteSession(sessionId);
    });

    register("chat:sessions:update-title", async (_event, data: { sessionId: string; title: string }) => {
      await chatStore.updateTitle(data.sessionId, data.title);
    });

    register("chat:messages:append", async (_event, msg: {
      id: string; sessionId: string; role: string; content: string; tone?: string; createdAt: string
    }) => {
      await chatStore.appendMessage(msg);
    });

    register("chat:messages:clear", async (_event, sessionId: string) => {
      await chatStore.clearMessages(sessionId);
    });

    register("chat:runs:link", async (_event, data: { sessionId: string; runId: string }) => {
      await chatStore.linkRun(data.sessionId, data.runId);
    });
  }

  // --- Browsing History ---
  if (services.browsingHistoryStore) {
    const history = services.browsingHistoryStore;

    register("history:list", async (_event, limit?: number) => history.listRecent(limit ?? 100));

    register("history:search", async (_event, query: string) => history.search(query));

    register("history:clear", async () => history.deleteAll());

  }
}
