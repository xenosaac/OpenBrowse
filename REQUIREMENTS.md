# OpenBrowse Requirements

## System Requirements

| Requirement | Value |
|-------------|-------|
| Operating System | macOS 13+ (Ventura or later) |
| Architecture | Apple Silicon (arm64) |
| Node.js | 22 LTS (pinned in `.nvmrc`) |
| Package Manager | pnpm 10.x (`pnpm@10.32.1`) |
| Disk Space | ~500 MB (dependencies + Electron + Chromium) |

## Runtime Dependencies

### Core

| Package | Version | Purpose |
|---------|---------|---------|
| electron | ^39.1.0 | Desktop shell, Chromium engine, WebContentsView |
| react | ^19.2.4 | Renderer UI |
| react-dom | ^19.2.4 | React DOM bindings |
| better-sqlite3 | 12.6.2 | Local SQLite storage (WAL mode, schema v4) |
| @anthropic-ai/sdk | ^0.78.0 | Claude API client for AI planner |
| grammy | ^1.41.1 | Telegram bot framework for remote operator loop |

### Internal Packages (workspace)

All internal packages are linked via `workspace:*` references in the pnpm workspace.

| Package | Responsibility |
|---------|---------------|
| @openbrowse/contracts | Shared domain types (dependency-free) |
| @openbrowse/runtime-core | Run lifecycle, planner loop, inbound routing |
| @openbrowse/planner | Claude API gateway, tool mapping, stub/scripted variants |
| @openbrowse/browser-runtime | CDP sessions, managed profiles, page modeling, action execution |
| @openbrowse/chat-bridge | Telegram bot adapter, message routing, clarification handling |
| @openbrowse/memory-store | SQLite stores, in-memory fallbacks, prepared statement caching |
| @openbrowse/orchestrator | Task state machine and run coordination |
| @openbrowse/scheduler | Recurring task intent generation |
| @openbrowse/observability | Event bus, log replayer, audit trail |
| @openbrowse/security | Approval gates, risk classification, policy enforcement |
| @openbrowse/taskpacks | Live task pack definitions |
| @openbrowse/demo-flows | Scripted demo flows and registry |

## Development Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| typescript | ^5.9.3 | TypeScript compiler (strict mode, ESM) |
| electron-vite | ^5.0.0 | Electron build tooling |
| electron-builder | ^26.0.12 | App packaging (DMG, zip) |
| @electron/rebuild | 4.0.1 | Native module rebuild for Electron's Node |
| vite | ^7.3.1 | Frontend bundler |
| @vitejs/plugin-react | ^5.1.4 | React support for Vite |
| @types/react | ^19.2.14 | React type definitions |
| @types/react-dom | ^19.2.3 | React DOM type definitions |

## Environment Variables

### Required for Live Tasks

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude planner. Without this, only stub/scripted modes are available. |

### Optional — Telegram Integration

| Variable | Description |
|----------|-------------|
| `OPENBROWSE_TELEGRAM_BOT_TOKEN` | Telegram bot token for remote operator loop |
| `OPENBROWSE_TELEGRAM_CHAT_ID` | Default Telegram chat ID for notifications |
| `OPENBROWSE_TELEGRAM_NOTIFY_LEVEL` | Notification verbosity: `quiet` (default) or `verbose` |

### Optional — Code Signing

| Variable | Description |
|----------|-------------|
| `CSC_LINK` | Path to code signing certificate (`.p12`) |
| `CSC_KEY_PASSWORD` | Password for the code signing certificate |

## Native Module Constraints

`better-sqlite3` is a native Node addon that must be compiled for Electron's internal Node version (NODE_MODULE_VERSION 140). The `postinstall` script handles this automatically via `electron-rebuild`. If the native module fails to load:

```bash
pnpm run native:rebuild
```

Do not run SQLite-dependent code under system Node — always use the Electron context.

## Database Schema

SQLite database in WAL mode, currently at schema version 4.

| Version | Tables |
|---------|--------|
| v1 | `workflow_events`, `run_checkpoints`, `user_preferences`, `schema_meta` |
| v2 | Added `status`, `goal`, `created_at` columns to `run_checkpoints` + indexes |
| v3 | Added `idx_workflow_events_created_at` index for `listRecent()` performance |
| v4 | Added `browser_sessions`, `chat_sessions`, `chat_messages`, `chat_session_runs`, `bookmarks`, `browsing_history`, `browser_profiles`, `cookie_containers`, `user_accounts`, `standalone_tabs`, `chat_bridge_state` |

## Browser Capabilities

The Electron-embedded Chromium provides:

- Full web standards support (HTML5, CSS3, ES2024+)
- Chrome DevTools Protocol (CDP) for programmatic control
- WebContentsView for embedded browser surfaces
- Managed browser profiles (isolated from user's Chrome profile)
- Cookie container isolation per profile
- Hardened runtime entitlements for macOS

## Planner Requirements

The Claude planner operates in tool-use mode with 20 browser tool definitions:

- Model: `claude-sonnet-4-6` with adaptive thinking
- Token budget: 4,096 max output tokens
- Element cap: 150 elements per page model
- Visible text cap: 3,000 characters (extract: 4,000)
- Action history cap: 25 entries
- Cycle detection: 2-5 step window
- URL visit tracking: warn at 4 visits, fail at 6
- Max loop steps: 35 per task run
- Timeout: 60 seconds per planner call
- Navigation: double-retry with exponential backoff
