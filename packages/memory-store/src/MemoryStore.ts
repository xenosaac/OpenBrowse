import type { TaskRun, UserPreference, WorkflowEvent } from "@openbrowse/contracts";

export interface WorkflowLogStore {
  append(event: WorkflowEvent): Promise<void>;
}

export interface RunCheckpointStore {
  save(run: TaskRun): Promise<void>;
  load(runId: string): Promise<TaskRun | null>;
}

export interface PreferenceStore {
  upsert(preference: UserPreference): Promise<void>;
  list(namespace: string): Promise<UserPreference[]>;
}

export class InMemoryWorkflowLogStore implements WorkflowLogStore {
  private readonly events: WorkflowEvent[] = [];

  async append(event: WorkflowEvent): Promise<void> {
    this.events.push(event);
  }
}

export class InMemoryRunCheckpointStore implements RunCheckpointStore {
  private readonly runs = new Map<string, TaskRun>();

  async save(run: TaskRun): Promise<void> {
    this.runs.set(run.id, run);
  }

  async load(runId: string): Promise<TaskRun | null> {
    return this.runs.get(runId) ?? null;
  }
}

export class InMemoryPreferenceStore implements PreferenceStore {
  private readonly values: UserPreference[] = [];

  async upsert(preference: UserPreference): Promise<void> {
    this.values.push(preference);
  }

  async list(namespace: string): Promise<UserPreference[]> {
    return this.values.filter((entry) => entry.namespace === namespace);
  }
}

