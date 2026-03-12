import type { RuntimeServices } from "../runtime/composeRuntime";

export interface IpcSurface {
  register(channel: string, handlerName: string): void;
}

export function registerIpcHandlers(_services: RuntimeServices, ipc: IpcSurface): void {
  ipc.register("task:start", "bootstrapRun");
  ipc.register("task:resume", "handleInboundMessage");
  ipc.register("shell:tabs:list", "listTabs");
}

