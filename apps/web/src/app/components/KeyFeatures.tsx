import { Zap, Globe, Smartphone, HardDrive } from "lucide-react";
import { Card } from "./ui/card";

export function KeyFeatures() {
  const features = [
    {
      icon: Zap,
      title: "Persistent Agent",
      description: "Context and memory persist across steps. The agent doesn't reset or forget — it maintains full state throughout long-running tasks.",
    },
    {
      icon: Globe,
      title: "Real Browser",
      description: "Not a script runner or extension. This is a full-featured desktop browser with agent capabilities built directly into the core.",
    },
    {
      icon: Smartphone,
      title: "Remote Control via Telegram",
      description: "Get instant notifications when the agent needs input. Reply from anywhere — your phone, tablet, or another computer.",
    },
    {
      icon: HardDrive,
      title: "Local Memory",
      description: "All tasks, context, and data are saved locally on your machine. Your browsing data never leaves your device.",
    },
  ];

  return (
    <section className="py-32 px-6 bg-gradient-to-b from-transparent via-emerald-500/5 to-transparent">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-20">
          <h2 className="text-5xl mb-4">
            Built for power users
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            The features that make OpenBrowse a true autonomous agent
          </p>
        </div>
        
        <div className="grid md:grid-cols-2 gap-6">
          {features.map((feature, index) => (
            <Card
              key={index}
              className="p-8 bg-card/50 backdrop-blur-sm border-emerald-500/10 hover:border-emerald-500/30 transition-all duration-300 group"
            >
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-cyan-500/20 to-emerald-900/20 border border-emerald-500/30 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                <feature.icon className="w-7 h-7 text-emerald-400" />
              </div>
              
              <h3 className="text-2xl mb-3">
                {feature.title}
              </h3>
              
              <p className="text-muted-foreground leading-relaxed">
                {feature.description}
              </p>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
