import { X } from "lucide-react";

export function WhatItIsNot() {
  const notItems = [
    {
      title: "NOT a browser extension",
      description: "OpenBrowse is a standalone desktop application with deep agent integration.",
    },
    {
      title: "NOT a one-shot automation",
      description: "Tasks can run for hours or days, with persistent state and human-in-the-loop decisions.",
    },
    {
      title: "NOT a chatbot",
      description: "It's a real browser that you control, enhanced with an autonomous agent that acts on your behalf.",
    },
  ];

  return (
    <section className="py-32 px-6">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-5xl mb-4">
            What it's not
          </h2>
          <p className="text-xl text-muted-foreground">
            Let's set expectations clearly
          </p>
        </div>
        
        <div className="space-y-4">
          {notItems.map((item, index) => (
            <div
              key={index}
              className="p-6 rounded-xl border border-muted/50 bg-muted/10 flex items-start gap-4 hover:border-emerald-500/30 transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-muted/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                <X className="w-5 h-5 text-muted-foreground" />
              </div>
              
              <div>
                <h3 className="text-xl mb-2">
                  {item.title}
                </h3>
                <p className="text-muted-foreground">
                  {item.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
