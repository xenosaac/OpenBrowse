import { createDesktopBootstrap, runBootstrapDemo } from "./bootstrap";

async function main(): Promise<void> {
  const bootstrap = createDesktopBootstrap();
  await runBootstrapDemo(bootstrap);
}

void main();

