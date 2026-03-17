import { Play, Bot, MessageSquare } from "lucide-react";

export function HowItWorks() {
  const steps = [
    {
      icon: Play,
      title: "Start a task",
      description: "Launch any browser task in OpenBrowse. Research, form filling, data gathering — just describe what you need done.",
    },
    {
      icon: Bot,
      title: "Agent runs autonomously",
      description: "The AI agent takes over and executes multi-step workflows. When it needs a decision or clarification, it pauses and pings you on Telegram.",
    },
    {
      icon: MessageSquare,
      title: "Reply & resume",
      description: "Answer from your phone wherever you are. The agent picks up exactly where it stopped, with full context intact.",
    },
  ];

  return (
    <section className="py-32 px-6 relative">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-20">
          <h2 className="text-5xl mb-4">
            How it works
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Three simple steps to hands-free browser automation
          </p>
        </div>
        
        <div className="grid md:grid-cols-3 gap-8 lg:gap-12">
          {steps.map((step, index) => (
            <div key={index} className="relative">
              {index < steps.length - 1 && (
                <div className="hidden md:block absolute top-16 left-[60%] w-[80%] h-0.5 bg-gradient-to-r from-emerald-500/50 to-transparent" />
              )}

              <div className="relative">
                <div className="text-sm font-medium text-emerald-400 mb-2">Step {index + 1}</div>
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-emerald-900/20 border border-emerald-500/30 flex items-center justify-center mb-6">
                  <step.icon className="w-8 h-8 text-emerald-400" />
                </div>
                
                <h3 className="text-2xl mb-3">
                  {step.title}
                </h3>
                
                <p className="text-muted-foreground leading-relaxed">
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
