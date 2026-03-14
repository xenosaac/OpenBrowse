import type { TaskRun, TaskStatus, UserPreference, WorkflowEvent } from "@openbrowse/contracts";

export interface WorkflowLogStore {
  append(event: WorkflowEvent): Promise<void>;
  listByRun(runId: string): Promise<WorkflowEvent[]>;
  listRecent(limit: number): Promise<WorkflowEvent[]>;
  countByRun(runId: string): Promise<number>;
  deleteByRun(runId: string): Promise<number>;
}

export interface RunCheckpointStore {
  save(run: TaskRun): Promise<void>;
  load(runId: string): Promise<TaskRun | null>;
  listByStatus(status: TaskStatus): Promise<TaskRun[]>;
  listAll(): Promise<TaskRun[]>;
  delete(runId: string): Promise<boolean>;
}

export interface PreferenceStore {
  upsert(preference: UserPreference): Promise<void>;
  get(namespace: string, key: string): Promise<UserPreference | null>;
  list(namespace: string): Promise<UserPreference[]>;
  delete(id: string): Promise<boolean>;
}

export class InMemoryWorkflowLogStore implements WorkflowLogStore {
  private readonly events: WorkflowEvent[] = [];

  async append(event: WorkflowEvent): Promise<void> {
    this.events.push(event);
  }

  async listByRun(runId: string): Promise<WorkflowEvent[]> {
    return this.events.filter((e) => e.runId === runId);
  }

  async listRecent(limit: number): Promise<WorkflowEvent[]> {
    return this.events.slice(-limit).reverse();
  }

  async countByRun(runId: string): Promise<number> {
    return this.events.filter((e) => e.runId === runId).length;
  }

  async deleteByRun(runId: string): Promise<number> {
    const before = this.events.length;
    const remaining = this.events.filter((e) => e.runId !== runId);
    this.events.length = 0;
    this.events.push(...remaining);
    return before - remaining.length;
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

  async listByStatus(status: TaskStatus): Promise<TaskRun[]> {
    return [...this.runs.values()].filter((r) => r.status === status);
  }

  async listAll(): Promise<TaskRun[]> {
    return [...this.runs.values()];
  }

  async delete(runId: string): Promise<boolean> {
    return this.runs.delete(runId);
  }
}

export class InMemoryPreferenceStore implements PreferenceStore {
  private readonly values = new Map<string, UserPreference>();

  async upsert(preference: UserPreference): Promise<void> {
    // Key by namespace+key to prevent duplicates
    const compositeKey = `${preference.namespace}:${preference.key}`;
    this.values.set(compositeKey, preference);
  }

  async get(namespace: string, key: string): Promise<UserPreference | null> {
    return this.values.get(`${namespace}:${key}`) ?? null;
  }

  async list(namespace: string): Promise<UserPreference[]> {
    return [...this.values.values()].filter((v) => v.namespace === namespace);
  }

  async delete(id: string): Promise<boolean> {
    for (const [key, pref] of this.values) {
      if (pref.id === id) {
        this.values.delete(key);
        return true;
      }
    }
    return false;
  }
}
