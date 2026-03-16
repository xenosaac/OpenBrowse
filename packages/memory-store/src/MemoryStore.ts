import type { BrowserProfile, TaskRun, TaskStatus, UserPreference, WorkflowEvent } from "@openbrowse/contracts";

// ---------------------------------------------------------------------------
// Domain types for new stores
// ---------------------------------------------------------------------------

export interface TrackedBrowserSession {
  id: string;
  runId?: string;
  profileId?: string;
  state: string;
  createdAt: string;
  terminatedAt?: string;
  terminationReason?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  runId?: string;
  role: string;
  content: string;
  tone?: string;
  createdAt: string;
}

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  folder?: string;
  tags: string[];
  faviconUrl?: string;
  createdAt: string;
}

export interface BrowsingHistoryEntry {
  id: string;
  url: string;
  title: string;
  profileId?: string;
  runId?: string;
  visitedAt: string;
}

export interface StoredBrowserProfile {
  id: string;
  label: string;
  storagePath: string;
  isManaged: boolean;
  createdAt: string;
}

export interface CookieContainer {
  id: string;
  label: string;
  color?: string;
  icon?: string;
  profileId?: string;
  partitionKey: string;
  createdAt: string;
}

export interface StandaloneTab {
  id: string;
  url: string;
  profileId?: string;
  createdAt: string;
}

