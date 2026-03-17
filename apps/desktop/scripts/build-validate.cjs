/**
 * Build script for the validation harness entry point.
 * Uses esbuild to compile validate.ts with the same externalization
 * pattern as electron-vite (all node_modules external).
 */
const path = require("path");

// Resolve esbuild from pnpm store (not hoisted to root node_modules/.bin)
let esbuild;
try {
  esbuild = require("esbuild");
} catch {
  // pnpm strict hoisting — find esbuild in the .pnpm store
  const glob = require("path");
  const fs = require("fs");
  const pnpmStore = path.resolve(__dirname, "../../../node_modules/.pnpm");
  const entries = fs.readdirSync(pnpmStore).filter((e) => e.startsWith("esbuild@"));
  if (entries.length === 0) {
    console.error("ERROR: esbuild not found. Run pnpm install first.");
    process.exit(1);
  }
  // Use the latest version
  entries.sort();
  const esbuildDir = path.join(pnpmStore, entries[entries.length - 1], "node_modules/esbuild");
  esbuild = require(esbuildDir);
}

const entryPoint = path.resolve(__dirname, "../src/main/validate.ts");
const outFile = path.resolve(__dirname, "../out/validate/main.mjs");

esbuild
  .build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile: outFile,
    // Externalize everything that electron-vite would externalize:
    // electron, all @openbrowse/* workspace packages, native modules
    external: [
      "electron",
      "@openbrowse/*",
      "better-sqlite3",
      "@anthropic-ai/sdk",
      "grammy"
    ],
    // Suppress warnings about require() in ESM
    logLevel: "warning"
  })
  .then(() => {
    console.log(`Built: ${outFile}`);
  })
  .catch((err) => {
    console.error("Build failed:", err);
    process.exit(1);
  });
