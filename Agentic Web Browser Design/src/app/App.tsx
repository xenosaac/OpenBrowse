import { useState, useEffect } from "react";
import { AgentChat } from "./components/agent-chat";
import { BrowserHeader } from "./components/browser-header";
import { BrowserContent } from "./components/browser-content";
import { SettingsDialog } from "./components/settings-dialog";

export default function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Force dark mode
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <div className="h-screen flex overflow-hidden bg-[#0a0a12]">
      {/* Agent Chat Sidebar */}
      <AgentChat />

      {/* Main Browser Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Browser Header */}
        <BrowserHeader onSettingsClick={() => setIsSettingsOpen(true)} />

        {/* Browser Content */}
        <BrowserContent />
      </div>

      {/* Settings Dialog */}
      <SettingsDialog
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
}
