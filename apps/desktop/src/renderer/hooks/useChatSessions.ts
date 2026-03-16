import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import type { TaskRun } from "@openbrowse/contracts";
import type { ChatSession, ChatMessage } from "../types/chat";

const WELCOME_CONTENT = "Hello. I can browse, summarize, and keep long-running tasks alive. Tell me what to do.";

function makeWelcomeMsg(suffix?: string): ChatMessage {
  return {
    id: `welcome_${suffix ?? Date.now()}`,
    role: "agent",
    content: WELCOME_CONTENT,
    timestamp: new Date().toISOString()
  };
}

/** Persist a message to SQLite. Fire-and-forget — errors are silently ignored. */
function persistMsg(sessionId: string, msg: ChatMessage) {
  window.openbrowse.chatAppendMessage({
    id: msg.id,
    sessionId,
    role: msg.role,
    content: msg.content,
    tone: msg.tone,
    createdAt: msg.timestamp
  }).catch(() => {});
}

export function useChatSessions() {
  const INITIAL_SESSION_ID = useRef(`session_${Date.now()}`).current;
  const loadedRef = useRef(false);

  const [sessions, setSessions] = useState<ChatSession[]>([{
    id: INITIAL_SESSION_ID,
    title: "New Session",
    createdAt: new Date().toISOString(),
    messages: [makeWelcomeMsg()],
    runIds: []
  }]);
  const [activeSessionId, setActiveSessionId] = useState(INITIAL_SESSION_ID);
  const [sessionListOpen, setSessionListOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);

  // ---- Load persisted sessions on mount ----
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    window.openbrowse.chatListSessions().then((stored) => {
      if (!stored || stored.length === 0) {
        // No persisted sessions — persist the initial one
        const now = new Date().toISOString();
        window.openbrowse.chatCreateSession({ id: INITIAL_SESSION_ID, title: "New Session", createdAt: now }).catch(() => {});
        persistMsg(INITIAL_SESSION_ID, makeWelcomeMsg());
        return;
      }
      const hydrated: ChatSession[] = stored.map((s) => ({
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        messages: s.messages.map((m) => ({
          id: m.id,
          role: m.role as "user" | "agent",
          content: m.content,
          tone: (m.tone ?? "normal") as ChatMessage["tone"],
          timestamp: m.createdAt
        })),
        runIds: s.runIds
      }));
      setSessions(hydrated);
      setActiveSessionId(hydrated[0].id);
    }).catch(() => {
      // SQLite unavailable — keep in-memory defaults
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeSession = useMemo(
    () => sessions.find(s => s.id === activeSessionId) ?? sessions[0],
    [sessions, activeSessionId]
  );
  const messages = activeSession.messages;

  const setMessages = useCallback(
    (updater: React.SetStateAction<ChatMessage[]>) => {
      setSessions(prev => prev.map(s => {
        if (s.id !== activeSessionId) return s;
        const next = typeof updater === "function" ? updater(s.messages) : updater;
        // Persist any new messages (ones not already in the old list)
        const oldIds = new Set(s.messages.map(m => m.id));
        for (const msg of next) {
          if (!oldIds.has(msg.id)) persistMsg(s.id, msg);
        }
        return { ...s, messages: next };
      }));
    },
    [activeSessionId]
  );

  const createSession = useCallback(() => {
    const id = `session_${Date.now()}`;
    const now = new Date().toISOString();
    const welcome = makeWelcomeMsg(id);
    const newSession: ChatSession = {
      id, title: "New Session", createdAt: now, messages: [welcome], runIds: []
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(id);
    setChatInput("");
    setSessionListOpen(false);
    // Persist
    window.openbrowse.chatCreateSession({ id, title: "New Session", createdAt: now }).catch(() => {});
    persistMsg(id, welcome);
  }, []);

  const switchSession = useCallback((id: string) => {
    setActiveSessionId(id);
    setChatInput("");
    setSessionListOpen(false);
  }, []);

  const deleteSession = useCallback((id: string) => {
    window.openbrowse.chatDeleteSession(id).catch(() => {});
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      if (next.length === 0) {
        const now = new Date().toISOString();
        const fbId = `session_${Date.now()}`;
        const welcome = makeWelcomeMsg("fallback");
        const fallback: ChatSession = {
          id: fbId, title: "New Session", createdAt: now, messages: [welcome], runIds: []
        };
        setActiveSessionId(fbId);
        window.openbrowse.chatCreateSession({ id: fbId, title: "New Session", createdAt: now }).catch(() => {});
        persistMsg(fbId, welcome);
        return [fallback];
      }
      if (id === activeSessionId) {
        setActiveSessionId(next[0].id);
      }
      return next;
    });
    setSessionListOpen(false);
  }, [activeSessionId]);

  const addRunToSession = useCallback((runId: string) => {
    setSessions(prev => prev.map(s => {
      if (s.id !== activeSessionId || s.runIds.includes(runId)) return s;
      window.openbrowse.chatLinkRun(s.id, runId).catch(() => {});
      return { ...s, runIds: [...s.runIds, runId] };
    }));
  }, [activeSessionId]);

  const postSystemMessage = useCallback((content: string, tone?: ChatMessage["tone"]) => {
    const msg: ChatMessage = {
      id: `sys_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role: "agent",
      content,
      tone: tone ?? "normal",
      timestamp: new Date().toISOString()
    };
    setSessions(prev => prev.map(s => {
      if (s.id !== activeSessionId) return s;
      persistMsg(s.id, msg);
      return { ...s, messages: [...s.messages, msg] };
    }));
  }, [activeSessionId]);

  const renameSession = useCallback((title: string) => {
    const trimmed = title.length > 40 ? title.slice(0, 40) + "..." : title;
    setSessions(prev => prev.map(s => {
      if (s.id !== activeSessionId || s.title !== "New Session") return s;
      window.openbrowse.chatUpdateTitle(s.id, trimmed).catch(() => {});
      return { ...s, title: trimmed };
    }));
  }, [activeSessionId]);

  const postToRunSessions = useCallback((runId: string, message: ChatMessage) => {
    setSessions(prev => prev.map(s => {
      if (!s.runIds.includes(runId)) return s;
      if (s.messages.some(m => m.id === message.id)) return s;
      persistMsg(s.id, message);
      return { ...s, messages: [...s.messages, message] };
    }));
  }, []);

  const clearCurrentChat = useCallback(() => {
    setSessions(prev => prev.map(s => {
      if (s.id !== activeSessionId) return s;
      const welcome: ChatMessage = {
        id: `welcome_${Date.now()}`, role: "agent" as const,
        content: "Chat cleared. What would you like to do?",
        timestamp: new Date().toISOString()
      };
      window.openbrowse.chatClearMessages(s.id).catch(() => {});
      persistMsg(s.id, welcome);
      return { ...s, messages: [welcome] };
    }));
  }, [activeSessionId]);

  return {
    sessions, activeSessionId, activeSession, messages, sessionListOpen,
    chatInput, chatBusy,
    setChatInput, setChatBusy, setMessages, setSessionListOpen,
    createSession, switchSession, deleteSession, clearCurrentChat, addRunToSession,
    postSystemMessage, renameSession, postToRunSessions
  };
}
