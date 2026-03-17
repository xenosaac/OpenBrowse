import type { TaskRun, WorkflowEvent } from "@openbrowse/contracts";
import type {
  BrowserShellTabDescriptor,
  RecoverySummary,
  RuntimeDescriptor
} from "../../shared/runtime";

export type RuntimeEvent =
  | { type: "runtime_ready"; descriptor?: RuntimeDescriptor }
  | { type: "run_updated"; run?: TaskRun }
  | { type: "recovery_complete"; report?: RecoverySummary }
  | { type: "workflow_event"; event?: WorkflowEvent }
  | { type: "tab_navigated"; sessionId?: string; url?: string; title?: string }
  | { type: "standalone_tab_created"; tab?: BrowserShellTabDescriptor }
  | { type: "standalone_tab_closed"; tabId?: string }
  | { type: "tab_loading"; sessionId?: string; isLoading?: boolean }
  | { type: "tab_favicon"; sessionId?: string; faviconUrl?: string }
  | { type: "find_in_page_result"; sessionId?: string; activeMatchOrdinal?: number; matches?: number; finalUpdate?: boolean }
  | { type: "tab_load_error"; sessionId?: string; errorCode?: number; errorDescription?: string; url?: string }
  | { type: "download_updated"; id?: string; filename?: string; url?: string; savePath?: string; totalBytes?: number; receivedBytes?: number; state?: "progressing" | "completed" | "cancelled" | "interrupted" };

type Subscriber = (event: RuntimeEvent) => void;

/**
 * Thin pub/sub singleton that connects to `window.openbrowse.onRuntimeEvent`
 * and fans out to domain-specific subscribers. Each hook subscribes independently
 * and only processes events it cares about.
 */
class RuntimeEventBus {
  private subscribers = new Set<Subscriber>();
  private unsubscribeIpc: (() => void) | null = null;

  connect(): void {
    if (this.unsubscribeIpc) return;
    this.unsubscribeIpc = window.openbrowse.onRuntimeEvent((raw: unknown) => {
      const event = raw as RuntimeEvent;
      for (const sub of this.subscribers) {
        try { sub(event); } catch (err) {
          console.error("[eventBus] Subscriber error:", err);
        }
      }
    });
  }

  disconnect(): void {
    this.unsubscribeIpc?.();
    this.unsubscribeIpc = null;
  }

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => { this.subscribers.delete(fn); };
  }
}

export const runtimeEventBus = new RuntimeEventBus();
