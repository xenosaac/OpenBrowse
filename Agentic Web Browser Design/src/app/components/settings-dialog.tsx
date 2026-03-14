import { useState } from "react";
import {
  X,
  Key,
  Cpu,
  MessageSquare,
  Globe,
  Trash2,
  Shield,
  Save,
} from "lucide-react";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState("agent");
  const [apiKey, setApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState("gpt-4");
  const [telegramBot, setTelegramBot] = useState("");

  if (!isOpen) return null;

  const tabs = [
    { id: "agent", label: "Agent API", icon: Key },
    { id: "model", label: "Model Selection", icon: Cpu },
    { id: "telegram", label: "Telegram Bot", icon: MessageSquare },
    { id: "browser", label: "Browser Settings", icon: Globe },
  ];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#12121a] border border-[#2a2a3e] rounded-2xl shadow-2xl w-full max-w-3xl max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#2a2a3e] bg-gradient-to-r from-purple-900/20 to-transparent">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/10 rounded-lg">
              <Shield className="w-6 h-6 text-purple-400" />
            </div>
            <div>
              <h2 className="text-xl text-white">Settings</h2>
              <p className="text-sm text-gray-400">
                Configure your browser agent
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[#1e1e2e] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="flex h-[calc(80vh-120px)]">
          {/* Sidebar */}
          <div className="w-56 border-r border-[#2a2a3e] bg-[#0f0f18] p-3">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors mb-1 ${
                    activeTab === tab.id
                      ? "bg-purple-600 text-white"
                      : "text-gray-400 hover:bg-[#1a1a26] hover:text-gray-200"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-sm">{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === "agent" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg text-white mb-4">Agent API Configuration</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm text-gray-300 mb-2">
                        API Key
                      </label>
                      <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="sk-..."
                        className="w-full bg-[#1e1e2e] border border-[#2a2a3e] rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-300 mb-2">
                        API Endpoint
                      </label>
                      <input
                        type="text"
                        placeholder="https://api.openai.com/v1"
                        className="w-full bg-[#1e1e2e] border border-[#2a2a3e] rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                    <button className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-white transition-colors">
                      <Save className="w-4 h-4" />
                      Save API Settings
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "model" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg text-white mb-4">Model Selection</h3>
                  <div className="space-y-3">
                    {[
                      { id: "gpt-4", name: "GPT-4", desc: "Most capable model" },
                      { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo", desc: "Fast and efficient" },
                      { id: "claude-3", name: "Claude 3", desc: "Anthropic's model" },
                      { id: "gemini-pro", name: "Gemini Pro", desc: "Google's model" },
                    ].map((model) => (
                      <label
                        key={model.id}
                        className={`flex items-center gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                          selectedModel === model.id
                            ? "border-purple-500 bg-purple-500/10"
                            : "border-[#2a2a3e] bg-[#1a1a26] hover:border-purple-400/50"
                        }`}
                      >
                        <input
                          type="radio"
                          name="model"
                          value={model.id}
                          checked={selectedModel === model.id}
                          onChange={(e) => setSelectedModel(e.target.value)}
                          className="text-purple-600 focus:ring-purple-500"
                        />
                        <div className="flex-1">
                          <div className="text-white">{model.name}</div>
                          <div className="text-sm text-gray-400">{model.desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "telegram" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg text-white mb-4">Telegram Bot Integration</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm text-gray-300 mb-2">
                        Bot Token
                      </label>
                      <input
                        type="password"
                        value={telegramBot}
                        onChange={(e) => setTelegramBot(e.target.value)}
                        placeholder="1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZ"
                        className="w-full bg-[#1e1e2e] border border-[#2a2a3e] rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-300 mb-2">
                        Chat ID
                      </label>
                      <input
                        type="text"
                        placeholder="123456789"
                        className="w-full bg-[#1e1e2e] border border-[#2a2a3e] rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                    <button className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-white transition-colors">
                      <Save className="w-4 h-4" />
                      Connect Telegram Bot
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "browser" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg text-white mb-4">Browser Settings</h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-[#1a1a26] rounded-lg border border-[#2a2a3e]">
                      <div>
                        <div className="text-white">Clear Browsing History</div>
                        <div className="text-sm text-gray-400">
                          Remove all browsing history
                        </div>
                      </div>
                      <button className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg transition-colors flex items-center gap-2">
                        <Trash2 className="w-4 h-4" />
                        Clear
                      </button>
                    </div>

                    <div className="flex items-center justify-between p-4 bg-[#1a1a26] rounded-lg border border-[#2a2a3e]">
                      <div>
                        <div className="text-white">Clear Cookies</div>
                        <div className="text-sm text-gray-400">
                          Remove all stored cookies
                        </div>
                      </div>
                      <button className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg transition-colors flex items-center gap-2">
                        <Trash2 className="w-4 h-4" />
                        Clear
                      </button>
                    </div>

                    <div className="flex items-center justify-between p-4 bg-[#1a1a26] rounded-lg border border-[#2a2a3e]">
                      <div>
                        <div className="text-white">Clear Cache</div>
                        <div className="text-sm text-gray-400">
                          Remove cached data
                        </div>
                      </div>
                      <button className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg transition-colors flex items-center gap-2">
                        <Trash2 className="w-4 h-4" />
                        Clear
                      </button>
                    </div>

                    <div className="p-4 bg-[#1a1a26] rounded-lg border border-[#2a2a3e] space-y-3">
                      <div className="text-white">Default Search Engine</div>
                      <select className="w-full bg-[#1e1e2e] border border-[#2a2a3e] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
                        <option>Google</option>
                        <option>DuckDuckGo</option>
                        <option>Bing</option>
                        <option>Brave Search</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
