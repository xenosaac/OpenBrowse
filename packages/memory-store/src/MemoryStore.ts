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
  deleteByKey(namespace: string, key: string): Promise<boolean>;
  /** Atomically write all entries for a namespace. Empty values delete the key; non-empty values upsert with id = `pref_${key}`. */
  saveNamespaceSettings(namespace: string, entries: Array<{ key: string; value: string }>): Promise<void>;
}

export class InMemoryWorkflowLogStore implements WorkflowLogStore {
  private readonly events: WorkflowEvent[] = [];
  private readonly byRun = new Map<string, WorkflowEvent[]>();

  async append(event: WorkflowEvent): Promise<void> {
    this.events.push(event);
    let bucket = this.byRun.get(event.runId);
    if (!bucket) {
      bucket = [];
      this.byRun.set(event.runId, bucket);
    }
    bucket.push(event);
  }

  async listByRun(runId: string): Promise<WorkflowEvent[]> {
    return this.byRun.get(runId) ?? [];
  }

  async listRecent(limit: number): Promise<WorkflowEvent[]> {
    return this.events.slice(-limit).reverse();
  }

  async countByRun(runId: string): Promise<number> {
    return this.byRun.get(runId)?.length ?? 0;
  }

  async deleteByRun(runId: string): Promise<number> {
    const bucket = this.byRun.get(runId);
    if (!bucket || bucket.length === 0) return 0;
    const deleted = bucket.length;
    this.byRun.delete(runId);
    const remaining = this.events.filter((e) => e.runId !== runId);
    this.events.length = 0;
    this.events.push(...remaining);
    return deleted;
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

  async deleteByKey(namespace: string, key: string): Promise<boolean> {
    return this.values.delete(`${namespace}:${key}`);
  }

  async saveNamespaceSettings(namespace: string, entries: Array<{ key: string; value: string }>): Promise<void> {
    const now = new Date().toISOString();
    for (const { key, value } of entries) {
      const trimmed = value.trim();
      if (!trimmed) {
        this.values.delete(`${namespace}:${key}`);
      } else {
        this.values.set(`${namespace}:${key}`, {
          id: `pref_${key}`,
          namespace,
          key,
          value: trimmed,
          capturedAt: now
        });
      }
    }
  }
}
