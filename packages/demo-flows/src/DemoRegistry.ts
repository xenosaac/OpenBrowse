import type { BrowserSession, PageModel, TaskIntent, TaskRun, WorkflowEvent } from "@openbrowse/contracts";
import type { PlannerGateway } from "@openbrowse/planner";
import { StubBrowserKernel } from "@openbrowse/browser-runtime";
import { bootstrapRun, type RuntimeServices } from "@openbrowse/runtime-core";

export interface DemoDescriptor {
  id: string;
  label: string;
  category: "research" | "booking" | "monitor";
  description: string;
  supportsWatch: boolean;
}

export interface DemoRegistry {
  list(): DemoDescriptor[];
  run(demoId: string, services: RuntimeServices): Promise<TaskRun>;
  registerWatch(demoId: string, services: RuntimeServices, intervalMinutes: number): Promise<string>;
  resolveServicesForIntent(intent: TaskIntent, services: RuntimeServices): Promise<RuntimeServices | null>;
  resolveServicesForRun(run: TaskRun, services: RuntimeServices): Promise<RuntimeServices | null>;
}

export interface DemoExecutionContext {
  plannerDecisionCount: number;
  pageObservationCount: number;
  run?: TaskRun;
}

export interface DemoEntry {
  descriptor: DemoDescriptor;
  createIntent: () => TaskIntent;
  createDemoPlanner?: (context: DemoExecutionContext) => {
    planner: PlannerGateway;
    pageModelOverride?: (session: BrowserSession) => PageModel | undefined;
  };
  registerWatch?: (services: RuntimeServices, intervalMinutes: number) => Promise<string>;
}

export class DefaultDemoRegistry implements DemoRegistry {
  private readonly demos = new Map<string, DemoEntry>();

  register(entry: DemoEntry): void {
    this.demos.set(entry.descriptor.id, entry);
  }

  list(): DemoDescriptor[] {
    return [...this.demos.values()].map((entry) => entry.descriptor);
  }

  async run(demoId: string, services: RuntimeServices): Promise<TaskRun> {
    const entry = this.demos.get(demoId);
    if (!entry) throw new Error(`Unknown demo: ${demoId}`);
    return bootstrapRun(services, entry.createIntent());
  }

  async registerWatch(demoId: string, services: RuntimeServices, intervalMinutes: number): Promise<string> {
    const entry = this.demos.get(demoId);
    if (!entry) throw new Error(`Unknown demo: ${demoId}`);
    if (!entry.descriptor.supportsWatch || !entry.registerWatch) {
      throw new Error(`Demo "${demoId}" does not support watch scheduling`);
    }
    return entry.registerWatch(services, intervalMinutes);
  }

  async resolveServicesForIntent(intent: TaskIntent, services: RuntimeServices): Promise<RuntimeServices | null> {
    const demoId = intent.metadata.demo;
    if (!demoId) return null;
    const entry = this.demos.get(demoId);
    if (!entry?.createDemoPlanner) return null;
    return this.buildDemoServices(entry, services, { plannerDecisionCount: 0, pageObservationCount: 0 });
  }

  async resolveServicesForRun(run: TaskRun, services: RuntimeServices): Promise<RuntimeServices | null> {
    const demoId = run.metadata.demo;
    if (!demoId) return null;
    const entry = this.demos.get(demoId);
    if (!entry?.createDemoPlanner) return null;
    const events = await services.workflowLogStore.listByRun(run.id);
    return this.buildDemoServices(entry, services, {
      plannerDecisionCount: this.countEvents(events, "planner_decision"),
      pageObservationCount: this.countEvents(events, "page_modeled"),
      run
    });
  }

  private buildDemoServices(
    entry: DemoEntry,
    services: RuntimeServices,
    context: DemoExecutionContext
  ): RuntimeServices {
    const demoPlanner = entry.createDemoPlanner?.(context);
    if (!demoPlanner) return services;
    const demoBrowserKernel = new StubBrowserKernel();
    if (demoPlanner.pageModelOverride) {
      demoBrowserKernel.setPageModelOverride(demoPlanner.pageModelOverride);
    }
    return {
      ...services,
      planner: demoPlanner.planner,
      browserKernel: demoBrowserKernel,
      browserKernelInit: undefined
    };
  }

  private countEvents(events: WorkflowEvent[], type: WorkflowEvent["type"]): number {
    return events.reduce((count, event) => count + (event.type === type ? 1 : 0), 0);
  }
}
