import type Database from "better-sqlite3";
import type { SqliteDatabase } from "./SqliteDatabase.js";
import type { ChatSession, ChatMessage, ChatSessionStore } from "./MemoryStore.js";

export class SqliteChatSessionStore implements ChatSessionStore {
  private readonly stmtCreateSession: Database.Statement;
  private readonly stmtUpdateTitle: Database.Statement;
  private readonly stmtGetSession: Database.Statement;
  private readonly stmtListSessions: Database.Statement;
  private readonly stmtDeleteSession: Database.Statement;
  private readonly stmtAppendMessage: Database.Statement;
  private readonly stmtListMessages: Database.Statement;
  private readonly stmtLinkRun: Database.Statement;
  private readonly stmtListRunIds: Database.Statement;

  constructor(private readonly sqlite: SqliteDatabase) {
    this.stmtCreateSession = sqlite.db.prepare(
      `INSERT OR REPLACE INTO chat_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`
    );
    this.stmtUpdateTitle = sqlite.db.prepare(
      `UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?`
    );
    this.stmtGetSession = sqlite.db.prepare("SELECT * FROM chat_sessions WHERE id = ?");
    this.stmtListSessions = sqlite.db.prepare("SELECT * FROM chat_sessions ORDER BY updated_at DESC");
    this.stmtDeleteSession = sqlite.db.prepare("DELETE FROM chat_sessions WHERE id = ?");
    this.stmtAppendMessage = sqlite.db.prepare(
      `INSERT INTO chat_messages (id, session_id, run_id, role, content, tone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    this.stmtListMessages = sqlite.db.prepare(
      "SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC"
    );
    this.stmtLinkRun = sqlite.db.prepare(
      `INSERT OR IGNORE INTO chat_session_runs (session_id, run_id, linked_at) VALUES (?, ?, ?)`
    );
    this.stmtListRunIds = sqlite.db.prepare(
      "SELECT run_id FROM chat_session_runs WHERE session_id = ?"
    );
  }

  async createSession(session: ChatSession): Promise<void> {
    this.stmtCreateSession.run(session.id, session.title, session.createdAt, session.updatedAt);
  }

  async updateTitle(sessionId: string, title: string): Promise<void> {
    this.stmtUpdateTitle.run(title, new Date().toISOString(), sessionId);
  }

  async getSession(sessionId: string): Promise<ChatSession | null> {
    const row = this.stmtGetSession.get(sessionId) as ChatSessionRow | undefined;
    return row ? rowToChatSession(row) : null;
  }

  async listSessions(): Promise<ChatSession[]> {
    return (this.stmtListSessions.all() as ChatSessionRow[]).map(rowToChatSession);
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    return this.stmtDeleteSession.run(sessionId).changes > 0;
  }

  async appendMessage(message: ChatMessage): Promise<void> {
    this.stmtAppendMessage.run(
      message.id, message.sessionId, message.runId ?? null,
      message.role, message.content, message.tone ?? null, message.createdAt
    );
    // Touch the session's updated_at
    this.stmtUpdateTitle.run(
      (this.stmtGetSession.get(message.sessionId) as ChatSessionRow | undefined)?.title ?? "Chat",
      new Date().toISOString(),
      message.sessionId
    );
  }

  async listMessages(sessionId: string): Promise<ChatMessage[]> {
    return (this.stmtListMessages.all(sessionId) as ChatMessageRow[]).map(rowToChatMessage);
  }

  async linkRun(sessionId: string, runId: string): Promise<void> {
    this.stmtLinkRun.run(sessionId, runId, new Date().toISOString());
  }

  async listRunIds(sessionId: string): Promise<string[]> {
    return (this.stmtListRunIds.all(sessionId) as Array<{ run_id: string }>).map((r) => r.run_id);
  }
}

interface ChatSessionRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface ChatMessageRow {
  id: string;
  session_id: string;
  run_id: string | null;
  role: string;
  content: string;
  tone: string | null;
  created_at: string;
}

function rowToChatSession(row: ChatSessionRow): ChatSession {
  return { id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at };
}

function rowToChatMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    runId: row.run_id ?? undefined,
    role: row.role,
    content: row.content,
    tone: row.tone ?? undefined,
    createdAt: row.created_at,
  };
}