export interface ChatBridgeStateEntry {
  key: string;
  value: unknown;
  updatedAt: string;
}

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

  private readonly seenIds = new Set<string>();

  async append(event: WorkflowEvent): Promise<void> {
    // Match SQLite INSERT OR IGNORE: skip if id already appended
    if (this.seenIds.has(event.id)) return;
    this.seenIds.add(event.id);
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
    return [...this.runs.values()]
      .filter((r) => r.status === status)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listAll(): Promise<TaskRun[]> {
    return [...this.runs.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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

// ---------------------------------------------------------------------------
// Session Tracking
// ---------------------------------------------------------------------------

export interface SessionTrackingStore {
  create(session: TrackedBrowserSession): Promise<void>;
  terminate(sessionId: string, reason: string): Promise<void>;
  get(sessionId: string): Promise<TrackedBrowserSession | null>;
  listByRun(runId: string): Promise<TrackedBrowserSession[]>;
  listActive(): Promise<TrackedBrowserSession[]>;
  listActiveByRun(runId: string): Promise<TrackedBrowserSession[]>;
  deleteByRun(runId: string): Promise<number>;
}

export class InMemorySessionTrackingStore implements SessionTrackingStore {
  private readonly sessions = new Map<string, TrackedBrowserSession>();

  async create(session: TrackedBrowserSession): Promise<void> {
    this.sessions.set(session.id, session);
  }

  async terminate(sessionId: string, reason: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (s) {
      s.state = "terminated";
      s.terminatedAt = new Date().toISOString();
      s.terminationReason = reason;
    }
  }

  async get(sessionId: string): Promise<TrackedBrowserSession | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async listByRun(runId: string): Promise<TrackedBrowserSession[]> {
    return [...this.sessions.values()].filter((s) => s.runId === runId);
  }

  async listActive(): Promise<TrackedBrowserSession[]> {
    return [...this.sessions.values()].filter((s) => s.state !== "terminated");
  }

  async listActiveByRun(runId: string): Promise<TrackedBrowserSession[]> {
    return [...this.sessions.values()].filter((s) => s.runId === runId && s.state !== "terminated");
  }

  async deleteByRun(runId: string): Promise<number> {
    let count = 0;
    for (const [id, s] of this.sessions) {
      if (s.runId === runId) { this.sessions.delete(id); count++; }
    }
    return count;
  }
}

// ---------------------------------------------------------------------------
// Chat Sessions
// ---------------------------------------------------------------------------

export interface ChatSessionStore {
  createSession(session: ChatSession): Promise<void>;
  updateTitle(sessionId: string, title: string): Promise<void>;
  getSession(sessionId: string): Promise<ChatSession | null>;
  listSessions(): Promise<ChatSession[]>;
  deleteSession(sessionId: string): Promise<boolean>;
  appendMessage(message: ChatMessage): Promise<void>;
  listMessages(sessionId: string): Promise<ChatMessage[]>;
  linkRun(sessionId: string, runId: string): Promise<void>;
  listRunIds(sessionId: string): Promise<string[]>;
}

export class InMemoryChatSessionStore implements ChatSessionStore {
  private readonly sessions = new Map<string, ChatSession>();
  private readonly messages = new Map<string, ChatMessage[]>();
  private readonly runLinks = new Map<string, Set<string>>();

  async createSession(session: ChatSession): Promise<void> {
    this.sessions.set(session.id, session);
  }

  async updateTitle(sessionId: string, title: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (s) { s.title = title; s.updatedAt = new Date().toISOString(); }
  }

  async getSession(sessionId: string): Promise<ChatSession | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async listSessions(): Promise<ChatSession[]> {
    return [...this.sessions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    this.messages.delete(sessionId);
    this.runLinks.delete(sessionId);
    return this.sessions.delete(sessionId);
  }

  async appendMessage(message: ChatMessage): Promise<void> {
    let bucket = this.messages.get(message.sessionId);
    if (!bucket) { bucket = []; this.messages.set(message.sessionId, bucket); }
    bucket.push(message);
    const s = this.sessions.get(message.sessionId);
    if (s) s.updatedAt = new Date().toISOString();
  }

  async listMessages(sessionId: string): Promise<ChatMessage[]> {
    return this.messages.get(sessionId) ?? [];
  }

  async linkRun(sessionId: string, runId: string): Promise<void> {
    let set = this.runLinks.get(sessionId);
    if (!set) { set = new Set(); this.runLinks.set(sessionId, set); }
    set.add(runId);
  }

  async listRunIds(sessionId: string): Promise<string[]> {
    return [...(this.runLinks.get(sessionId) ?? [])];
  }
}

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

export interface BookmarkStore {
  create(bookmark: Bookmark): Promise<void>;
  update(id: string, fields: Partial<Pick<Bookmark, "title" | "url" | "folder" | "tags" | "faviconUrl">>): Promise<void>;
  get(id: string): Promise<Bookmark | null>;
  getByUrl(url: string): Promise<Bookmark | null>;
  listByFolder(folder: string): Promise<Bookmark[]>;
  listAll(): Promise<Bookmark[]>;
  search(query: string): Promise<Bookmark[]>;
  delete(id: string): Promise<boolean>;
}

export class InMemoryBookmarkStore implements BookmarkStore {
  private readonly bookmarks = new Map<string, Bookmark>();

  async create(bookmark: Bookmark): Promise<void> { this.bookmarks.set(bookmark.id, bookmark); }

  async update(id: string, fields: Partial<Pick<Bookmark, "title" | "url" | "folder" | "tags" | "faviconUrl">>): Promise<void> {
    const b = this.bookmarks.get(id);
    if (b) Object.assign(b, fields);
  }

  async get(id: string): Promise<Bookmark | null> { return this.bookmarks.get(id) ?? null; }

  async getByUrl(url: string): Promise<Bookmark | null> {
    for (const b of this.bookmarks.values()) { if (b.url === url) return b; }
    return null;
  }

  async listByFolder(folder: string): Promise<Bookmark[]> {
    return [...this.bookmarks.values()].filter((b) => b.folder === folder);
  }

  async listAll(): Promise<Bookmark[]> {
    return [...this.bookmarks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async search(query: string): Promise<Bookmark[]> {
    const q = query.toLowerCase();
    return [...this.bookmarks.values()].filter((b) =>
      b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)
    );
  }

  async delete(id: string): Promise<boolean> { return this.bookmarks.delete(id); }
}

// ---------------------------------------------------------------------------
// Browsing History
// ---------------------------------------------------------------------------

export interface BrowsingHistoryStore {
  record(entry: BrowsingHistoryEntry): Promise<void>;
  listRecent(limit: number): Promise<BrowsingHistoryEntry[]>;
  listByDateRange(from: string, to: string): Promise<BrowsingHistoryEntry[]>;
  search(query: string): Promise<BrowsingHistoryEntry[]>;
  deleteByDateRange(from: string, to: string): Promise<number>;
  deleteAll(): Promise<number>;
}

export class InMemoryBrowsingHistoryStore implements BrowsingHistoryStore {
  private readonly entries: BrowsingHistoryEntry[] = [];

  async record(entry: BrowsingHistoryEntry): Promise<void> { this.entries.push(entry); }

  async listRecent(limit: number): Promise<BrowsingHistoryEntry[]> {
    return this.entries.slice(-limit).reverse();
  }

  async listByDateRange(from: string, to: string): Promise<BrowsingHistoryEntry[]> {
    return this.entries.filter((e) => e.visitedAt >= from && e.visitedAt <= to);
  }

  async search(query: string): Promise<BrowsingHistoryEntry[]> {
    const q = query.toLowerCase();
    return this.entries.filter((e) =>
      e.title.toLowerCase().includes(q) || e.url.toLowerCase().includes(q)
    );
  }

  async deleteByDateRange(from: string, to: string): Promise<number> {
    const before = this.entries.length;
    const keep = this.entries.filter((e) => e.visitedAt < from || e.visitedAt > to);
    this.entries.length = 0;
    this.entries.push(...keep);
    return before - keep.length;
  }

  async deleteAll(): Promise<number> {
    const count = this.entries.length;
    this.entries.length = 0;
    return count;
  }
}

// ---------------------------------------------------------------------------
// Browser Profiles
// ---------------------------------------------------------------------------

export interface BrowserProfileStore {
  save(profile: StoredBrowserProfile): Promise<void>;
  get(id: string): Promise<StoredBrowserProfile | null>;
  listAll(): Promise<StoredBrowserProfile[]>;
  delete(id: string): Promise<boolean>;
}

export class InMemoryBrowserProfileStore implements BrowserProfileStore {
  private readonly profiles = new Map<string, StoredBrowserProfile>();

  async save(profile: StoredBrowserProfile): Promise<void> { this.profiles.set(profile.id, profile); }
  async get(id: string): Promise<StoredBrowserProfile | null> { return this.profiles.get(id) ?? null; }
  async listAll(): Promise<StoredBrowserProfile[]> { return [...this.profiles.values()]; }
  async delete(id: string): Promise<boolean> { return this.profiles.delete(id); }
}

// ---------------------------------------------------------------------------
// Cookie Containers
// ---------------------------------------------------------------------------

export interface CookieContainerStore {
  create(container: CookieContainer): Promise<void>;
  update(id: string, fields: Partial<Pick<CookieContainer, "label" | "color" | "icon">>): Promise<void>;
  get(id: string): Promise<CookieContainer | null>;
  listAll(): Promise<CookieContainer[]>;
  listByProfile(profileId: string): Promise<CookieContainer[]>;
  delete(id: string): Promise<boolean>;
}

export class InMemoryCookieContainerStore implements CookieContainerStore {
  private readonly containers = new Map<string, CookieContainer>();

  async create(container: CookieContainer): Promise<void> { this.containers.set(container.id, container); }

  async update(id: string, fields: Partial<Pick<CookieContainer, "label" | "color" | "icon">>): Promise<void> {
    const c = this.containers.get(id);
    if (c) Object.assign(c, fields);
  }

  async get(id: string): Promise<CookieContainer | null> { return this.containers.get(id) ?? null; }
  async listAll(): Promise<CookieContainer[]> { return [...this.containers.values()]; }

  async listByProfile(profileId: string): Promise<CookieContainer[]> {
    return [...this.containers.values()].filter((c) => c.profileId === profileId);
  }

  async delete(id: string): Promise<boolean> { return this.containers.delete(id); }
}

// ---------------------------------------------------------------------------
// Standalone Tabs
// ---------------------------------------------------------------------------

export interface StandaloneTabStore {
  save(tab: StandaloneTab): Promise<void>;
  get(id: string): Promise<StandaloneTab | null>;
  listAll(): Promise<StandaloneTab[]>;
  delete(id: string): Promise<boolean>;
}

export class InMemoryStandaloneTabStore implements StandaloneTabStore {
  private readonly tabs = new Map<string, StandaloneTab>();

  async save(tab: StandaloneTab): Promise<void> { this.tabs.set(tab.id, tab); }
  async get(id: string): Promise<StandaloneTab | null> { return this.tabs.get(id) ?? null; }
  async listAll(): Promise<StandaloneTab[]> { return [...this.tabs.values()]; }
  async delete(id: string): Promise<boolean> { return this.tabs.delete(id); }
}

// ---------------------------------------------------------------------------
// Chat Bridge State
// ---------------------------------------------------------------------------

export interface ChatBridgeStateStore {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  listAll(): Promise<ChatBridgeStateEntry[]>;
}

export class InMemoryChatBridgeStateStore implements ChatBridgeStateStore {
  private readonly state = new Map<string, unknown>();

  async get<T = unknown>(key: string): Promise<T | null> {
    return (this.state.get(key) as T) ?? null;
  }

  async set(key: string, value: unknown): Promise<void> { this.state.set(key, value); }
  async delete(key: string): Promise<boolean> { return this.state.delete(key); }

  async listAll(): Promise<ChatBridgeStateEntry[]> {
    const now = new Date().toISOString();
    return [...this.state.entries()].map(([key, value]) => ({ key, value, updatedAt: now }));
  }
}
