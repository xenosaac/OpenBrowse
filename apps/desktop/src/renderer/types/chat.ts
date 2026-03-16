export type MainPanel = "home" | "browser";

export type ChatMessage = {
  id: string;
  role: "user" | "agent";
  content: string;
  tone?: "normal" | "success" | "warning" | "error" | "action";
  timestamp: string;
};

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  messages: ChatMessage[];
  runIds: string[];
}
