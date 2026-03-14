# Project OpenBrowse

OpenBrowse is a macOS-only, Apple-silicon-only agentic browser shell.
It combines:

- OpenClaw-style remote, messaging-native workflow continuity
- a local-first task runtime with resumable execution and workflow logs
- a Chromium-based browser shell with full control over managed sessions
- embedded browser views inside a unified desktop window

## Product Thesis

OpenBrowse is not "browser automation with a chat window."

It is:

- a standalone browser app where task execution sessions are visible inside the main window
- a long-running task orchestrator that suspends, clarifies, and resumes
- a remote clarification loop over Telegram (or any future chat transport)
- a local workflow log + memory system backed by SQLite
- a live task platform that can browse real websites with an AI planner

The browser is only one subsystem inside the runtime.

## Design Constraints

- Platform: macOS only
- Hardware: Apple silicon only
- Product surface: standalone app, not a browser extension
- Engine strategy: reuse Chromium-based infrastructure (Electron + WebContentsView)
- Workflow principle: clarify, suspend, resume; do not fail hard on every missing preference

## Repository Layout

- `apps/desktop`
  - macOS browser shell, Electron window lifecycle, IPC surface, browser view manager, and runtime composition (Electron-specific wiring only)
- `packages/runtime-core`
  - single owner of runtime behavior: run bootstrap/resume/cancel/recover, settings hydration and persistence, planner/chat reconfiguration, descriptor rebuilds, downgrade helpers, and inbound chat wiring
- `packages/contracts`
  - shared domain types across all modules
- `packages/orchestrator`
  - task state machine and run coordination
- `packages/planner`
  - LLM-facing planning (Claude) and clarification interfaces, plus stub/scripted planner variants
- `packages/browser-runtime`
  - managed profile/session control, page modeling, CDP client, and embedded view support
- `packages/chat-bridge`
  - Telegram bot bridge with authorization, message splitting, and persistent clarification routing
- `packages/memory-store`
  - SQLite-backed workflow logs, run checkpoints, and user preferences
- `packages/scheduler`
  - recurring monitors and watch jobs with exponential backoff
- `packages/observability`
  - event bus, log replayer, and audit trail
- `packages/security`
  - approval policy with finalization/destructive/sensitive-field heuristics
- `packages/taskpacks`
  - live task pack definitions (flight search, price check, web research, form fill, restaurant lookup)
- `packages/demo-flows`
  - scripted demo flows (travel search, appointment booking, price monitor) and demo registry

## Current State

OpenBrowse is a work-in-progress. Structural extraction of runtime behavior into `packages/runtime-core` is ongoing.

| Phase | Status | Description |
|-------|--------|-------------|
| 1 | Done | Runnable Electron shell with main/preload/renderer split |
| 2 | Done | Real browser runtime over Electron/Chromium with managed profiles |
| 3 | Done | Telegram clarification loop with persistent auth and routing |
| 4 | Done | Scripted demo flows (travel search, appointment booking, price monitor) |
| 5 | Done | Safety gates, replay UI, recovery summaries, watcher backoff |
| 6 | Done | Runtime coherence, demo/watch routing, milestone cleanup |
| 7 | In progress | Unified browser shell, live task packs (gated), package structure extraction |

Note: phases reflect feature completeness only. The codebase is still being restructured — see `packages/runtime-core` for the canonical runtime ownership model.

## Live Task Packs

Beyond scripted demos, OpenBrowse ships live task packs that use the real Claude planner against real websites.
Live task packs require `ANTHROPIC_API_KEY` to be set. When the planner is in stub mode, the UI clearly marks them as unavailable and IPC rejects attempts to run them.

- **Flight Search** -- Google Flights price comparison
- **Amazon Price Check** -- product price and availability extraction
- **Web Research** -- multi-source topic research with summary
- **Form Fill Assistant** -- guided form completion with approval gates
- **Restaurant Lookup** -- Google Maps restaurant comparison

## Build And Verify

Use the root workspace as the authoritative entrypoint.

Use Node 22 LTS for this repo. Native desktop dependencies are currently unreliable under Node 25 on this machine, and SQLite rebuilds are expected to run through the Electron runtime rather than plain Node.

OpenBrowse now ships a small environment guard/repair module:

- `pnpm run doctor:env`
  - checks Node major version and validates critical install-tree entries (`electron`, `@electron/get`, `got`, `semver`, `rollup`)
- `pnpm run repair:env`
  - deletes workspace `node_modules`
  - reinstalls everything under Node 22
  - reruns `pnpm run native:rebuild`
- `pnpm run dev:safe`
  - refuses to launch if the environment doctor is not clean

1. `pnpm run typecheck`
2. `pnpm run build`
3. `pnpm run test`
4. Launch the desktop app in dev mode: `pnpm run dev`

If you want SQLite persistence instead of the runtime's in-memory fallback, run:

1. `nvm use` (the repo pins Node 22 in `.nvmrc`)
2. `pnpm install`
3. `HOME=$PWD pnpm run native:rebuild`
4. `pnpm run dev`

On this specific Mac, `nvm` is not installed. The shortest equivalent is:

1. `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`
2. `pnpm run repair:env`
3. `pnpm run dev`

Inside the app:

1. Start a freeform task from the header input
2. Open the **Browser** tab to see and switch between embedded browser sessions
3. Open the **Demos** tab to run scripted demos or launch live task packs
4. Answer clarification and approval prompts from the **Remote Questions** tab
5. Inspect replay and raw event timeline in the **Workflow Log** tab

## Packaging

```bash
cd apps/desktop
pnpm run package        # produces DMG + zip for arm64
pnpm run package:dir    # produces unpacked app directory
```

The build config targets Apple silicon only and includes hardened runtime entitlements.
Code signing requires setting `CSC_LINK` and `CSC_KEY_PASSWORD` environment variables.
