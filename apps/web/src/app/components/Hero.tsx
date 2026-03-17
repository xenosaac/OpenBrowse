import { ExternalLink } from "lucide-react";
import { Button } from "./ui/button";

export function Hero() {
  return (
    <section className="min-h-screen flex items-center justify-center px-6 relative overflow-hidden">
      {/* Gradient background effect */}
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-emerald-900/10 pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(16,185,129,0.15),transparent_50%)]" />

      <div className="max-w-5xl mx-auto text-center relative z-10">
        <div className="inline-block px-4 py-1.5 mb-6 rounded-full bg-emerald-500/10 border border-emerald-500/20">
          <span className="text-sm text-emerald-400">AI-driven autonomous browser agent</span>
        </div>

        <h1 className="text-6xl md:text-7xl lg:text-8xl mb-6 tracking-tight">
          Your browser works
          <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-emerald-600">
            while you don't.
          </span>
        </h1>

        <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mx-auto mb-12 leading-relaxed">
          An open-source browser autonomously operated and incrementally improved by AI.
          Get pinged on Telegram when it needs a decision, reply from your phone,
          and watch it resume exactly where it stopped.
        </p>

        <a href="https://github.com/xenosaac/OpenBrowse" target="_blank" rel="noopener noreferrer">
          <Button
            size="lg"
            className="bg-emerald-500 hover:bg-emerald-600 text-white px-8 py-6 text-lg h-auto"
          >
            <ExternalLink className="mr-2 h-5 w-5" />
            Deploy OpenBrowse
          </Button>
        </a>
      </div>
    </section>
  );
}
