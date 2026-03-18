# Project OpenBrowse

OpenBrowse is a macOS-native agentic browser — a standalone desktop app that combines a full Chromium-based browser shell with an embedded AI task runtime. It browses real websites autonomously, suspends when it needs human input, and resumes from exactly where it stopped.

## What It Does

- **Real browser, real websites.** Not a script runner or extension — a full browser shell with tabs, address bar, bookmarks, history, and cookies.
- **Persistent task execution.** Long-running browser tasks that checkpoint, suspend for clarification or approval, and resume from the exact state.
- **Remote operator loop.** When the agent hits ambiguity, it sends a concise question to Telegram. The user replies from their phone. The task resumes.
- **Local-first memory.** SQLite-backed workflow logs, run checkpoints, and user preferences. Every run produces a structured handoff artifact for replay or continuation.
- **Risk-aware approvals.** Six named risk classes (financial, credential, destructive, submission, navigation, general) with per-class configurable approval policies.
- **Automated validation.** Headless validation harness runs predefined tasks against the real planner and browser, producing structured JSON results.

## Architecture

```
Desktop Shell (Electron)
  └── Runtime Composition
        └── OpenBrowseRuntime
              ├── Planner (Claude API — claude-sonnet-4-6, adaptive thinking, tool-use mode)
              ├── Browser Runtime (Chromium/CDP, managed profiles, page modeling)
              ├── Chat Bridge (Telegram bot with 3-tier routing, command handlers)
              ├── Memory Store (SQLite — WAL mode, schema v4, prepared statement caching)
              │     ├── RunCheckpointStore
              │     ├── WorkflowLogStore
              │     ├── PreferenceStore
              │     ├── ChatStore
              │     └── BrowserDataStore (bookmarks, history, cookies, profiles)
              ├── Scheduler (recurring watch tasks with exponential backoff)
              ├── Observability (event bus, replay, audit trail)
              └── Security (risk classification, approval policies, action gates)
```

### Interaction Model

`structured-first, browser-native, vision-assisted`

1. DOM / ARIA / extractable text / form state / browser context (primary)
2. Browser runtime state
3. Visual fallback — only when structured signals are insufficient

## Repository Layout

```
apps/
  desktop/              Electron shell — window lifecycle, IPC, renderer UI
packages/
  contracts/            Shared domain types (dependency-free)
  runtime-core/         Run lifecycle, planner loop, inbound routing
  planner/              Claude API gateway, tool mapping (20 browser tools), stub/scripted variants
  browser-runtime/      CDP sessions, managed profiles, page modeling, action execution
  chat-bridge/          Telegram bot adapter with auth, message splitting, clarification routing
  memory-store/         SQLite stores + in-memory fallbacks
  orchestrator/         Task state machine
  scheduler/            Recurring task intent generation
  observability/        Event bus, log replayer, audit trail
  security/             Approval gates, risk classification, policy enforcement
  taskpacks/            Live task pack definitions
  demo-flows/           Scripted demo flows and registry
docs/
  working_log.md        Single source of truth — architecture, decisions, session history
  product_manager.md    PM directives and program tracking
tests/                  Unit tests (1,398 tests across 56 files)
scripts/                Environment doctor, repair tools
benchmarks/             Performance validation
```

## Current State

All core feature phases are complete. The product is in validation and hardening.

| Phase | Status | Description |
|-------|--------|-------------|
| 1 | Done | Browser shell fundamentals — tabs, address bar, navigation, window drag |
| 2 | Done | UI information architecture — browser-first layout, agent sidebar, management panel |
| 3 | Done | Hybrid interaction engine — DOM/ARIA-first with vision fallback |
| 4 | Done | Persistent harness — checkpoint, handoff, resume, recovery with page model snapshots |
| 5 | Done | Remote operator loop — Telegram as first-class operator plane |
| 6 | Done | Safety and policy — risk classification, per-class approval, configurable policies |
| 7 | Done | Packaging and release — DMG/zip for arm64, hardened runtime, auto-update framework |

### What's Working

- Full browser shell with tabs, address bar, back/forward, refresh, bookmarks, history, cookies
- Live AI task execution against real websites with Claude planner
- Persistent task runs with checkpoint/resume/recovery
- Telegram clarification loop with inline keyboards and command handlers
- Scripted demo flows (travel search, appointment booking, price monitor)
- Risk-classified approval gates with per-class configurable policies
- Recovery mode with page model snapshots and form value restoration
- Cycle detection (2-5 step window) and soft failure handling with URL visit tracking
- Chat persistence to SQLite with single unified session
- DevTools, print, save-as-PDF
- Headless validation harness with structured JSON results
- DMG + zip packaging for Apple Silicon with hardened runtime entitlements
- 1,398 passing unit tests

## Live Task Packs

Live task packs use the real Claude planner against real websites. They require `ANTHROPIC_API_KEY` to be set.

| Task Pack | Description |
|-----------|-------------|
| Flight Search | Google Flights price comparison |
| Amazon Price Check | Product price and availability extraction |
| Web Research | Multi-source topic research with summary |
| Form Fill Assistant | Guided form completion with approval gates |
| Restaurant Lookup | Google Maps restaurant comparison |

## Prerequisites

- **macOS** on Apple Silicon (arm64)
- **Node.js 22 LTS** (pinned in `.nvmrc`)
- **pnpm 10.x** (`corepack enable && corepack prepare pnpm@10.32.1`)
- **Anthropic API key** for live task execution (`ANTHROPIC_API_KEY`)
- **Telegram bot token** (optional) for remote operator loop (`OPENBROWSE_TELEGRAM_BOT_TOKEN`)

## Build and Run

```bash
# Install dependencies
pnpm install

# Typecheck, build, and test
pnpm run typecheck
pnpm run build
pnpm run test

# Launch in dev mode
pnpm run dev

# Or use the safe launcher (checks environment first)
pnpm run dev:safe
```

### Environment Tools

```bash
pnpm run doctor:env    # Check Node version and critical dependencies
pnpm run repair:env    # Clean reinstall + native module rebuild
```

### SQLite Persistence

SQLite persistence requires `better-sqlite3` compiled for Electron's Node version. The `postinstall` script handles this automatically. If you encounter native module issues:

```bash
pnpm run native:rebuild
```

### Validation Harness

Run the headless validation suite against real websites:

```bash
ANTHROPIC_API_KEY=sk-... pnpm run validate
```

Runs 5 predefined tasks with configurable timeout, writes results to `validation-results.json`.

## Packaging

```bash
cd apps/desktop
pnpm run package          # DMG + zip for arm64
pnpm run package:dir      # Unpacked app directory
pnpm run package:unsigned  # Unsigned build (no code signing)
```

Code signing requires `CSC_LINK` and `CSC_KEY_PASSWORD` environment variables.

## Design Constraints

- **macOS + Apple Silicon only** — no cross-platform support planned
- **Standalone app, not a browser extension** — full control over the browser environment
- **Electron + WebContentsView** — embedded Chromium with managed profiles
- **Clarify, suspend, resume** — do not fail hard on missing preferences
- **App-managed browser profiles** — never attach to the user's primary Chrome profile
- **Model-agnostic planner interface** — not coupled to a single LLM provider

## License

MIT License. See [LICENSE](LICENSE) for details.
