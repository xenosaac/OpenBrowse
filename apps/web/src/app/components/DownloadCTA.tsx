import { Download } from "lucide-react";
import { Button } from "./ui/button";

export function DownloadCTA() {
  return (
    <section className="py-32 px-6 relative overflow-hidden">
      {/* Dark gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-900/20 via-background to-emerald-950/20" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_50%,rgba(16,185,129,0.15),transparent_70%)]" />

      <div className="max-w-4xl mx-auto text-center relative z-10">
        <h2 className="text-5xl md:text-6xl mb-6">
          Ready to run your first
          <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-emerald-600">
            hands-free browser task?
          </span>
        </h2>

        <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
          Join developers and power users who are already delegating hours of browser work to their AI agent.
        </p>

        <Button
          size="lg"
          className="bg-emerald-500 hover:bg-emerald-600 text-white px-10 py-7 text-xl h-auto"
        >
          <Download className="mr-2 h-6 w-6" />
          Download OpenBrowse
        </Button>
        
        <div className="mt-6 text-sm text-muted-foreground">
          Free to download · No credit card required
        </div>
      </div>
    </section>
  );
}
