import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Home,
  Star,
  Lock,
  Plus,
  X,
  Settings,
  Menu,
} from "lucide-react";

interface Tab {
  id: string;
  title: string;
  url: string;
  favicon?: string;
}

interface BrowserHeaderProps {
  onSettingsClick: () => void;
}

export function BrowserHeader({ onSettingsClick }: BrowserHeaderProps) {
  const [tabs, setTabs] = useState<Tab[]>([
    { id: "1", title: "New Tab", url: "agent://newtab" },
  ]);
  const [activeTab, setActiveTab] = useState("1");
  const [url, setUrl] = useState("agent://newtab");
  const [isBookmarked, setIsBookmarked] = useState(false);

  const addTab = () => {
    const newTab: Tab = {
      id: Date.now().toString(),
      title: "New Tab",
      url: "agent://newtab",
    };
    setTabs([...tabs, newTab]);
    setActiveTab(newTab.id);
  };

  const closeTab = (id: string) => {
    const newTabs = tabs.filter((tab) => tab.id !== id);
    if (newTabs.length === 0) {
      addTab();
      return;
    }
    setTabs(newTabs);
    if (activeTab === id) {
      setActiveTab(newTabs[0].id);
    }
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // URL navigation logic here
  };

  return (
    <div className="bg-[#12121a] border-b border-[#2a2a3e]">
      {/* Tabs Bar */}
      <div className="flex items-center gap-2 px-2 pt-2 bg-[#0f0f18]">
        {/* Settings Button */}
        <button
          onClick={onSettingsClick}
          className="p-2 hover:bg-[#1e1e2e] rounded-lg transition-colors group"
          title="Settings"
        >
          <Settings className="w-4 h-4 text-gray-400 group-hover:text-purple-400" />
        </button>

        {/* Tabs */}
        <div className="flex-1 flex items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`group flex items-center gap-2 px-4 py-2 rounded-t-lg min-w-[180px] max-w-[240px] cursor-pointer transition-colors ${
                activeTab === tab.id
                  ? "bg-[#12121a] text-white"
                  : "bg-[#0a0a12] text-gray-400 hover:bg-[#12121a]"
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              <Globe className="w-4 h-4 flex-shrink-0 text-purple-400" />
              <span className="flex-1 truncate text-sm">{tab.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className="opacity-0 group-hover:opacity-100 hover:bg-[#1e1e2e] rounded p-0.5 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          <button
            onClick={addTab}
            className="p-2 hover:bg-[#1e1e2e] rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Menu */}
        <button className="p-2 hover:bg-[#1e1e2e] rounded-lg transition-colors">
          <Menu className="w-4 h-4 text-gray-400" />
        </button>
      </div>

      {/* Navigation Bar */}
      <div className="flex items-center gap-2 px-4 py-3">
        {/* Navigation Controls */}
        <div className="flex items-center gap-1">
          <button className="p-2 hover:bg-[#1e1e2e] rounded-lg transition-colors">
            <ChevronLeft className="w-4 h-4 text-gray-400" />
          </button>
          <button className="p-2 hover:bg-[#1e1e2e] rounded-lg transition-colors">
            <ChevronRight className="w-4 h-4 text-gray-400" />
          </button>
          <button className="p-2 hover:bg-[#1e1e2e] rounded-lg transition-colors">
            <RotateCw className="w-4 h-4 text-gray-400" />
          </button>
          <button className="p-2 hover:bg-[#1e1e2e] rounded-lg transition-colors">
            <Home className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* URL Bar */}
        <form onSubmit={handleUrlSubmit} className="flex-1 relative">
          <div className="flex items-center gap-2 bg-[#1e1e2e] border border-[#2a2a3e] rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-purple-500 transition-all">
            <Lock className="w-4 h-4 text-green-400 flex-shrink-0" />
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Search or enter address"
              className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setIsBookmarked(!isBookmarked)}
              className="hover:bg-[#2a2a3e] p-1 rounded transition-colors"
            >
              <Star
                className={`w-4 h-4 ${
                  isBookmarked
                    ? "fill-yellow-400 text-yellow-400"
                    : "text-gray-400"
                }`}
              />
            </button>
          </div>
        </form>
      </div>

      {/* Bookmarks Bar */}
      <div className="flex items-center gap-2 px-4 pb-2 overflow-x-auto">
        {[
          { name: "Dashboard", icon: "📊" },
          { name: "Docs", icon: "📚" },
          { name: "Trading", icon: "📈" },
          { name: "Analytics", icon: "🔍" },
        ].map((bookmark, idx) => (
          <button
            key={idx}
            className="flex items-center gap-2 px-3 py-1.5 bg-[#1a1a26] hover:bg-[#2a2a3e] rounded-lg transition-colors text-sm text-gray-300"
          >
            <span>{bookmark.icon}</span>
            <span>{bookmark.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Globe({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
      />
    </svg>
  );
}
