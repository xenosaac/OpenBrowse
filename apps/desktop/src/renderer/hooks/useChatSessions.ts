import { useCallback, useRef, useState, useMemo } from "react";
import type { TaskRun } from "@openbrowse/contracts";
import type { ChatSession, ChatMessage } from "../types/chat";

export function useChatSessions() {
  const INITIAL_SESSION_ID = useRef(`session_${Date.now()}`).current;

  const [sessions, setSessions] = useState<ChatSession[]>([{
    id: INITIAL_SESSION_ID,
    title: "New Session",
    createdAt: new Date().toISOString(),
    messages: [{
      id: "welcome", role: "agent" as const,
      content: "Hello. I can browse, summarize, and keep long-running tasks alive. Tell me what to do.",
      timestamp: new Date().toISOString()
    }],
    runIds: []
  }]);
  const [activeSessionId, setActiveSessionId] = useState(INITIAL_SESSION_ID);
  const [sessionListOpen, setSessionListOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);

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
        return { ...s, messages: next };
      }));
    },
    [activeSessionId]
  );

  const createSession = useCallback(() => {
    const id = `session_${Date.now()}`;
    const newSession: ChatSession = {
      id,
      title: "New Session",
      createdAt: new Date().toISOString(),
      messages: [{
        id: `welcome_${id}`, role: "agent",
        content: "Hello. I can browse, summarize, and keep long-running tasks alive. Tell me what to do.",
        timestamp: new Date().toISOString()
      }],
      runIds: []
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(id);
    setChatInput("");
    setSessionListOpen(false);
  }, []);

  const switchSession = useCallback((id: string) => {
    setActiveSessionId(id);
    setChatInput("");
    setSessionListOpen(false);
  }, []);

  const deleteSession = useCallback((id: string) => {
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      if (next.length === 0) {
        const fallback: ChatSession = {
          id: `session_${Date.now()}`,
          title: "New Session",
          createdAt: new Date().toISOString(),
          messages: [{
            id: "welcome_fallback", role: "agent",
            content: "Hello. I can browse, summarize, and keep long-running tasks alive. Tell me what to do.",
            timestamp: new Date().toISOString()
          }],
          runIds: []
        };
        setActiveSessionId(fallback.id);
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
    setSessions(prev => prev.map(s =>
      s.id === activeSessionId && !s.runIds.includes(runId)
        ? { ...s, runIds: [...s.runIds, runId] }
        : s
    ));
  }, [activeSessionId]);

  const postSystemMessage = useCallback((content: string, tone?: ChatMessage["tone"]) => {
    const msg: ChatMessage = {
      id: `sys_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role: "agent",
      content,
      tone: tone ?? "normal",
      timestamp: new Date().toISOString()
    };
    setMessages(prev => [...prev, msg]);
  }, [setMessages]);

  const renameSession = useCallback((title: string) => {
    setSessions(prev => prev.map(s =>
      s.id === activeSessionId && s.title === "New Session"
        ? { ...s, title: title.length > 40 ? title.slice(0, 40) + "..." : title }
        : s
    ));
  }, [activeSessionId]);

  const postToRunSessions = useCallback((runId: string, message: ChatMessage) => {
    setSessions(prev => prev.map(s => {
      if (!s.runIds.includes(runId)) return s;
      if (s.messages.some(m => m.id === message.id)) return s;
      return { ...s, messages: [...s.messages, message] };
    }));
  }, []);

  return {
    sessions, activeSessionId, activeSession, messages, sessionListOpen,
    chatInput, chatBusy,
    setChatInput, setChatBusy, setMessages, setSessionListOpen,
    createSession, switchSession, deleteSession, addRunToSession, postSystemMessage,
    renameSession, postToRunSessions
  };
}
