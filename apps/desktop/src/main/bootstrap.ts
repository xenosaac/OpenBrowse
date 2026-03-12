import type { TaskIntent } from "@openbrowse/contracts";
import { AppBrowserShell } from "./browser/AppBrowserShell";
import { registerIpcHandlers } from "./ipc/registerIpcHandlers";
import { bootstrapRun, composeRuntime, type RuntimeServices } from "./runtime/composeRuntime";

export interface DesktopBootstrap {
  browserShell: AppBrowserShell;
  services: RuntimeServices;
}

export function createDesktopBootstrap(): DesktopBootstrap {
  const services = composeRuntime();
  const browserShell = new AppBrowserShell();

  registerIpcHandlers(services, {
    register(channel, handlerName) {
      void channel;
      void handlerName;
    }
  });

  return {
    browserShell,
    services
  };
}

export async function runBootstrapDemo(bootstrap: DesktopBootstrap): Promise<void> {
  const intent: TaskIntent = {
    id: "demo_travel_search",
    source: "desktop",
    goal: "Find a good travel option and ask for clarification if preferences are missing.",
    constraints: ["macOS only", "managed profile"],
    metadata: {
      productMode: "framework-scaffold"
    }
  };

  await bootstrapRun(bootstrap.services, intent);
}

