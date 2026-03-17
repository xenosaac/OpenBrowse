import { Hero } from "./components/Hero";
import { HowItWorks } from "./components/HowItWorks";
import { KeyFeatures } from "./components/KeyFeatures";
import { WhatItIsNot } from "./components/WhatItIsNot";
import { DownloadCTA } from "./components/DownloadCTA";
import { Footer } from "./components/Footer";

export default function App() {
  return (
    <div className="min-h-screen bg-background text-foreground dark">
      <Hero />
      <HowItWorks />
      <KeyFeatures />
      <WhatItIsNot />
      <DownloadCTA />
      <Footer />
    </div>
  );
}
