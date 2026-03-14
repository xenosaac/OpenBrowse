import { useState } from "react";
import { Search, TrendingUp, Zap, Code, Database } from "lucide-react";

export function BrowserContent() {
  const [searchQuery, setSearchQuery] = useState("");

  const quickActions = [
    {
      icon: Search,
      title: "Web Search",
      desc: "Search the internet",
      color: "bg-blue-500/10 text-blue-400",
    },
    {
      icon: TrendingUp,
      title: "Market Data",
      desc: "Get real-time data",
      color: "bg-green-500/10 text-green-400",
    },
    {
      icon: Zap,
      title: "Quick Actions",
      desc: "Automate tasks",
      color: "bg-yellow-500/10 text-yellow-400",
    },
    {
      icon: Code,
      title: "Developer Tools",
      desc: "Inspect & debug",
      color: "bg-purple-500/10 text-purple-400",
    },
  ];

  const recentPages = [
    {
      title: "Hyperliquid Dashboard",
      url: "app.hyperliquid.xyz",
      time: "2 hours ago",
    },
    {
      title: "Trading Analytics",
      url: "analytics.example.com",
      time: "5 hours ago",
    },
    {
      title: "Documentation Hub",
      url: "docs.example.com",
      time: "Yesterday",
    },
    {
      title: "API Reference",
      url: "api.example.com",
      time: "2 days ago",
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-gradient-to-br from-[#0a0a12] via-[#0f0f18] to-[#12121a] p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Main Search */}
        <div className="text-center space-y-6 pt-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-purple-500/10 border border-purple-500/20 rounded-full">
            <Database className="w-4 h-4 text-purple-400" />
            <span className="text-sm text-purple-300">Powered by AI Agent</span>
          </div>
          
          <h1 className="text-4xl text-white">
            What can I help you browse today?
          </h1>

          <div className="relative max-w-2xl mx-auto">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search or ask your agent..."
              className="w-full bg-[#1e1e2e] border border-[#2a2a3e] rounded-2xl px-6 py-4 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 text-lg"
            />
            <button className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-purple-600 hover:bg-purple-700 rounded-xl transition-colors">
              <Search className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>

        {/* Quick Actions */}
        <div>
          <h2 className="text-lg text-white mb-4">Quick Actions</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {quickActions.map((action, idx) => {
              const Icon = action.icon;
              return (
                <button
                  key={idx}
                  className="p-4 bg-[#12121a] border border-[#2a2a3e] rounded-xl hover:border-purple-500/50 transition-all hover:scale-105 text-left group"
                >
                  <div className={`inline-flex p-3 rounded-lg mb-3 ${action.color}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="text-white group-hover:text-purple-300 transition-colors">
                    {action.title}
                  </div>
                  <div className="text-sm text-gray-400 mt-1">{action.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Recent Pages */}
        <div>
          <h2 className="text-lg text-white mb-4">Recent Pages</h2>
          <div className="space-y-2">
            {recentPages.map((page, idx) => (
              <button
                key={idx}
                className="w-full flex items-center justify-between p-4 bg-[#12121a] border border-[#2a2a3e] rounded-xl hover:border-purple-500/50 transition-all text-left group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-purple-500/10 rounded-lg flex items-center justify-center">
                    <Database className="w-5 h-5 text-purple-400" />
                  </div>
                  <div>
                    <div className="text-white group-hover:text-purple-300 transition-colors">
                      {page.title}
                    </div>
                    <div className="text-sm text-gray-400">{page.url}</div>
                  </div>
                </div>
                <div className="text-sm text-gray-500">{page.time}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Agent Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="p-4 bg-gradient-to-br from-purple-500/10 to-transparent border border-purple-500/20 rounded-xl">
            <div className="text-2xl text-white mb-1">247</div>
            <div className="text-sm text-gray-400">Pages Browsed</div>
          </div>
          <div className="p-4 bg-gradient-to-br from-blue-500/10 to-transparent border border-blue-500/20 rounded-xl">
            <div className="text-2xl text-white mb-1">89</div>
            <div className="text-sm text-gray-400">Tasks Automated</div>
          </div>
          <div className="p-4 bg-gradient-to-br from-green-500/10 to-transparent border border-green-500/20 rounded-xl">
            <div className="text-2xl text-white mb-1">12h</div>
            <div className="text-sm text-gray-400">Time Saved</div>
          </div>
        </div>
      </div>
    </div>
  );
}
