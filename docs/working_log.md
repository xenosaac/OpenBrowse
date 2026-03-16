# OpenBrowse Working Log

This is the single source of truth for project context, product vision, architecture decisions, implementation history, and open problems. All future agents and collaborators should read this before making any structural changes.

---

## Table of Contents

1. [Product Vision](#1-product-vision)
2. [What OpenBrowse Is Not](#2-what-openbrowse-is-not)
3. [Reference Products](#3-reference-products)
4. [Architecture](#4-architecture)
5. [Module Map](#5-module-map)
6. [Task Lifecycle](#6-task-lifecycle)
7. [Implementation Phases](#7-implementation-phases)
8. [Work Log — What Has Been Built](#8-work-log--what-has-been-built)
9. [Open Problems and Gaps](#9-open-problems-and-gaps)
10. [Engineering Notes and Constraints](#10-engineering-notes-and-constraints)
11. [Architectural Rules](#11-architectural-rules)
12. [Agent Collaboration Model](#12-agent-collaboration-model)
13. [Detailed Session Logs](#13-detailed-session-logs)
14. [Feature Backlog](#14-feature-backlog)

---

## 1. Product Vision

**One-sentence definition:**

> OpenBrowse is a persistent browser-native agent harness: a real browser shell with hybrid web interaction, local-first workflow memory, and remote operator control.

**Four-part definition:**

> Browser shell + hybrid web interaction engine + persistent harness + remote operator loop

**In plain language:**

- It is a real browser, not a script runner or extension
- The browser has a built-in agent
- That agent is not a one-shot executor — it runs persistently
- When it hits an ambiguity, it pauses and asks the user a minimal question
- The user answers from Telegram (not from the machine)
- The task resumes from the exact checkpoint where it stopped
- When a task ends, another agent can pick up from the local handoff log
- The browser looks and behaves like a real browser, not a control panel

**The core product behavior:**

1. User starts a browser task
2. Agent operates autonomously when possible
3. When a decision is missing, the agent sends a concise remote clarification question
4. User replies from Telegram
5. The same task run resumes from checkpoint

**The product goal is not "perfect autonomous execution." It is: long browser tasks that do not collapse when the user is away from the machine.**

---

## 2. What OpenBrowse Is Not

- Not a browser extension
- Not a cross-platform automation framework
- Not a CLI-first developer tool
- Not a one-shot run-and-done browser agent
- Not a pure vision / screenshot CUA browser (vision is a fallback, not the primary mode)
- Not a pure DOM automation framework (too brittle for complex, dynamic UIs)
- Not just "an LLM wrapped around a browser"

**Why pure vision (screenshot-first CUA) doesn't work here:**
- Too slow and too expensive for long-running tasks
- High token cost per step
- Not stable enough across dynamic UIs
- Doesn't scale to persistent multi-step workflows

**Why pure DOM automation doesn't work here:**
- Brittle on complex or dynamic UIs
- Doesn't behave naturally enough
- Can't handle everything a real browser user encounters

**The right interaction model:** `structured-first, browser-native, vision-assisted`

Priority order:
1. DOM / ARIA / extractable text / form state / browser context (primary)
2. Browser runtime state
3. Visual fallback — only when structured signals are insufficient

---

## 3. Reference Products

OpenBrowse borrows from two distinct references, and the product thesis is the combination of both.

### From Atlas / ChatGPT Agent

- Browser-native interaction
- Browser shell as the product body, not a container
- Browser context and session management
- Agent mode embedded inside the browser
- Interaction that looks like a human using a browser, not DOM scripts

**Key insight:** The browser is the product, not the automation runtime.

### From OpenClaw

- Long-running task persistence
- Suspend / resume / recover semantics
- Remote chat-based control loop
- Local-first logs and memory
- Run checkpointing and handoff
- Agent-to-agent handoff via structured logs

**Key insight:** The real moat is not "can it click" — it is the persistent harness that keeps tasks alive.

### The OpenBrowse Combination

Atlas-style **browser embodiment** + OpenClaw-style **long-running harness**.

Not one or the other. Both together.

---

## 4. Architecture

### System Shape

```
Desktop Shell (Electron)
  └── Runtime Composition (bootstrap / composeRuntime)
        └── OpenBrowseRuntime
              ├── Planner (ClaudePlannerGateway / StubPlannerGateway)
              ├── Browser Runtime (ElectronBrowserKernel / StubBrowserKernel)
              ├── Chat Bridge (TelegramChatBridge / StubChatBridge)
              ├── Memory Store
              │     ├── RunCheckpointStore (Sqlite / InMemory)
              │     ├── WorkflowLogStore (Sqlite / InMemory)
              │     └── PreferenceStore (Sqlite / InMemory)
              ├── Scheduler
              ├── Observability
              └── Security
```

### Process Boundaries

**Desktop Shell (`apps/desktop`)**
- Thin. Owns window/tab UI, profile selection, task console, settings, IPC entry points.
- Starts the runtime but does not own business logic.
- Main process: `bootstrap.ts` → `composeRuntime.ts` → `hydrateRuntimeSettings`
- Renderer: React-based shell UI

**Runtime Composition**
- Wires all modules together and owns lifecycle
- Boot services, inject configuration, register IPC handlers, start schedulers, recover unfinished runs
- Entry: `apps/desktop/src/main/runtime/composeRuntime.ts`

**OpenBrowseRuntime (`packages/runtime-core`)**
- The product core / orchestrator
- Owns: run creation, state transitions, clarification suspension, resume after user replies, finalization, checkpointing
- Equivalent to the assistant/session workflow brain scoped to browser tasks
- Key methods: `bootstrapRun`, `bootstrapRunDetached`, `handleInboundMessage`, `cancelTrackedRun`, `writeHandoff`

**Planner (`packages/planner`)**
- Turns a task goal + current run state + page model into one next decision
- Returns one of: `browser_action`, `clarification_request`, `approval_request`, `task_complete`, `task_failed`
- Model-agnostic by design
- `ClaudePlannerGateway`: uses Claude API (`claude-sonnet-4-6`), adaptive thinking, structured JSON output schema

**Browser Runtime (`packages/browser-runtime`)**
- Provides controlled access to Chromium sessions via CDP
- Managed browser profiles, session attach/create, page modeling, action execution, navigation snapshots
- Exposes product-level contracts, never raw browser APIs
- `ElectronBrowserKernel`: real CDP-based implementation
- `CdpClient`: per-page CDP wrapper with cached `globalThis` objectId for fast `callFunction`

**Chat Bridge (`packages/chat-bridge`)**
- Translates between external message channels and task runs
- Send clarification questions, route replies back to suspended runs, stream progress, notifications
- `TelegramChatBridge`: full Telegram bot implementation with three-tier chatId routing, command handlers, state persistence
- Never owns workflow state

**Memory Store (`packages/memory-store`)**
- Local-first, split into three concerns:
  - `WorkflowLogStore`: append-only event log per run (SQLite with `run_id` index)
  - `RunCheckpointStore`: full `TaskRun` JSON blob + indexed `status`/`goal`/`updated_at` columns
  - `PreferenceStore`: key-value user settings by namespace
- `SqliteDatabase`: `better-sqlite3` wrapper, WAL mode, schema migrations (currently v3)
- All stores cache prepared statements as instance properties (important: `better-sqlite3` does not cache `prepare()` calls)

**Scheduler (`packages/scheduler`)**
- Owns recurring watch tasks (unread summaries, price monitors, etc.)
- Creates task intents, does not implement task logic
- Schedulers do not invent separate execution paths — they reuse the main task lifecycle

**Observability (`packages/observability`)**
- Append-only event log, audit trail, run timeline
- First-class module because agentic browser products are unreplayable without it

**Security (`packages/security`)**
- Decides whether a step may proceed
- Irreversible action gates, purchase/send/submit approval policies, secret references

---

## 5. Module Map

| Package | Responsibility | Key Rule |
|---|---|---|
| `contracts` | Shared domain language (types only) | Dependency-free. Never modified lightly. |
| `runtime-core` | Run lifecycle, planner loop, inbound routing | Product brain. Do not move logic to desktop shell. |
| `planner` | LLM decision interface | Model-provider-agnostic. Never calls browser directly. |
| `browser-runtime` | CDP sessions, page models, action execution | Never makes policy decisions. |
| `chat-bridge` | Remote message channel adapter | Never owns workflow state. |
| `memory-store` | Runs, events, preferences | Append-first. Must preserve replayability. |
| `scheduler` | Recurring task intent generation | Creates intents, never executes browser logic. |
| `observability` | Event bus, replay, run timelines | First-class, not optional. |
| `security` | Approval gates, irreversible action policy | Never bleeds into browser-runtime. |
| `demo-flows` | Scripted demo task flows | Not mixed with live browser runtime. |
| `taskpacks` | Live task pack definitions | Used with real ClaudePlannerGateway. |
| `orchestrator` | (legacy/delegated) | Being absorbed into runtime-core. |
| `apps/desktop` | Electron shell, IPC, renderer UI | Thin. No business logic. |

---

## 6. Task Lifecycle

### Task States

```
queued → running → suspended_for_clarification → running → completed
                 → suspended_for_approval → running → completed
                                           → cancelled (if denied)
       → failed
       → cancelled
```

### Full Lifecycle

**1. Intake**
- Source: desktop app, Telegram message, or scheduled watcher
- System creates a `TaskIntent` with goal, constraints, source channel, metadata

**2. Run Creation**
- Runtime creates `TaskRun` with stable id, source channel, chosen browser profile, goal/constraints, initial checkpoint state

**3. Browser Attachment**
- Browser runtime reuses a warm managed session or creates a fresh one
- Produces a `PageModel` (never leaks raw DOM state)

**4. Planner Loop**
- Planner receives: user goal, run checkpoint, current page model, prior clarifications, action history
- Returns one decision per call
- Decisions: `browser_action` | `clarification_request` | `approval_request` | `task_complete` | `task_failed`
- Step progress notifications fire if `shouldSendStepProgress()` returns true (verbose mode)

**5. Clarification Suspension**
- Store checkpoint
- Emit `ClarificationRequest`
- Mark run `suspended_for_clarification`
- Send question through chat bridge with inline keyboard options
- Run is not discarded — it waits

**6. Approval Suspension**
- Same as clarification but `suspended_for_approval`
- Denied approvals cancel the run
- Approved actions execute the pending browser action and resume

**7. Resume**
- Chat bridge routes reply to the correct suspended run by `runId`
- Runtime restores checkpoint (including last known URL)
- Re-enters planner loop

**8. Termination**
- All terminal paths (complete, failed, cancelled) call `notifyTerminalEvent` + `clearRunState`
- `notifyTerminalEvent`: sends rendered handoff markdown to Telegram
- `clearRunState`: removes stale Telegram inline keyboards
- `writeHandoff`: writes handoff artifact to local store

**9. Logging**
- Every transition writes to workflow log: run_started, page_modeled, action_executed, clarification_requested, clarification_answered, approval_requested, approval_answered, run_completed, run_failed, run_cancelled

**10. Watchers**
- Recurring watch tasks are just recurring `TaskIntent` objects
- They reuse the full lifecycle with no separate execution path

### Handoff Artifact

Every run produces a `RunHandoffArtifact` — a human/agent-readable context block:
- goal, constraints, source, status
- current URL, page title, page summary
- actions already taken (step, type, description, outcome)
- why it stopped
- next suggested step
- pending clarification / approval question
- failure class
- notes for next agent

**This is critical.** True handoff is not restoring a database record. It is restoring "working context."

---

## 7. Implementation Phases

### Original plan phases (from IMPLEMENTATION_PLAN.md)

| Phase | Focus |
|---|---|
| 0 | Framework lock-in: module boundaries, contracts, local log format |
| 1 | Runnable skeleton: real Electron wiring, persistent store, prove run/resume |
| 2 | Browser runtime: real CDP sessions, page model capture, narrow action set |
| 3 | Remote clarification loop: Telegram adapter, reply→runId mapping, resume from checkpoint |
| 4 | First demo tasks: travel search, appointment booking, unread monitor |
| 5 | Safety and recovery: approval gates, crash recovery, watcher backoff |
| 6 | Integration cleanup: coherent scripted vs live runtime, milestone surface refresh |
| 7 | Live task packs and release hardening: visible browser shell unified, packaging |

### Updated product-level build order

Based on updated product vision (from 产品设想总纲):

| Phase | Focus |
|---|---|
| 1 | Browser Shell Fundamentals: tabs, address bar, navigation, browser controls, window drag |
| 2 | UI Information Architecture: left agent workspace, remote questions in conversation, settings as management panel, demos from top bar |
| 3 | Hybrid Interaction Engine: upgrade from DOM-first to browser-native hybrid |
| 4 | Persistent Harness: task state machine, checkpoint, handoff log, resume/recovery as real moat |
| 5 | Remote Operator Loop: Telegram as first-class operator plane |
| 6 | Safety / Policy: approval/denial/risk policy complete |
| 7 | Replatform Decision Gate: evaluate whether to stay on Electron or move to deeper browser base |

### Current status (as of 2026-03-14)

- **Phases 1-5 are substantially complete** as implemented work
- Phase 4 (ChatBridge / Remote Operator Loop) was just completed in full detail
- Phase 6 (Safety) is partially in place
- Phase 7 (replatform) has not been evaluated yet

---

## 8. Work Log — What Has Been Built

### Session 1 — Project Skeleton (early 2026)

- Monorepo layout: `apps/desktop` + all domain packages
- Initial TypeScript contracts (`tasks.ts`, `browser.ts`, `messages.ts`, `runtime.ts`)
- Architecture docs, task lifecycle docs, handoff docs
- Stub modules for all packages (planner, browser-runtime, chat-bridge, memory-store, scheduler, observability, security)
- Placeholder desktop runtime composition

### Session 2 — Runnable Desktop Skeleton (Phase 1)

- Real Electron main/preload/renderer wiring
- `electron-vite` build setup
- IPC handlers registered
- Runtime composition wired (`composeRuntime.ts`)
- Persistent SQLite store integrated (`better-sqlite3`, WAL mode, schema v1)
- In-memory fallbacks for all store interfaces
- TypeScript build passing end-to-end

### Session 3 — Browser Runtime (Phase 2)

- `ElectronBrowserKernel`: real CDP-based browser session management
- Managed browser profiles with app-owned data directories
- `CdpClient`: CDP wrapper per page with `callFunction`, `evaluate`, `captureScreenshot`
- `PageModelCapture`: DOM→`PageModel` bridge via accessibility tree extraction
- Real action set: `navigate`, `click`, `type`, `scroll`, `select`, `focus`, `hover`, `keyboard_shortcut`, `wait`, `extract`
- `AppBrowserShell`: `WebContentsView`-based visible browser surface
- Tab management: create, close, navigate tabs from UI
- Address bar wired to real navigation
- Back/forward/refresh controls

### Session 4 — Remote Clarification Loop (Phase 3/4 partial)

- `TelegramChatBridge` initial implementation
- GrammY bot library integration
- Inbound message normalization into `TaskMessage`
- `ClarificationRequest` sent as inline keyboard
- Reply routing: `runId` extracted from callback data
- `TelegramStateStore`: persistent state for approved chats, pending clarifications (reply-to mapping)
- `wireInboundChat`: wired in runtime, routes replies to `handleInboundMessage`
- Suspended run resume via Telegram reply

### Session 5 — UI, Task Console, Demo Flows (Phase 4/5)

- Renderer task console: active runs, suspended runs, workflow log view
- Remote questions UI: per-run answer inputs, Approve/Deny buttons for approvals
- `demo-flows` package: scripted demo flow registry
- Demo flows: travel search, appointment booking, unread monitor
- `taskpacks` package: live task pack definitions
- Scheduler: interval-based recurring task scheduler
- Browser shell tab list wired to task run descriptors
- Approval suspension: `suspended_for_approval` state, approval/denial handling
- `run_cancelled`, `approval_answered` workflow events added

### Session 6 — Runtime Stabilization and Shell Migration (commit `8029dc6`)

Major refactor: runtime-core stabilization, browser workflow fixes, shell UI migration.

Key changes:
- `OpenBrowseRuntime` moved to `packages/runtime-core`
- `plannerLoop` hardened: max-step exhaustion now marks run `failed`, not silent continue
- Failed browser actions now properly fail the run
- Recovery: resumed runs restore last known URL before re-entering planner loop
- `AppBrowserShell`: `WebContentsView`-based, properly attached to main window
- Shell/runtime alignment: session preview, run-state inspection tightened
- `RuntimeSettings`: hot-reload support (settings changes restart chatBridge, rewire planner)

### Session 7 — Performance Benchmarks and ChatBridge Completion (2026-03-14)

**Performance fixes:**

1. `InMemoryWorkflowLogStore.listByRun` — was O(n) linear scan. Fixed: added `byRun = new Map<string, WorkflowEvent[]>()` secondary index → O(1) lookup. Result: 10.74 µs/op → 0.16 µs/op (67× speedup).

2. `CdpClient.callFunction` — was doing a `Runtime.evaluate("globalThis")` round-trip on every call. Fixed: cache `contextObjectId` per page instance. Stale-cache retry on error. `invalidateContext()` called after navigate/click/keyboard_shortcut. Result: eliminates one full CDP round-trip per action call.

3. `benchmarks/run.mjs` SQLite section crash — `better-sqlite3` compiled for NODE_MODULE_VERSION 140; system Node v25.8.0 requires 141. Fixed: try/catch with `sqliteAvailable` flag, graceful skip message.

**ChatBridge (Phase 4 — complete):**

Additions to `contracts`:
- `"scheduler"` added to `MessageChannel`
- `chatId?: string` added to `TaskMessage`
- `telegramNotificationLevel: "quiet" | "verbose"` added to `RuntimeSettings`

`TelegramStateStore` additions:
- `runChatMappings: Record<string, string>` persisted (runId → chatId)
- `bindRunToChat(runId, chatId)`, `resolveRunChatId(runId)`, `clearClarificationsForRun(runId)`

`TelegramConfig` additions:
- `TelegramNotificationLevel` type
- `notificationLevel` field, env: `OPENBROWSE_TELEGRAM_NOTIFY_LEVEL`

`ChatBridge` interface additions:
- `shouldSendStepProgress(): boolean`
- `clearRunState?(runId): Promise<void>` (optional)
- `StubChatBridge` implements both as no-ops

`TelegramChatBridge` major additions:
- Three-tier outbound chatId routing: per-run binding → config.chatId → primaryChatId (synchronous, O(1))
- `/status`, `/list`, `/cancel [runId]`, `/handoff [runId]` bot commands with auth check
- `bot.api.setMyCommands(...)` in `start()` for Telegram autocomplete
- `setCommandHandler(handler)` for runtime command closure
- `bindRunToChat`, `clearRunState`, `shouldSendStepProgress` implemented
- Slash-command messages filtered from `message:text` handler
- `chatId` populated in all outbound `TaskMessage` objects

`OpenBrowseRuntime` additions:
- `notifyTerminalEvent(services, run)` — module-level, centralized terminal notification
- `wireBotCommands(services)` — exported, instanceof check, wires full command handler closure
- `handleNewTaskMessage(services, message)` — creates task from plain Telegram text, binds chatId
- `handleInboundMessage`/`Detached`: routes no-runId messages → `handleNewTaskMessage` (slash commands pass through)
- `writeHandoff(run)`: now calls `notifyTerminalEvent` + `clearRunState` — single terminal path
- `cancelTrackedRun`: calls `notifyTerminalEvent` + `clearRunState`
- `plannerLoop`: step-progress notification guarded by `shouldSendStepProgress()`
- `initializeTask`: sends start confirmation for `source === "telegram"` or `"scheduler"`
- `markChatBridgeInitFailed`: also calls `wireBotCommands`

`settings.ts`:
- `createChatBridge`: passes `notificationLevel` from `RuntimeSettings`
- `readStoredRuntimeSettings`: reads `telegram_notification_level`
- `saveRuntimeSettings`: writes `telegram_notification_level`
- `applyRuntimeSettings`: calls `wireBotCommands` alongside `wireInboundChat`

`bootstrap.ts`:
- Imports and calls `wireBotCommands(services)` after `wireInboundChat`

### Session 8 — Storage + Planner Fixes (2026-03-14)

**Storage performance root cause:** `better-sqlite3` does NOT cache `prepare()` calls — each invocation recompiles the SQL. All three SQLite store classes were calling `db.prepare(sql)` on every method call.

Fixed:
- `SqliteWorkflowLogStore`: 5 prepared statements cached as constructor-initialized instance properties
- `SqliteRunCheckpointStore`: 5 prepared statements cached
- `SqlitePreferenceStore`: 4 prepared statements cached

**Schema v3 migration added:**
- `CREATE INDEX idx_workflow_events_created_at ON workflow_events(created_at DESC, id DESC)`
- Fixes `listRecent()` full table scan → O(log n) + O(limit)

**Planner fixes:**
- `maxTokens`: 1024 → 4096. Old limit caused truncated outputs on complex page states → silent `task_failed` returns.
- Adaptive thinking: `thinking: { type: "adaptive" }` added for complex navigation reasoning.
- Structured output schema: `output_config.format` with flat JSON schema guarantees syntactically valid JSON output. Eliminates the brace-depth extraction fallback in `parsePlannerResponse`.

**MCP design review verdict:** The current text→JSON architecture is correct for OpenBrowse's code-orchestrated loop. `@playwright/mcp` would be a different architecture, not a fix. No rewrite needed.

---

## 9. Open Problems and Gaps

### Resolved (kept for historical context)

**~~1. Browser/Product Unification~~** — RESOLVED (Session 12, commit d414713)

`ElectronBrowserKernel` now uses `EmbeddedViewProvider` to create `WebContentsView`s inside the main window. Hidden `BrowserWindow` fallback exists only for headless/stub environments. `AppBrowserShell` implements `EmbeddedViewProvider`, so all agent task tabs live in the same visible browser surface as standalone tabs. Real-time UX: tab status dots, `AgentActivityBar`, run context card.

**~~2. UI Information Architecture~~** — RESOLVED (Phase 2, Session 11)

Browser-first layout implemented: center=browser, left=agent sidebar, top=browser chrome with tabs/address bar/controls. Settings/demos/profiles/workflow in `ManagementPanel` bottom-sheet. Home page is a new-tab page, not a dashboard. Remaining polish items listed under "UI Polish" below.

**~~3. Recovery Depth~~** — RESOLVED (Session 14, 2026-03-15)

Recovery now persists a lightweight page model snapshot per step (`lastPageModelSnapshot` in `RunCheckpoint`: title, summary, visibleText capped at 500 chars, formValues capped at 20 entries, scrollY). On resume, `continueResume()` injects `recoveryContext` so the planner receives a `RECOVERY MODE` prompt section with pre-interruption page title, summary, lost form values, and scroll position. Recovery context is consumed by exactly one planner call, then cleared. Standalone tabs persist to JSON and restore on app restart.

**~~5. Safety / Policy Layer~~** — RESOLVED (overlaps with #4)

`DefaultApprovalPolicy` in `packages/security/src/ApprovalPolicy.ts` is not a stub. It has keyword-based risk classification (critical/high/medium/low), three approval modes (strict/auto/default), and risk-tiered denial outcomes (deny-cancel for critical/high, deny-continue for medium/low).

**~~6. Tests~~** — RESOLVED (Session 18, 2026-03-15)

126 tests across 15 files. Session 18 expanded from 77→126 with three new test files (recovery-flow, store-contract, planner-loop) plus 3 InMemory store bug fixes. All three identified gaps (recovery flow, store contracts, planner loop) closed. SQLite-specific tests (schema migrations, prepared statement caching, WAL pragmas) deferred — these are infrastructure concerns that can only run under Electron context due to `better-sqlite3` NODE_MODULE_VERSION mismatch; the store contract is fully tested via InMemory implementations.

**~~7. UI Polish (Phase 2 leftovers)~~** — RESOLVED (Session 17, 2026-03-15)

~~Keyboard shortcuts~~, ~~back/forward disabled states~~, ~~loading indicator~~, ~~tab overflow~~, ~~favicons~~, ~~inline cancel-run~~ — all done. Cancel button added to LiveTasks run cards for non-terminal states, threaded through ManagementPanel → App.

**~~8. Handoff Viewer UI~~** — RESOLVED (Session 17, 2026-03-15)

`HandoffViewer.tsx` added as a "Handoff" sub-tab in Sessions. Fetches markdown via `getRunHandoff()` preload API, displays in styled `<pre>` block with run selector dropdown and "Copy to Clipboard" button. Window type declaration updated with `getRunHandoff` signature.

**~~9. Approval Semantics Refinement~~** — RESOLVED (Session 19, 2026-03-15)

Named risk classes (`financial`, `credential`, `destructive`, `submission`, `navigation`, `general`) added across the full stack: contracts, security policy, orchestrator, runtime settings, and UI. Each action is classified into a primary risk class (priority: financial > credential > destructive > submission > navigation > general) and the class is shown in the approval UI as a colored badge. Per-class configurable policies (`always_ask`, `auto_approve`, `default`) persisted in RuntimeSettings and configurable in the Settings panel. `always_ask` overrides all run modes; `auto_approve` is overridden by strict mode. 141 tests (15 new), all pass.

### Lower Priority

**~~1. Repo Hygiene~~** — RESOLVED

- Build artifacts (`dist/`, `out/`, `build/`, `*.tsbuildinfo`) confirmed properly gitignored and untracked.
- Fixed: `pnpm-lock.yaml` removed from `.gitignore` so lock file is committed for deterministic installs.
- Fixed: `docs/working_log.md` added as `!docs/working_log.md` exception so the project's single source of truth survives fresh clones. Other stale docs remain ignored.

**2. Replatform Decision Gate**

At the end of the current build arc, evaluate:
- Is Electron + embedded Chromium still sufficient?
- Consider: Chromium fork, CEF, or other deeper browser base
- Do not evaluate this until: browser shell fundamentals, UI IA, hybrid interaction, and persistent harness are all stable

---

## 10. Engineering Notes and Constraints

### Platform

- macOS only, Apple Silicon (arm64)
- Electron + embedded Chromium/WebContentsView
- `better-sqlite3` for SQLite (native Node addon — must match Electron's NODE_MODULE_VERSION)
- GrammY for Telegram bot
- pnpm workspace monorepo
- TypeScript with strict settings, ESM modules throughout

### Critical: `better-sqlite3` NODE_MODULE_VERSION

`better-sqlite3` is a native Node addon compiled for Electron's Node (MODULE_VERSION 140). System Node (v25.8.0) requires MODULE_VERSION 141. Running benchmarks or tests with system Node will fail on SQLite section. Always run SQLite-dependent code under Electron context.

### Critical: Prepared Statement Caching

`better-sqlite3` does NOT cache `db.prepare(sql)` calls. Each call recompiles the SQL. All SQLite store classes must cache their prepared statements as constructor-initialized instance properties. This is already done in the current implementation — do not regress this.

### Key Invariants

**Double-notification prevention:** `handleNewTaskMessage` has no `onSettled` callback. `writeHandoff` is the single terminal notification path (called from all class-method terminal paths). Only `cancelTrackedRun` explicitly calls `notifyTerminalEvent` + `clearRunState` separately.

**chatId binding timing:** `bindRunToChat` is called after `bootstrapRunDetached` returns the run id. The start confirmation fires from `initializeTask` before binding exists, routing via `primaryChatId`. All subsequent messages (steps, terminal) use the per-run binding. This is correct.

**Circular import prevention:** `wireBotCommands` uses `instanceof TelegramChatBridge` check (same pattern as `wireInboundChat`). `runtime-core` already imports `chat-bridge`. No circular dependency.

**Page model element cap:** `buildPlannerPrompt` caps `pageModel.elements` at 150 (increased from 50 in Session 20). Visible text cap is 3000 chars (extract: 4000). Future: consider smarter relevance filtering if 150 proves insufficient.

**Planner token budget:** `maxTokens` is 4096. With adaptive thinking, Claude decides how much to think. Do not reduce this — 1024 was causing silent `task_failed` returns on complex pages.

### Schema Migrations

Current schema version: **4**

| Version | Changes |
|---|---|
| 1 | Initial tables: `workflow_events`, `run_checkpoints`, `user_preferences`, `schema_meta` |
| 2 | Added `status`, `goal`, `created_at` columns to `run_checkpoints`; added type/status/ns_key indexes; backfilled from JSON |
| 3 | Added `idx_workflow_events_created_at (created_at DESC, id DESC)` for `listRecent()` performance |
| 4 | Added tables: `browser_sessions`, `chat_sessions`, `chat_messages`, `chat_session_runs`, `bookmarks`, `browsing_history`, `browser_profiles`, `cookie_containers`, `user_accounts`, `standalone_tabs`, `chat_bridge_state` |

### Planner Output Format

`ClaudePlannerGateway` uses tool-use mode with `BROWSER_TOOLS` (12 tool definitions in `packages/planner/src/toolMapping.ts`). First call uses `tool_choice: "auto"` so Claude can reason before acting. If Claude responds with text only (no tool call), a retry is sent with `tool_choice: "any"`. The `mapToolCallToDecision` function translates tool_use blocks into `PlannerDecision` objects. Reasoning is extracted from text blocks in the response.

---

## 11. Architectural Rules

These must be preserved across all sessions and agents.

1. `contracts` is dependency-free. Do not modify it lightly. It is the shared language of the entire system.
2. `runtime-core` owns the run lifecycle. Do not let orchestration logic drift into the desktop shell or renderer.
3. `planner` never calls the browser directly. It only receives the page model as structured data.
4. `browser-runtime` never makes policy or approval decisions. That belongs to `security`.
5. `chat-bridge` does not own workflow state. It routes messages; the runtime owns state.
6. `memory-store` is append-first. Preserve replayability. Never delete events retroactively.
7. `scheduler` creates `TaskIntent` objects. It does not implement browser logic or invent separate execution paths.
8. Keep the desktop shell thin. No business logic in `apps/desktop`.
9. Keep orchestration logic out of the renderer. Renderer is presentation-only.
10. Prefer app-managed browser profiles over attaching to the user's primary Chrome profile.
11. Do not prematurely couple to a single model provider, website, or chat transport.
12. If you add a new subsystem, document why it cannot fit into the existing package map.
13. Do not evaluate replatforming from Electron until the full product surface is stable.

---

## 12. Agent Collaboration Model

### Role Split

**System designer / integrator** (Claude Code / Opus-class agents):
- Package boundaries, public interfaces, contracts
- Task lifecycle semantics, clarification/resume behavior
- Browser-runtime abstraction
- Security and approval policy
- Cross-package integration, code review

**Bounded implementer** (Grok / fast agents):
- UI components with explicit props/contracts
- Storage adapters behind fixed interfaces
- Event logging plumbing
- Scheduler/watcher plumbing
- Incremental refactors inside one package

### Rules for Delegated Work

- Always give the implementer: exact package/file scope, the interface it must preserve, acceptance criteria, and what it must NOT modify.
- Never ask the implementer to "improve architecture."
- Require small, reviewable units.
- Review delegated changes before they become architectural truth.

### Before Making Any Change

1. Read this file (`docs/working_log.md`) first
2. Verify the change does not violate any rule in section 11
3. Verify the change fits within an existing package boundary
4. If it doesn't fit, document why before proceeding

### Handoff Checklist

When handing off to another agent or session:
- [ ] Has this log been updated with what was done?
- [ ] Are all terminal paths still calling `notifyTerminalEvent` + `clearRunState`?
- [ ] Are prepared statements still cached in all SQLite stores?
- [ ] Does the planner still use `maxTokens: 4096` and adaptive thinking?
- [ ] Are module boundaries still intact?
- [ ] Is there a new open problem that should be added to section 9?

---

*Last updated: 2026-03-14 — Sessions 1–8 consolidated.*

---

## 13. Detailed Session Logs

These entries are appended after every work session. Format: what was done, problems encountered, mistakes made, methods used to fix them, final state of each changed file.

---

### Session Log — 2026-03-14 (this session)

**Tasks requested:**
1. Complete the MCP design review for the browser planner
2. Run a full performance benchmark and code review of the SQLite storage layer, fix all identified issues
3. Consolidate all project documentation into `docs/working_log.md`

---

#### Part 1: MCP Design Review

**Question:** Is the current `ClaudePlannerGateway` approach (text→JSON parsing) reasonable for the agentic browser, or should it be replaced with MCP tool-use / `@playwright/mcp`?

**Files read:**
- `packages/planner/src/ClaudePlannerGateway.ts`
- `packages/planner/src/parsePlannerResponse.ts`
- `packages/planner/src/buildPlannerPrompt.ts`
- `packages/planner/src/PlannerGateway.ts`
- `packages/contracts/src/browser.ts` (for `BrowserAction` type)
- `packages/contracts/src/tasks.ts` (for `PlannerDecision` type)

**Verdict:** No rewrite needed. The current code-orchestrated loop (one decision per API call, runtime executes) is correct for OpenBrowse's architecture. `@playwright/mcp` would be a fundamentally different approach — the model drives the browser directly via tool calls — which would lose the harness's suspension/resume/checkpoint capabilities. That is the opposite of what OpenBrowse needs.

**Issues identified with current `ClaudePlannerGateway`:**
1. `maxTokens: 1024` — critically too low. Complex page states (50 elements + action history + visible text excerpt + constraints) can easily fill 600–800 tokens of input, leaving only 200–400 for the output. This was causing silent `task_failed` returns when the response was truncated mid-JSON.
2. No adaptive thinking — Claude could not reason carefully through multi-step navigation decisions.
3. No structured output guarantee — response parsing relied on three fallback strategies (markdown code block → raw JSON.parse → brace-depth counting). The last fallback is fragile.

**Fixes applied to `packages/planner/src/ClaudePlannerGateway.ts`:**
- `maxTokens`: 1024 → 4096
- Added `thinking: { type: "adaptive" }`
- Added `output_config.format` with a flat JSON schema (`PLANNER_OUTPUT_SCHEMA` constant defined inline). Schema uses `additionalProperties: false` on all objects. All type-specific fields (action, clarificationRequest, approvalRequest, completionSummary, failureSummary) are optional at the schema level — `parsePlannerResponse` still handles semantic validation. This guarantees syntactically valid JSON output without needing Zod (which is not a dependency of the planner package).
- Used `as any` cast for `output_config` because `@anthropic-ai/sdk ^0.78.0` TypeScript types may not fully expose this field inline.
- `parsePlannerResponse` left unchanged — the `extractJson` fallbacks remain as a safety net even though structured outputs should make them unreachable.

**Typecheck result:** `pnpm --filter @openbrowse/planner typecheck` — passed with no errors.

---

#### Part 2: SQLite Storage Benchmark and Code Review

**Files read:**
- `packages/memory-store/src/SqliteDatabase.ts`
- `packages/memory-store/src/SqliteWorkflowLogStore.ts`
- `packages/memory-store/src/SqliteRunCheckpointStore.ts`
- `packages/memory-store/src/SqlitePreferenceStore.ts`
- `packages/memory-store/src/schema.ts`
- `packages/memory-store/src/MemoryStore.ts`
- `node_modules/.pnpm/@types+better-sqlite3@7.6.13/.../index.d.ts` (to understand the type system)

**Root cause identified:** `better-sqlite3` does NOT cache `db.prepare(sql)` calls. Each call to `prepare()` recompiles the SQL statement from scratch into a native SQLite prepared statement object. All three store classes were calling `db.prepare(sql)` on every method invocation. In the hot path:
- `SqliteWorkflowLogStore.append()` — called once per planner step → 50+ recompiles per run
- `SqliteRunCheckpointStore.save()` — called after every browser action → same frequency
- `SqlitePreferenceStore.get()` — called on every `hydrateRuntimeSettings` → called at startup and on every settings change

**Additional issue:** `SqliteWorkflowLogStore.listRecent()` queries `ORDER BY created_at DESC, id DESC LIMIT ?` with no index on `created_at`. This was a full table scan. For a long-running system with many workflow events, this degrades to O(n) even with a LIMIT clause.

**Fixes:**

*`SqliteWorkflowLogStore.ts` — complete rewrite:*
- Added `import type Database from "better-sqlite3"` (default import, not named — required by the module's `export =` declaration)
- 5 prepared statements as instance properties: `stmtAppend`, `stmtListByRun`, `stmtListRecent`, `stmtCountByRun`, `stmtDeleteByRun`
- All initialized in constructor from `sqlite.db.prepare(sql)`
- Method bodies simplified to single `.run()` / `.get()` / `.all()` calls on cached statements

*`SqliteRunCheckpointStore.ts` — complete rewrite:*
- Same pattern: 5 cached statements (`stmtSave`, `stmtLoad`, `stmtListByStatus`, `stmtListAll`, `stmtDelete`)

*`SqlitePreferenceStore.ts` — complete rewrite:*
- Same pattern: 4 cached statements (`stmtUpsert`, `stmtGet`, `stmtList`, `stmtDelete`)

*`schema.ts` — schema version bump and new migration:*
- `SCHEMA_VERSION`: 2 → 3
- Added migration `3`: `CREATE INDEX IF NOT EXISTS idx_workflow_events_created_at ON workflow_events(created_at DESC, id DESC)`
- This covers the composite `ORDER BY created_at DESC, id DESC` used by `listRecent()`

**Mistake made and corrected:**
Initial type annotation used `import type { Database } from "better-sqlite3"` (named import) and `ReturnType<Database["prepare"]>` as the statement type. This was wrong for two reasons:
1. `better-sqlite3` uses `export =` (CommonJS-style), so the correct import is the default: `import type Database from "better-sqlite3"`
2. The statement type is `Database.Statement` (exposed via the merged `declare namespace Database` in the type declaration), not a `ReturnType` utility

Fixed immediately after reading the `@types/better-sqlite3` declaration file.

**Typecheck result:** `pnpm --filter @openbrowse/memory-store typecheck` — passed with no errors.

---

#### Part 3: Documentation Consolidation

**Problem:** 8 separate `.md` files in `docs/` with overlapping, partially stale, and disorganized content. Some files described pre-implementation state as if current. No single file a new agent could read to understand the full project.

**Files read (all of them):**
- `docs/ARCHITECTURE.md` — system shape, module rules
- `docs/TASK_LIFECYCLE.md` — full lifecycle steps
- `docs/HANDOFF.md` — project scope, product thesis, module intent, architectural rules
- `docs/MULTI_AGENT_COORDINATION.md` — role split, delegation rules
- `docs/IMPLEMENTATION_PLAN.md` — phases 0–7
- `docs/CLAUDE_CODE_PROMPTS.md` — phase-by-phase Claude Code prompts
- `docs/GROK_PROMPTS.md` — 5 bounded implementation tasks
- `docs/CLAUDE_CONTINUE_NOTE.md` — post-implementation fixes and remaining gaps
- `docs/log.md` — one entry from 2026-03-11 ("context loaded")

**Created `docs/working_log.md`** — 12 sections:
1. Product Vision — full 产品设想总纲 synthesized
2. What OpenBrowse Is Not — explicit anti-patterns, why hybrid is required
3. Reference Products — Atlas/OpenClaw split and combination thesis
4. Architecture — current system shape with real component names
5. Module Map — table of all 12 packages
6. Task Lifecycle — complete state machine + handoff artifact format
7. Implementation Phases — original + updated build order + current status
8. Work Log — Sessions 1–8 with technical detail
9. Open Problems — high/medium/low priority with specific "what is needed"
10. Engineering Notes — platform, `better-sqlite3` NODE_MODULE_VERSION warning, prepared statement caching warning, key invariants, schema migration table, planner output format
11. Architectural Rules — 13 rules
12. Agent Collaboration Model — role split, delegation rules, before-change checklist, handoff checklist

**Old docs:** Left in place. They are historical artifacts and individually accurate for their era. `working_log.md` supersedes them as the primary reference.

---

#### Additional Context Note

The file `Agentic Web Browser Design/README.md` was opened in the IDE during this session. It is a Figma design code export (bundle for the design at figma.com/design/Fl5D41qmCOFKbp5j6y2tnV). This is the visual/UX design reference for the product. It is separate from the implementation codebase — run with `npm i && npm run dev` to view the design prototype. No code changes were made based on this file.

---

#### Files Changed This Session

| File | Change |
|---|---|
| `packages/planner/src/ClaudePlannerGateway.ts` | maxTokens 1024→4096, adaptive thinking, structured output schema |
| `packages/memory-store/src/SqliteWorkflowLogStore.ts` | Cached 5 prepared statements as instance properties |
| `packages/memory-store/src/SqliteRunCheckpointStore.ts` | Cached 5 prepared statements as instance properties |
| `packages/memory-store/src/SqlitePreferenceStore.ts` | Cached 4 prepared statements as instance properties |
| `packages/memory-store/src/schema.ts` | SCHEMA_VERSION 2→3, added migration 3 (created_at index) |
| `docs/working_log.md` | Created — single source of truth for entire project |

#### Typechecks Run

- `pnpm --filter @openbrowse/memory-store typecheck` — ✓ passed
- `pnpm --filter @openbrowse/planner typecheck` — ✓ passed

*Session log entry written: 2026-03-14*

---

### Session 10 — 2026-03-14: PreferenceStore Atomicity Fix + Benchmark

#### Goal

Debug and benchmark the storage solution for saving model API keys. Find worst cases, identify root causes, fix with compiling tools, and run benchmarks.

#### Root Causes Identified

**Root Cause 1 — Unnecessary read-before-write per key**

`upsertRuntimeSetting` called `preferenceStore.get(namespace, key)` before every write, solely to retrieve `existing.id`. But the `id` field is always `pref_${preferenceKey}` — it's a deterministic constant, never changes, and never needs to be looked up. The GET was dead weight.

**Root Cause 2 — 5 separate non-atomic transactions**

`saveRuntimeSettings` called `upsertRuntimeSetting` five times in sequence, each issuing its own separate DB transaction. A crash (or exception) after the 2nd write left partial state: API key saved, Telegram token not written. This is a real data-integrity bug for the API key save path. Example worst case: user types API key + Telegram token together and clicks Save; power failure after key write leaves the Telegram bridge permanently broken until the user saves again.

**Root Cause 3 — 10 DB operations when 5 would suffice**

Old pattern: 5 × (GET + UPSERT) = 10 sequential DB operations.
New pattern: 1 `saveNamespaceSettings` call = 5 writes wrapped in 1 transaction.
Plus the existing `readStoredRuntimeSettings` after write already parallelises the 5 read-backs via `Promise.all`.

#### Fix

Added two new methods to `PreferenceStore` interface:

- `deleteByKey(namespace, key)` — delete by composite key without needing the `id`
- `saveNamespaceSettings(namespace, entries[])` — atomic batch write: empty value → delete, non-empty value → upsert with deterministic id `pref_${key}`

**`InMemoryPreferenceStore`** — simple loop, O(1) map operations per entry, no locking needed (single-threaded JS).

**`SqlitePreferenceStore`** — added `stmtDeleteByKey` prepared statement; `saveNamespaceSettings` wraps all writes in `this.sqlite.transaction()` (single SQLite transaction = one fsync). This is the critical fix: either all 5 keys write or none do.

**`settings.ts`** — deleted `upsertRuntimeSetting` function entirely. `saveRuntimeSettings` now calls `services.preferenceStore.saveNamespaceSettings(RUNTIME_SETTINGS_NAMESPACE, [...])` once with all 5 entries.

#### Benchmark Results — Section 7

```
  InMemory PreferenceStore: OLD (5×get+upsert sequential)   191,502 ops/s   5.22 µs/op
  InMemory PreferenceStore: NEW (saveNamespaceSettings)     627,418 ops/s   1.59 µs/op
  InMemory PreferenceStore: NEW with empty (delete path)    669,643 ops/s   1.49 µs/op
  SQLite: [skipped — NODE_MODULE_VERSION mismatch, run under Electron]
```

**3.3× speedup** in the InMemory path: eliminated 5 redundant `.get()` calls.
SQLite improvement expected to be even larger (5 separate transactions → 1 transaction = far fewer fsyncs).

#### Mistakes Made This Session

- None. The root causes were cleanly identified from static analysis. All changes compiled first try with `tsc --build`.

#### Methods Used

- Static code analysis to identify the 3 root causes before touching any code
- `import type Database from "better-sqlite3"` (correct default import) — lesson from Session 9
- `this.sqlite.transaction()` wrapper from `SqliteDatabase` to avoid raw `db.transaction(fn)()` calls
- TypeScript compiler (`tsc --build`) used as the correctness oracle throughout — no changes pushed until both `memory-store` and `runtime-core` compiled clean
- `node benchmarks/run.mjs` to confirm performance improvement

#### Files Changed This Session

| File | Change |
|---|---|
| `packages/memory-store/src/MemoryStore.ts` | Added `deleteByKey` + `saveNamespaceSettings` to `PreferenceStore` interface and `InMemoryPreferenceStore` |
| `packages/memory-store/src/SqlitePreferenceStore.ts` | Added `stmtDeleteByKey` prepared statement, implemented `deleteByKey` and `saveNamespaceSettings` (transactional) |
| `packages/runtime-core/src/settings.ts` | Deleted `upsertRuntimeSetting`; replaced 5-call pattern in `saveRuntimeSettings` with single `saveNamespaceSettings` call |
| `benchmarks/run.mjs` | Added Section 7 (preference store old vs new benchmark, InMemory + SQLite) |

#### Builds Run

- `pnpm --filter @openbrowse/memory-store build` — ✓ clean
- `pnpm --filter @openbrowse/runtime-core build` — ✓ clean
- `node benchmarks/run.mjs` — ✓ passed, Section 7 results above

*Session log entry written: 2026-03-14*


---

### Session 11 — 2026-03-14: Browser Shell UI Correctness — Titlebar & Native View Overlay

#### Scope

Two specific shell-level UI correctness issues. No runtime, planner, or interaction-semantics work.

#### Issue 1 — macOS Draggable Titlebar / Traffic-Light Overlap

**Root cause:** The sidebar `<aside>` had no drag region and no top-chrome clearance. With `titleBarStyle: "hiddenInset"` + `trafficLightPosition: { x:16, y:14 }`, the macOS traffic-light controls sit at approximately (16,14) in window coordinates and span ~70px wide. The `sidebarHeader` content (brand mark at `padding: "16px 16px 12px"`) started at exactly (16, 16) — directly colliding with the close button. Additionally, when the sidebar is hidden (`sidebarVisible=false`), the main section starts at x=0 and the first interactive element in the `tabBar` (the ☰ toggle at x≈10) lands under the traffic lights.

**Fix:**
1. Added `titleBarSpacer` div as the first child of `<aside>`: 38px tall, `WebkitAppRegion: "drag"`, no content. Reserves the traffic-light zone as a drag target with no renderer content in the collision area. Height matches the `tabBar` so both sides form one continuous chrome row.
2. Made `tabBar` `paddingLeft` dynamic: `sidebarVisible ? 10 : 82`. When sidebar is hidden, first interactive control is at x=82 — safely past all three traffic-light buttons.

#### Issue 2 — Settings/Management Overlay Covered by Native Browser View

**Root cause:** `ManagementPanel` used `position:fixed; zIndex:1000`. CSS z-index applies only within the renderer's HTML compositor. The `WebContentsView` is a **native OS-level view** attached to `BrowserWindow.contentView` — it is always painted by the OS compositor on top of HTML regardless of z-index.

**Fix:** Solved at the shell/view-host level via IPC. Added `covered: boolean` to `BrowserPanel`. When `covered=true` (overlay opens), the `useEffect` calls `hideBrowserSession()` and returns early — the native view is retracted by main process. When `covered=false` (overlay closes), the effect restores the session with the stored viewport bounds. No new IPC channels — uses existing `browser:hide` / `browser:show` / `browser:viewport:set`.

In `App.tsx`: `<BrowserPanel activeTab={activeBrowserTab} covered={managementOpen} />`.

#### Caveats

- Any future DOM overlay covering the browser area must use the same `covered` / `hideBrowserSession` pattern — there is no CSS solution for native view layering.
- If multiple overlays can stack, replace the boolean with an overlay-count integer to avoid premature restore.

#### Validation

- `tsc --noEmit -p apps/desktop/tsconfig.json` — ✓ clean
- `tsc -b --pretty false` — ✓ clean
- `pnpm run build` (apps/desktop) — ✓ built
- `node --test tests/*.test.mjs` — ✓ 28/28 pass

#### Files Changed

| File | Change |
|---|---|
| `apps/desktop/src/renderer/components/BrowserPanel.tsx` | Added `covered: boolean` prop; merged into show/hide `useEffect` |
| `apps/desktop/src/renderer/components/App.tsx` | Added `titleBarSpacer` (38px drag zone); dynamic tabBar `paddingLeft`; `covered={managementOpen}` |

*Session log entry written: 2026-03-14*

---

## Session 13 — Tab Bar UX + Black Screen Bug Fix

### Problems Addressed

**1. "New Tab" pseudo-tab confuses active selection**

The tab bar had a hardcoded "New Tab" `<button>` that always appeared alongside real shell tabs. With multiple real tabs open it was unclear which was "selected" — the pseudo-tab could appear active even while a real tab was showing, and real tabs had very subtle active/inactive distinction.

**2. Black screen after closing a tab (race condition)**

When closing the active standalone tab (e.g., tab B while [A, B, C] open), a persistent black native-view overlay appeared intermittently. Root cause trace:

1. `closeBrowserGroup(B)` → main process destroys B's WebContentsView
2. `standalone_tab_closed` event fires → `setShellTabs([A,C])` → intermediate React render
3. In intermediate render: `activeBrowserTab` = A → BrowserPanel's `[activeTab?.id]` effect fires → queues `setBrowserViewport` + `showBrowserSession(A)` (the latter awaits `setBrowserViewport`)
4. Close handler continues: `setMainPanel("home")` → React renders home → App `useEffect` fires `hideBrowserSession()` + `clearBrowserViewport()` (fire-and-forget, queued immediately)
5. IPC order at main process: `setBrowserViewport` → `hideBrowserSession` → `clearBrowserViewport` → `showBrowserSession(A)` (delayed)
6. `showBrowserSession(A)` arrives AFTER `clearBrowserViewport` → `viewportBounds=null` → A laid out at full-window bounds → A's WebContentsView (about:blank = black) covers entire app

### Fix

- **Removed "New Tab" pseudo-tab.** Tab bar now shows only real `shellTabs` + "+" button
- **Improved active tab style.** `headerTabWrapActive` now has `borderTopColor: "#8b5cf6"` (purple accent), brighter bg `"#16162a"`, white text. Inactive tabs use `"#9090a8"`. Selection is unambiguous
- **Auto-switch on close, never race.** Close handler captures `closingActive`/`nextTab` before awaits. If closing the active tab and other tabs remain: sets `selectedGroupId/RunId/foregroundRunId` to `nextTab` and stays in `"browser"` mode — never calls `hideBrowserSession`/`clearBrowserViewport`, eliminating the race. Only navigates home when closing the last tab

### Validation

- `pnpm exec tsc --noEmit` — ✓ clean
- `pnpm run build` — ✓ built (renderer 642.69kB)
- `node --test tests/*.test.mjs` — ✓ 28/28 pass

#### Files Changed

| File | Change |
|---|---|
| `apps/desktop/src/renderer/components/App.tsx` | Removed "New Tab" pseudo-tab; race-free close handler with auto-switch; improved active tab style |

*Session log entry written: 2026-03-14*

---

### Session 14 — 2026-03-15: Recovery Depth + Open Problems Audit

#### Scope

Implement richer session state persistence and restoration for crash recovery. Audit and update Open Problems list.

#### Recovery Depth Implementation

**Step 1 — Page Model Snapshot in Checkpoint:**
- Added `scrollY` to `PageModel` (contracts/browser.ts)
- Added `lastPageModelSnapshot` to `RunCheckpoint` (contracts/tasks.ts): title, summary, visibleText (500 chars), formValues (max 20), scrollY
- CDP script (`extractPageModel.ts`) now captures `window.scrollY`
- `TaskOrchestrator.observePage()` extracts form field values from input elements and builds the snapshot

**Step 2 — Recovery Context Injection:**
- Added `recoveryContext` to `RunCheckpoint` (contracts/tasks.ts)
- `continueResume()` populates `recoveryContext` from the snapshot before navigating to lastKnownUrl
- `plannerLoop()` clears `recoveryContext` after the first planner decision (one-time consumption)

**Step 3 — Recovery-Aware Planner Prompt:**
- `buildPlannerPrompt.ts` injects a `RECOVERY MODE` section when `recoveryContext` is present
- Tells planner: page title/summary before interruption, form fields that were filled (now lost), scroll position, instruction to compare current vs pre-interruption state

**Step 4 — Standalone Tab Persistence:**
- `AppBrowserShell` now takes a `storagePath` constructor parameter
- Tabs persisted to `standalone-tabs.json` on create/close
- `restoreStandaloneTabs()` called in bootstrap after browser kernel init
- All standalone tabs share `persist:standalone` partition (no per-tab partition explosion)
- Restored tabs emit `standalone_tab_created` events for the renderer

#### Open Problems Audit

Reviewed all 8 open problems against current codebase state:
- **Browser/Product Unification** — marked RESOLVED. `ElectronBrowserKernel` uses `EmbeddedViewProvider`/`WebContentsView` in main window since commit d414713. Hidden `BrowserWindow` is fallback-only for headless environments.
- **UI Information Architecture** — marked RESOLVED. Phase 2 completed browser-first layout.
- **Recovery Depth** — marked RESOLVED. This session's work.
- **Safety/Policy Layer** — marked RESOLVED. `DefaultApprovalPolicy` has keyword-based risk classification, three approval modes, risk-tiered denial. Not a stub.
- Renumbered and reprioritized remaining items: Tests (high), UI Polish (medium), Approval Semantics Refinement (medium), Handoff Viewer UI (medium), Repo Hygiene (lower), Replatform Decision Gate (lower).

#### Files Changed

| File | Change |
|---|---|
| `packages/contracts/src/tasks.ts` | Added `lastPageModelSnapshot`, `recoveryContext` to `RunCheckpoint` |
| `packages/contracts/src/browser.ts` | Added `scrollY` to `PageModel` |
| `packages/browser-runtime/src/cdp/extractPageModel.ts` | Capture `window.scrollY` |
| `packages/orchestrator/src/TaskOrchestrator.ts` | Populate snapshot + form values in `observePage()` |
| `packages/runtime-core/src/OpenBrowseRuntime.ts` | Inject recovery context in `continueResume()`, clear after first planner decision in `plannerLoop()` |
| `packages/planner/src/buildPlannerPrompt.ts` | Add `RECOVERY MODE` prompt section |
| `apps/desktop/src/main/browser/AppBrowserShell.ts` | `storagePath` constructor, standalone tab persistence (save/load/restore), shared `persist:standalone` partition |
| `apps/desktop/src/main/bootstrap.ts` | Pass storagePath, call `restoreStandaloneTabs()` after browser kernel init |
| `docs/working_log.md` | Updated Open Problems: marked 4 resolved, renumbered, reprioritized |

#### Validation

- `pnpm exec tsc --noEmit` — clean
- `pnpm run build` — success
- `node --test tests/*.test.mjs` — 28/28 pass

*Session log entry written: 2026-03-15*

---

### Session 15 — 2026-03-15: Test Coverage Expansion

#### Scope

Add focused tests for highest-risk untested code paths: orchestrator state transitions, planner prompt construction, planner response parsing, and approval policy edge cases.

#### Results

Tests expanded from 28 → 77 (49 new tests, 4 new files). All 77 pass. Zero regressions.

| File | Tests | Coverage |
|---|---|---|
| `tests/planner-parser.test.mjs` | 14 | JSON extraction (code blocks, prose, escaped quotes), all 5 decision types, 4 error cases |
| `tests/planner-prompt.test.mjs` | 13 | Goal/constraints/URL, action history, soft failure warnings, recovery context (scroll/form/absent), notes, element sorting & cap at 80, step budget, CAPTCHA hint, text truncation |
| `tests/orchestrator-state.test.mjs` | 10 | observePage snapshots (form values, cap at 20, empty filtering, stepCount), applyPlannerDecision (approval/complete/failed), recordBrowserResult (history cap at 10, soft failures), resumeFromApproval |
| `tests/approval-deny-continue.test.mjs` | 12 | Risk classification (critical/high/medium/low), denial resolution, approval modes (auto/strict), sensitive field & destructive keyword detection |

#### Validation

- `pnpm run build:packages` — ✓ clean
- `node --test tests/*.test.mjs` — ✓ 77/77 pass
- No external test dependencies added (node:test + node:assert/strict only)

#### Files Changed

| File | Change |
|---|---|
| `tests/planner-parser.test.mjs` | Created — 14 tests for parsePlannerResponse |
| `tests/planner-prompt.test.mjs` | Created — 13 tests for buildPlannerPrompt |
| `tests/orchestrator-state.test.mjs` | Created — 10 tests for TaskOrchestrator state machine |
| `tests/approval-deny-continue.test.mjs` | Created — 12 tests for DefaultApprovalPolicy risk/denial paths |

*Session log entry written: 2026-03-15*

### Session 16 — 2026-03-15: UI Polish — Browser Shell

#### Scope

Implement the 5 remaining UI polish items from the medium-priority gap list.

#### Results

All 5 items implemented. Build clean, 77/77 tests pass.

| Feature | Files Changed |
|---|---|
| Keyboard shortcuts (Cmd+T/W/L/R/[/]) | `App.tsx` |
| Back/forward disabled states | `App.tsx` |
| Tab overflow gradient indicators | `App.tsx` (CSS maskImage) |
| Loading indicator (2px animated bar) | `BrowserViewManager.ts`, `AppBrowserShell.ts`, `registerIpcHandlers.ts`, `useRuntimeStore.ts`, `App.tsx` |
| Favicons in tabs + home page | `BrowserViewManager.ts`, `AppBrowserShell.ts`, `registerIpcHandlers.ts`, `useRuntimeStore.ts`, `App.tsx`, `contracts/runtime.ts` |

#### Architecture

- Main process: `BrowserViewManager` listens to `did-start-loading`, `did-stop-loading`, `page-favicon-updated`
- `AppBrowserShell` exposes `setLoadingCallback` / `setFaviconCallback` (mirrors `setNavigationCallback`)
- IPC: new `tab_loading` and `tab_favicon` event types via existing `runtime:event` channel
- Store: `loadingTabs` and `tabFavicons` state maps
- Close-tab logic extracted into `handleCloseTab()` for reuse by button and Cmd+W

*Session log entry written: 2026-03-15*

### Session 17 — 2026-03-15: Inline Cancel-Run + Handoff Viewer UI

#### Scope

Close two medium-priority gaps: inline cancel-run action in Sessions tab, and Handoff Viewer UI.

#### Results

Both items implemented. Build clean, 77/77 tests pass.

| Feature | Files Changed |
|---|---|
| Inline cancel-run button on LiveTasks run cards | `LiveTasks.tsx`, `ManagementPanel.tsx`, `App.tsx` |
| Handoff Viewer sub-tab in Sessions | `HandoffViewer.tsx` (new), `ManagementPanel.tsx`, `App.tsx` |

#### Architecture

- **Cancel button**: `LiveTasks` gains `onCancelRun` prop, renders red "Cancel" button on non-terminal runs (running/queued/suspended). `stopPropagation` prevents triggering run selection. Threaded through `ManagementPanel` → `App.tsx`'s existing `handleCancelRun`.
- **Handoff Viewer**: New `HandoffViewer.tsx` component added as third Sessions sub-tab ("Handoff"). Fetches markdown via `window.openbrowse.getRunHandoff()` (preload API already existed). Displays in styled `<pre>` block with run selector dropdown and "Copy to Clipboard" button with green flash feedback. `Window.openbrowse` type declaration updated with `getRunHandoff` + `RunHandoffArtifact` import.

*Session log entry written: 2026-03-15*

### Session 18 — 2026-03-15: Comprehensive Unit Testing — Recovery, Stores, Planner Loop

#### Scope

Close three test coverage gaps identified in the high-priority "Tests" open problem: recovery flow integration, store contract compliance, and end-to-end planner loop edge cases. Profile and fix root-cause bugs in InMemory store implementations.

#### Bug Fixes (Root Cause Profiling)

Profiling revealed 3 behavioral divergences between InMemory and SQLite store implementations:

| Bug | File | Issue | Fix |
|---|---|---|---|
| `listAll()` wrong ordering | `MemoryStore.ts` `InMemoryRunCheckpointStore` | Returned Map insertion order, not `updatedAt DESC` (SQLite contract) | Added `.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))` |
| `listByStatus()` wrong ordering | `MemoryStore.ts` `InMemoryRunCheckpointStore` | Same as above — filter without sort | Added sort after filter |
| `append()` allows duplicate IDs | `MemoryStore.ts` `InMemoryWorkflowLogStore` | Pushed duplicates to array; SQLite uses `INSERT OR IGNORE` | Added `seenIds` Set to skip duplicates |

#### Results

49 new tests across 3 files. 77→126 total. All pass. Build clean.

| Test File | Tests | Coverage Area |
|---|---|---|
| `tests/store-contract.test.mjs` | 30 | RunCheckpointStore (10), WorkflowLogStore (9), PreferenceStore (11) — save/load round-trip, upsert, ordering, deletion, batch operations, idempotency |
| `tests/recovery-flow.test.mjs` | 10 | Full recovery chain: observePage snapshot → checkpoint persistence → recovery context injection → planner prompt RECOVERY MODE → context clearing. Edge cases: no snapshot fallback, no URL, pending action resume |
| `tests/planner-loop.test.mjs` | 9 | Planner loop edge cases: soft failure retry, 5× consecutive soft failure termination, hard failure, 20-step exhaustion, planner throws, approval gating, recovery context clearing, actionHistory cap at 10, stepCount |

#### Architecture

- **Store contract tests** use InMemory implementations (same interface as SQLite) to validate behavioral contracts. SQLite tests deferred to Electron context due to `better-sqlite3` NODE_MODULE_VERSION mismatch (140 vs 141).
- **Recovery flow tests** inline the `continueResume` recovery context injection logic (mirroring `OpenBrowseRuntime.ts` lines 396-409) to test the full snapshot→context→prompt chain without Electron dependencies.
- **Planner loop tests** use `createFailableBrowserKernel()` — a Proxy-based wrapper around `StubBrowserKernel` that injects failures at specified `executeAction` call indices. Enhanced `runPlannerLoop()` replicates `OpenBrowseRuntime.plannerLoop()` logic including soft/hard failure handling, consecutive failure guard (MAX=5), recovery context clearing, and approval gating.

#### Key finding: `resumeFromApproval` design

During testing, discovered that `TaskOrchestrator.resumeFromApproval()` intentionally does NOT clear `pendingBrowserAction`. The runtime reads it post-resume to execute the pending action, then it's cleared by the next `applyPlannerDecision` call. This is correct design — documented in test 8 of recovery-flow.test.mjs.

*Session log entry written: 2026-03-15*

### Session 19 — 2026-03-15: Approval Semantics Refinement

#### Scope

Close the medium-priority "Approval Semantics Refinement" open problem: add named risk classes and per-class configurable approval policies.

#### What Was Built

**Named risk classes** — each browser action is now classified into one of 6 risk classes: `financial`, `credential`, `destructive`, `submission`, `navigation`, `general`. Classification uses dedicated keyword maps per class (orthogonal to the existing risk level classification). When multiple classes match, priority order resolves: financial > credential > destructive > submission > navigation > general.

**Per-class configurable policies** — users can configure each risk class to `always_ask` (always require approval), `auto_approve` (skip approval), or `default` (use existing risk-level logic). Policies are persisted in `RuntimeSettings.riskClassPolicies` as JSON in the PreferenceStore. `always_ask` overrides all run modes. `auto_approve` is overridden by strict mode (strict means strict).

**UI integration** — approval cards in RemoteQuestions show a colored risk class badge pill (red for financial, amber for credential, dark red for destructive, purple for submission, cyan for navigation, gray for general). Card border color adapts to the risk class. SettingsPanel has a new "Approval Policies" card with dropdown selects per risk class.

**Full-stack threading** — `ApprovalRequest.riskClass` → `RunSuspension.riskClass` → UI badge. `DefaultApprovalPolicy` accepts `ApprovalPolicyConfig` in constructor, recreated on settings change in `applyRuntimeSettings()`.

#### Files Changed

| File | Change |
|---|---|
| `packages/contracts/src/tasks.ts` | Added `RiskClass`, `RiskClassPolicy`, `RiskClassPolicies` types; `riskClass?` field on `ApprovalRequest` and `RunSuspension` |
| `packages/contracts/src/runtime.ts` | Added `riskClassPolicies` to `RuntimeSettings` and `createDefaultRuntimeSettings()` |
| `packages/security/src/ApprovalPolicy.ts` | Added `RISK_CLASS_KEYWORDS` map, `classifyRiskClass()`, `ApprovalPolicyConfig` constructor, per-class policy logic in `requiresApproval()`, risk class in `buildApprovalRequest()` |
| `packages/orchestrator/src/TaskOrchestrator.ts` | Pass `riskClass` from `ApprovalRequest` into `RunSuspension` |
| `packages/runtime-core/src/compose.ts` | Pass `riskClassPolicies` to `DefaultApprovalPolicy` constructor |
| `packages/runtime-core/src/settings.ts` | Read/write/apply `riskClassPolicies`; recreate `securityPolicy` on settings change |
| `apps/desktop/src/shared/runtime.ts` | Re-export `RiskClass`, `RiskClassPolicy`, `RiskClassPolicies` |
| `apps/desktop/src/renderer/components/RemoteQuestions.tsx` | Risk class badge pill, dynamic card border color |
| `apps/desktop/src/renderer/components/SettingsPanel.tsx` | Approval Policies card with per-class dropdown selects |
| `tests/approval-policy.test.mjs` | 8 new tests for `classifyRiskClass()` and `buildApprovalRequest` risk class |
| `tests/approval-deny-continue.test.mjs` | 7 new tests for per-class policy behavior |
| `tests/safety-recovery.test.mjs` | Updated question format assertion `[CRITICAL]` → `[CRITICAL:FINANCIAL]` |
| `docs/working_log.md` | Marked Approval Semantics as resolved, added session log |

#### Validation

- `pnpm exec tsc --noEmit` — clean
- `pnpm -r build` — all packages and desktop app built
- `node --test tests/*.test.mjs` — 141/141 pass (was 126, +15 new)

*Session log entry written: 2026-03-15*

---

### Session Log — 2026-03-15 (Repo Hygiene)

**Task:** Fix `.gitignore` gaps identified in the "Repo Hygiene" open problem.

**Problems found:**
1. `pnpm-lock.yaml` was gitignored — lock files must be committed for deterministic dependency resolution.
2. `docs/working_log.md` was untracked because `docs/` was blanket-ignored — the project's single source of truth wouldn't survive a fresh clone.

**Changes:**
- Removed `pnpm-lock.yaml` from `.gitignore` line 9.
- Added `!docs/working_log.md` exception after the `docs/` ignore rule.
- Marked "Repo Hygiene" as RESOLVED in Open Problems.

#### Files Changed

| File | Change |
|---|---|
| `.gitignore` | Removed `pnpm-lock.yaml` ignore, added `!docs/working_log.md` exception |
| `docs/working_log.md` | Marked Repo Hygiene resolved, added session log |

*Session log entry written: 2026-03-15*

---

### Session 20 — 2026-03-16: Agent Brain Overhaul + Feature Completion Sprint

#### Scope

Comprehensive diagnosis and fix of the agent workflow (tasks getting stuck mid-execution) — the highest-priority problem. Then wiring up all missing static UI features (bookmarks, history, session delete, clear chat, URL auto-select, DevTools, print, save as PDF) and chat persistence to SQLite.

#### Phase 1 — Agent Brain Fixes (Critical)

Root cause analysis identified 4 interconnected bugs causing agent tasks to stall:

**1A. `tool_choice` fix — "No reasoning provided"**
- **Root cause:** `tool_choice: { type: "any" }` in `ClaudePlannerGateway` forces Claude to skip text blocks entirely, outputting only tool calls with no reasoning.
- **Fix:** Changed to `tool_choice: { type: "auto" }` so Claude can reason before acting. Added retry fallback: if Claude returns text with no tool call, re-prompts with `tool_choice: "any"` and an explicit instruction to call a tool.
- **File:** `packages/planner/src/ClaudePlannerGateway.ts`

**1B. Planner timeout**
- **Root cause:** No timeout on `client.messages.create()` — API call could hang indefinitely.
- **Fix:** Added `callWithTimeout()` using `Promise.race` with 60-second timeout. Throws "Planner timed out after 60s" on expiry.
- **File:** `packages/planner/src/ClaudePlannerGateway.ts`

**1C. capturePageModel hardening**
- **Root cause:** CDP failures in `capturePageModel()` crashed the entire planner loop.
- **Fix:** Wrapped in try/catch with one retry after 500ms. On second failure, uses minimal fallback PageModel (url + title + createdAt only).
- **File:** `packages/runtime-core/src/RunExecutor.ts`

**1D. Anti-loop detection overhaul**
- **Root cause:** Cycle detection only caught 2-3 step patterns. Soft failure counter reset on success. Action memory too short (15 items). No URL visit tracking.
- **Fix:**
  - Extended cycle detection to 2-5 step patterns over 12-action window
  - Added `totalSoftFailures` counter that never resets (cap: 8)
  - Added URL visit counting (warning at 4, fail at 6)
  - Increased action history cap from 15 to 25
  - Added `MAX_CONSECUTIVE_IDENTICAL_ACTIONS = 3`
- **Files:** `packages/runtime-core/src/RunExecutor.ts`, `packages/orchestrator/src/TaskOrchestrator.ts`, `packages/contracts/src/tasks.ts`

**1E. Page model enrichment**
- Element cap: 80 → 150
- Visible text: 1500 → 3000 chars (extract: 2000 → 4000)
- Added: scroll position context, last action result section, URL visit warnings
- Form extraction: enriched with field labels, types, required status, current values, submit button ref
- **Files:** `packages/planner/src/buildPlannerPrompt.ts`, `packages/browser-runtime/src/cdp/extractPageModel.ts`, `packages/contracts/src/browser.ts`

**1F. MAX_LOOP_STEPS increase** (only safe after 1D)
- 20 → 35 steps, with hardened anti-loop detection preventing runaway execution
- **File:** `packages/runtime-core/src/RunExecutor.ts`

#### Phase 2 — Static UI Features

**2A. URL auto-select on focus**
- Added `requestAnimationFrame(() => e.target.select())` to address bar `onFocus`
- **File:** `apps/desktop/src/renderer/components/chrome/NavBar.tsx`

**2B. Session deletion**
- Added per-session delete button (×) in `SessionListDropdown`
- Threaded `onDelete` prop through Sidebar → SessionListDropdown
- **Files:** `SessionListDropdown.tsx`, `Sidebar.tsx`, `App.tsx`

**2C. Bookmarks — Full stack**
- Backend: IPC handlers (`bookmarks:list`, `bookmarks:get-by-url`, `bookmarks:add`, `bookmarks:delete`, `bookmarks:search`)
- Preload: 5 new APIs exposed
- UI: `BookmarkPanel.tsx` (searchable list with delete), bookmark star (☆/★) in NavBar address bar, "Bookmarks" tab in ManagementPanel, hamburger menu item wired
- **Files:** `registerIpcHandlers.ts`, `preload/index.ts`, `BookmarkPanel.tsx` (new), `NavBar.tsx`, `ManagementPanel.tsx`, `App.tsx`

**2D. Browsing history — Full stack**
- Backend: IPC handlers (`history:list`, `history:search`, `history:clear`), auto-recording on navigation events
- Preload: 3 new APIs exposed
- UI: `HistoryPanel.tsx` (grouped by date, search, clear all with confirmation), "History" tab in ManagementPanel, hamburger menu item wired
- **Files:** `registerIpcHandlers.ts`, `preload/index.ts`, `HistoryPanel.tsx` (new), `ManagementPanel.tsx`, `App.tsx`

**2E. Clear chat**
- Added `clearCurrentChat()` to `useChatSessions` — resets messages to welcome message
- Added trash icon button in `SidebarHeader`
- **Files:** `useChatSessions.ts`, `SidebarHeader.tsx`, `Sidebar.tsx`, `App.tsx`

#### Phase 3 — Chat Persistence to SQLite

- Added `clearMessages(sessionId)` to `ChatSessionStore` interface, `InMemoryChatSessionStore`, and `SqliteChatSessionStore`
- Added 7 IPC handlers: `chat:sessions:list`, `chat:sessions:create`, `chat:sessions:delete`, `chat:sessions:update-title`, `chat:messages:append`, `chat:messages:clear`, `chat:runs:link`
- Added 7 preload APIs for chat persistence
- Modified `useChatSessions` hook:
  - On mount: loads sessions from SQLite, hydrates messages + runIds
  - All mutations persist: create session, delete session, rename, add message, clear chat, link run
  - `setMessages` callback auto-persists new messages (diff detection via ID set)
  - Graceful fallback if SQLite unavailable
- **Files:** `MemoryStore.ts`, `SqliteChatSessionStore.ts`, `registerIpcHandlers.ts`, `preload/index.ts`, `useChatSessions.ts`, `App.tsx`

#### Phase 4 — DevTools, Print, Save as PDF

- Added `openDevTools()`, `printPage()`, `saveAsPdf()` methods to `AppBrowserShell`
  - DevTools: `webContents.openDevTools({ mode: "detach" })`
  - Print: `webContents.print()`
  - PDF: `webContents.printToPDF({})` + `dialog.showSaveDialog()` + `fs.writeFile()`
- Added 3 IPC handlers: `browser:devtools`, `browser:print`, `browser:save-pdf`
- Added 3 preload APIs
- Enabled hamburger menu items (grayed when no browser tab active)
- **Files:** `AppBrowserShell.ts`, `registerIpcHandlers.ts`, `preload/index.ts`, `App.tsx`

#### Cookie Persistence — No Code Needed

Investigation confirmed Electron's `persist:` partition prefix automatically persists cookies, localStorage, and sessionStorage to disk. All browser profiles use `persist:${profileId}` partitions, standalone tabs use `persist:standalone`. Cookies survive app restarts without any custom code.

#### Tests Updated

3 test files updated for new constants (element cap 150, step budget 35, text cap 3000, action history cap 25):
- `tests/planner-prompt.test.mjs` — element cap, step budget, visible text assertions
- `tests/planner-loop.test.mjs` — MAX_LOOP_STEPS 35, action history cap 25, step exhaustion at 35
- `tests/orchestrator-state.test.mjs` — action history cap 25

#### Files Changed (Full List)

| File | Change |
|---|---|
| `packages/planner/src/ClaudePlannerGateway.ts` | tool_choice auto+retry, 60s timeout |
| `packages/planner/src/buildPlannerPrompt.ts` | Caps (150 elem, 3000 text, 35 steps), scroll/action/URL context, enriched forms |
| `packages/runtime-core/src/RunExecutor.ts` | capturePageModel hardening, cycle detection (2-5 step), MAX_LOOP_STEPS 35 |
| `packages/orchestrator/src/TaskOrchestrator.ts` | Action history 25, totalSoftFailures, URL visit counts |
| `packages/browser-runtime/src/cdp/extractPageModel.ts` | Text cap 4000, enriched form extraction |
| `packages/contracts/src/tasks.ts` | totalSoftFailures, urlVisitCounts in RunCheckpoint |
| `packages/contracts/src/browser.ts` | PageFormField interface, extended PageFormSummary |
| `packages/memory-store/src/MemoryStore.ts` | clearMessages in ChatSessionStore interface + InMemory impl |
| `packages/memory-store/src/SqliteChatSessionStore.ts` | clearMessages prepared statement + method |
| `apps/desktop/src/main/browser/AppBrowserShell.ts` | openDevTools, printPage, saveAsPdf |
| `apps/desktop/src/main/ipc/registerIpcHandlers.ts` | Bookmarks, history, chat, DevTools/print/PDF IPC handlers |
| `apps/desktop/src/preload/index.ts` | 18 new preload APIs |
| `apps/desktop/src/renderer/components/App.tsx` | Window types, bookmark state, hamburger menu wiring |
| `apps/desktop/src/renderer/components/ManagementPanel.tsx` | Bookmarks + History tabs |
| `apps/desktop/src/renderer/components/BookmarkPanel.tsx` | **New** — bookmark management UI |
| `apps/desktop/src/renderer/components/HistoryPanel.tsx` | **New** — history management UI |
| `apps/desktop/src/renderer/components/chrome/NavBar.tsx` | URL auto-select, bookmark star |
| `apps/desktop/src/renderer/components/sidebar/SessionListDropdown.tsx` | Per-session delete button |
| `apps/desktop/src/renderer/components/sidebar/SidebarHeader.tsx` | Clear chat button |
| `apps/desktop/src/renderer/components/sidebar/Sidebar.tsx` | onDeleteSession, onClearChat props |
| `apps/desktop/src/renderer/hooks/useChatSessions.ts` | clearCurrentChat, SQLite persistence |
| `tests/planner-prompt.test.mjs` | Updated caps (150, 35, 3000) |
| `tests/planner-loop.test.mjs` | Updated MAX_LOOP_STEPS 35, history cap 25 |
| `tests/orchestrator-state.test.mjs` | Updated history cap 25 |

#### Validation

- `pnpm run build:packages` — clean
- `pnpm run build` — clean (renderer 716.40 kB)
- `pnpm test` — 141/141 pass

*Session log entry written: 2026-03-16*

---

### Session 21 — 2026-03-16: Fix False-Positive Cycle Detection (Known Bug #11)

#### Scope

Fix the cycle detector that falsely flags distinct, purposeful actions (e.g., clicking Play then closing a modal in Wordle) as stuck loops.

#### Plan

1. **Include targetId in cycle keys** — Current `detectCycle` uses `type:targetId:targetUrl` but the `actionKey` for consecutive-identical check uses `type:targetId:url`. The real problem is that `detectCycle` builds keys from `actionHistory` records where `targetId` may be undefined for both clicks, making `click::url` identical for different buttons. Add `description` (which contains the element label/text) to the cycle key to differentiate clicks on different elements.
2. **Extend detectCycle to support 2–5 step patterns** — Comment says 2–5 but code only checks 2–3. Fix the loop range.
3. **Require more repetitions for short cycles** — 3 reps of a 2-step pattern (6 actions total) is too aggressive. Require 4 reps for len=2 (8 actions), keep 3 reps for len≥3.
4. **Include description in consecutive-identical actionKey** — So clicking different buttons on the same page isn't flagged as identical.
5. **Update tests** to match new behavior.

#### What Changed

| File | Change |
|---|---|
| `packages/runtime-core/src/RunExecutor.ts` | `detectCycle` now checks 2–5 step patterns (was 2–3); len=2 requires 4 reps (was 3); len≥3 requires 3 reps. Cycle key includes `description` field for element differentiation. Consecutive-identical `actionKey` includes `description` to distinguish clicks on different buttons at the same URL. |

#### Root Cause

The cycle key format `type:targetId:targetUrl` treated clicks on different buttons as identical when `targetId` was undefined (common when the planner uses element refs that don't persist into the action record consistently). Two clicks — "click Play" and "click Close modal" — both became `click::https://nytimes.com/wordle`, triggering a false 2-step cycle after only 6 actions (3×2). Adding `description` to the key differentiates them: `click::Click Play button:url` vs `click::Close how-to-play modal:url`.

#### Validation

- `pnpm run typecheck` — clean
- `pnpm test` — 147/147 pass

#### Next Steps

- P0-1: Chat interface consistency across tabs (ManagementPanel overlays sidebar)
- P0-2: Agent context-awareness on new task

*Session log entry written: 2026-03-16*

---

### Session 22 — 2026-03-16: P0-1 Audit + P0-2 Agent Context-Awareness on New Task

#### P0-1 Audit

Inspected the layout code. The ManagementPanel renders inside `<section style={styles.main}>` which has `position: "relative"`. The ManagementPanel backdrop uses `position: "absolute"; inset: 0`, so it only covers the main section — the sidebar `<aside>` is a sibling outside this section and is always visible and functional. P0-1 appears already resolved by Session 11's fix (changed from `position: fixed` to `position: absolute` scoped to section). Marking as DONE.

#### P0-2 Plan: Agent Context-Awareness

The agent should observe the currently active page before deciding whether to navigate elsewhere. Currently `initializeTask()` always creates a new browser session/tab.

**Implementation plan:**
1. Add `activeSessionId?: string` to `TaskIntent` (contracts)
2. In renderer: when submitting a task, pass the active standalone tab's sessionId if one exists
3. In `OpenBrowseRuntime.initializeTask()`: if `intent.activeSessionId` is set, reuse that session instead of creating a new one — capture its page model and pass it as initial context to the planner
4. Planner sees the current page and decides whether to reuse it or navigate elsewhere

#### Verification

All four steps confirmed implemented:
1. `activeSessionId?: string` exists in `TaskIntent` (contracts/src/tasks.ts:79)
2. Renderer passes `selection.activeBrowserTab.id` as `activeSessionId` (App.tsx:292)
3. `initializeTask()` calls `getSession(activeSessionId)` and reuses the session (OpenBrowseRuntime.ts:371-379)
4. `plannerLoop` naturally captures the reused session's page model on its first iteration via `capturePageModel(session)` (RunExecutor.ts:69)

`pnpm run typecheck` passes clean.

#### Status: DONE

---

### Session 23 — 2026-03-16: P1-6 Cookie Management UI

#### Context

All P0 items are done. P1 items 3, 4, 5 are done. Next P1 item is **P1-6: Cookie management UI** — view and clear cookies per browser profile. Electron's `session.cookies` API provides the underlying capability. Accessible from the hamburger menu or Settings panel.

#### Plan

1. Add a `CookiePanel` component (renderer) with: list cookies for the active tab's partition, search/filter, delete individual or clear all
2. Wire it into ManagementPanel as a new tab
3. Add hamburger menu item to open it
4. Add IPC handlers for cookie operations (list, remove, removeAll) using Electron's `session.cookies` API
5. Typecheck

#### Implementation Notes

- Cookie IPC handlers will use `browserShell.viewManager` to get the active tab's `webContents.session.cookies`
- Pass `sessionId` from renderer to identify which browser tab's cookies to query
- CookiePanel follows HistoryPanel pattern: list, search/filter, delete individual, clear all
- No new store needed — Electron's `session.cookies` API is the source of truth

#### Implementation

1. **AppBrowserShell** — added `getCookies()`, `removeCookie()`, `removeAllCookies()` methods using Electron's `session.cookies` API via the managed view's webContents
2. **IPC handlers** — registered `cookies:list`, `cookies:remove`, `cookies:remove-all` in `registerIpcHandlers.ts`
3. **Preload API** — exposed `listCookies`, `removeCookie`, `removeAllCookies` and added global type declarations
4. **CookiePanel component** — new component with filter/search, delete individual, clear all (with confirm), refresh, cookie count, Secure/HttpOnly badges
5. **ManagementPanel** — added `"cookies"` tab, wired CookiePanel with `activeSessionId` prop
6. **Hamburger menu** — added "Cookies" item opening the management panel to the cookies tab

#### Verification

`pnpm run typecheck` passes clean.

#### Status: DONE

#### Next Steps

- All P1 items complete (3–6). Next is P3-10 (Profile system / Google login) or code review/gap analysis.

---

### Session 24 — 2026-03-16: Code Review Gap Analysis — Validation Tests

#### Context

All P0–P2 backlog items are done, known bugs resolved. P3-10 (profile system) is explicitly deferred. Performing code review / gap analysis.

#### Gap Found

`packages/browser-runtime/src/validation.ts` has **zero test coverage**. It contains three security-critical pure functions:
- `validateElementTargetId(targetId)` — parses `el_<N>` format
- `validateUrl(url)` — blocks `javascript:`, `data:`, `file:` schemes (only allows http, https, about)
- `validateScrollDirection(value)` — normalizes scroll direction

These are used by `ElectronBrowserKernel` when executing browser actions. URL validation is a security boundary — an untested gap here could let malicious URLs through.

#### Plan

1. Add `tests/validation.test.mjs` with comprehensive tests for all three functions
2. Run `pnpm test` to verify
3. Update this log and commit

#### Implementation

Added `tests/validation.test.mjs` with 26 tests covering:
- `validateElementTargetId`: 8 tests (valid parsing el_0/el_42/el_999, rejects empty/missing prefix/wrong prefix/negative/non-numeric/trailing chars)
- `validateUrl`: 9 tests (accepts http/https/about:blank, rejects javascript:/data:/file:/ftp:/invalid/empty)
- `validateScrollDirection`: 9 tests (accepts up/down, normalizes case/whitespace, rejects left/empty/arbitrary)

Import uses `dist/validation.js` directly (not `dist/index.js`) to avoid pulling in `ElectronBrowserKernel` which requires the `electron` module.

#### Verification

- `pnpm test` — 173/173 pass (was 147, +26 new validation tests)
- `pnpm run typecheck` — clean

#### Status: DONE

#### Next Steps

- Consider adding tests for `CancellationController`, `HandoffManager`, or `workflowEvents` utilities
- P3-10 (profile system) remains deferred

---

### Session 25 — 2026-03-16: Gap Analysis — RunStateMachine + parsePlannerResponse Tests

#### Context

Continuing gap analysis from Session 24. All P0–P2 done, P3 deferred. Two pure-function modules have zero test coverage:

1. `packages/orchestrator/src/RunStateMachine.ts` — `canTransition` and `assertTransition` control task state machine transitions. Untested = risk of invalid state transitions being allowed.
2. `packages/planner/src/parsePlannerResponse.ts` — `extractJson` and `parsePlannerResponse` parse LLM output into structured decisions. Untested = risk of silent misparse or crash on malformed LLM output.

#### Plan

1. Add `tests/runStateMachine.test.mjs` — test all valid transitions, reject all invalid ones, test assertTransition throws
2. Add `tests/parsePlannerResponse.test.mjs` — test raw JSON, code-block JSON, brace-depth extraction, invalid/malformed inputs, all decision types
3. Run `pnpm test` to verify
4. Update this log and commit

#### Implementation

Added two test files:

**`tests/runStateMachine.test.mjs`** — 28 tests:
- `canTransition`: 15 valid transitions (queued→running, running→all targets, suspended→running/cancelled/failed), 9 invalid transitions (queued→completed, terminal states, suspended→completed)
- `assertTransition`: 3 tests (valid doesn't throw, invalid throws with message, terminal→terminal throws)

**`tests/parsePlannerResponse.test.mjs`** — 18 tests:
- Raw JSON parsing: browser_action, task_complete, task_failed
- Markdown code block extraction: with/without `json` tag
- Brace-depth extraction: JSON embedded in prose
- All decision types: clarification_request (with options/defaults), approval_request
- Default fallbacks: completionSummary, failureSummary, action description all fall back to reasoning
- Error cases: missing type, missing reasoning, unsupported type, no JSON, empty string, incomplete JSON

#### Verification

- `pnpm test` — 217/217 pass (was 173, +44 new tests for RunStateMachine and parsePlannerResponse)

#### Status: DONE

#### Next Steps

- Consider tests for `ClarificationPolicy`, `EventBus`, `CancellationController` (requires mocking dependencies)
- P3-10 (profile system) remains deferred

---

### Session 26 — 2026-03-16: Gap Analysis — EventBus + RunHandoff Tests

#### Context

Continuing gap analysis. All P0–P2 done, P3 deferred. Two pure-function modules in `packages/observability` have zero test coverage:

1. `EventBus` — pub/sub event system. Pure class, no dependencies. Untested = risk of silent handler failures or missed subscriptions.
2. `RunHandoff` — `buildHandoffArtifact` and `renderHandoffMarkdown` construct the canonical handoff surface. Pure functions, no I/O. Untested = risk of malformed handoff documents.

#### Plan

1. Add `tests/eventBus.test.mjs` — test subscribe, publish, multiple handlers, async handlers, no-handler-noop, ordering
2. Add `tests/runHandoff.test.mjs` — test buildHandoffArtifact field mapping, renderHandoffMarkdown sections (goal, constraints, page context, action history, suspension, failure, notes, outcome)
3. Run `pnpm test` to verify
4. Update this log and commit

#### Implementation

Added two test files:

**`tests/eventBus.test.mjs`** — 10 tests:
- Subscribe + publish: single handler, multiple handlers, subscription order
- No-subscriber publish is a no-op
- Independent event names
- Exact payload reference passing
- Async handlers awaited sequentially
- Multiple publishes accumulate
- Sync and async handler errors propagate

**`tests/runHandoff.test.mjs`** — 26 tests:
- `buildHandoffArtifact` (11 tests): core field mapping, page context, constraints, suspension info, failure info, outcome, missing outcome, notes, action history, optional pageModelSnapshot, stepCount default
- `renderHandoffMarkdown` (15 tests): title with goal, status emojis for all statuses, run metadata, constraints section present/absent, current page section, action history table, long description truncation, suspension section, failure section, notes section, outcome section, typed text as target, dash when no target

#### Verification

- `pnpm test` — 253/253 pass (was 217, +36 new tests for EventBus and RunHandoff)

#### Status: DONE

#### Next Steps

- Consider tests for `AuditTrail` edge cases, `LogReplayer`, or `workflowEvents` utilities
- P3-10 (profile system) remains deferred

---

### Session 27 — 2026-03-16: Gap Analysis — AuditTrail + LogReplayer Tests

#### Context

Continuing gap analysis. All P0–P2 done, P3 deferred, all open problems resolved. Two pure-class modules in `packages/observability` have zero test coverage:

1. `AuditTrail` — builds structured run summaries and formatted timelines from workflow events. Pure class with `WorkflowLogReader` dependency. Untested = risk of incorrect event counting, missing phases, or broken timeline formatting.
2. `LogReplayer` — replays workflow events with elapsed time calculations. Pure class with same dependency. Untested = risk of incorrect elapsed time math or empty-run edge cases.

#### Plan

1. Add `tests/auditTrail.test.mjs` — test generateRunSummary (empty events, single event, full run with all event types, failure/cancellation paths, duration calculation) and generateRunTimeline (empty, phase transitions, formatting)
2. Add `tests/logReplayer.test.mjs` — test replay (empty, single, multi-event elapsed calculation) and replayFormatted (empty, formatting)
3. Run `pnpm test` to verify
4. Update this log and commit

#### Implementation

Added two test files:

**`tests/auditTrail.test.mjs`** — 19 tests:
- `generateRunSummary` (12 tests): empty events, single run_created, browser action counting, clarification counting, approval counting, page_modeled counting, completed run with duration, failed run with failure reason, cancelled run, recovery event counting, full run with all event types
- `generateRunTimeline` (7 tests): empty events message, single event with phase header, phase transitions create new headers, same-phase consecutive events share header, elapsed time correctness, recovery/approval/handoff phases appear

**`tests/logReplayer.test.mjs`** — 8 tests:
- `replay` (4 tests): empty run returns [], single step with elapsed=0, multi-event elapsed computation, event reference preservation
- `replayFormatted` (3 tests): empty run message, single event formatting, multi-event elapsed formatting
- Independent runId isolation (1 test)

#### Verification

- `pnpm test` — 280/280 pass (was 253, +27 new tests for AuditTrail and LogReplayer)

#### Status: DONE

#### Next Steps

- Consider tests for `ClarificationPolicy` in orchestrator (untested pure-function module)
- Consider edge case tests for `getPhaseForEvent` with `planner_decision`, `planner_request_started`, `planner_request_failed` event types (currently fall to "Other" or "Execution")
- P3-10 (profile system) remains deferred

---

### Session 28 — 2026-03-16: Gap Analysis — ClarificationPolicy + workflowEvents Tests

#### Context

Continuing gap analysis. All P0–P2 done, P3 deferred. Two pure-function modules have zero test coverage:

1. `ClarificationPolicy` (orchestrator) — `DefaultClarificationPolicy.shouldSuspend()` and `formatClarificationSummary()`. Pure functions, no I/O. Controls whether the agent suspends for user clarification.
2. `workflowEvents` (runtime-core) — `createWorkflowEventId()`, `createWorkflowEvent()`, and `appendWorkflowEvent()`. Pure/light functions that construct and persist workflow events.

#### Plan

1. Add `tests/clarificationPolicy.test.mjs` — test shouldSuspend (running + clarification = true, all other combos = false), formatClarificationSummary (no options, single option, multiple options, empty question)
2. Add `tests/workflowEvents.test.mjs` — test createWorkflowEventId format, createWorkflowEvent field population, appendWorkflowEvent (calls store + eventBus)
3. Run `pnpm test` to verify
4. Update this log and commit

#### Implementation

Added two test files:

**`tests/clarificationPolicy.test.mjs`** — 14 tests:
- `DefaultClarificationPolicy.shouldSuspend` (10 tests): true only for running + clarification_request; false for all other status/decision combinations (running + browser_action/task_complete/task_failed/approval_request, suspended/completed/failed/cancelled/queued + clarification_request)
- `formatClarificationSummary` (4 tests): no options (fallback message), single option, multiple options (pipe-delimited), whitespace trimming

**`tests/workflowEvents.test.mjs`** — 11 tests:
- `createWorkflowEventId` (3 tests): prefix format, uniqueness, runId inclusion
- `createWorkflowEvent` (5 tests): correct structure, unique IDs, empty payload, ISO date, all event types
- `appendWorkflowEvent` (3 tests): calls both store and eventBus, ordering (store before bus), error propagation from store

#### Verification

- `node --test tests/clarificationPolicy.test.mjs tests/workflowEvents.test.mjs` — 25/25 pass
- `node --test tests/*.test.mjs` — 305/305 pass (was 280, +25 new)

#### Status: DONE

#### Next Steps

- Consider tests for `CancellationController` (requires mocking RuntimeServices, SessionManager, HandoffManager)
- Consider tests for `RecoveryManager` or `SessionManager` (require more complex mocking)
- P3-10 (profile system) remains deferred

---

### Session 29 — 2026-03-16: Gap Analysis — CancellationController + queries Tests

#### Context

Continuing gap analysis. All P0–P2 done, P3 deferred. Two modules with zero test coverage:

1. `CancellationController` (runtime-core) — `cancel()`, `isCancelled()`, `acknowledge()`. Controls cooperative cancellation with sync check + async cleanup. Needs mock RuntimeServices, SessionManager, HandoffManager.
2. `queries` (runtime-core) — `listAllRuns()` and `queryShellTabs()`. Pure data queries over mock stores.

#### Plan

1. Add `tests/cancellationController.test.mjs` — test isCancelled/acknowledge sync state, cancel for non-existent run, cancel for already-terminal run, cancel for active run (full flow), cancel cleans up browser session
2. Add `tests/queries.test.mjs` — test listAllRuns sorting, queryShellTabs mapping/filtering/sorting, empty results
3. Run `node --test` to verify
4. Update this log and commit

#### Implementation

Added two test files:

**`tests/cancellationController.test.mjs`** — 13 tests:
- `isCancelled` / `acknowledge` sync state (4 tests): false for unknown, true after cancel of non-terminal run, acknowledge clears flag, acknowledge no-op for unknown
- `cancel` flow (9 tests): null for non-existent run, returns unchanged for already-terminal (completed/failed/cancelled), full cancellation flow (destroys session, saves checkpoint, emits workflow event, handoff, notification, clears chat state), suspended run cancellation, default summary, missing browserSessionId handled, destroySession failure swallowed

**`tests/queries.test.mjs`** — 12 tests:
- `listAllRuns` (3 tests): empty array, single run, sort by updatedAt descending
- `queryShellTabs` (9 tests): empty results (no runs, no session id, no matching session), correct tab descriptor mapping, isBackground for scheduler, URL fallback chain (pageUrl → lastKnownUrl → about:blank), sort by updatedAt, filtering unmatched sessions

#### Verification

- `node --test tests/cancellationController.test.mjs tests/queries.test.mjs` — 25/25 pass
- `node --test tests/*.test.mjs` — 330/330 pass (was 305, +25 new)

#### Status: DONE

#### Next Steps

- Consider tests for `HandoffManager` (writeHandoff/emitHandoffEvent/notifyTerminalEvent)
- Consider tests for `RecoveryManager` or `SessionManager` (require more complex mocking)
- Consider tests for `settings.ts` factories (createPlanner, createChatBridge, buildRuntimeDescriptor)
- P3-10 (profile system) remains deferred

---

### Session 30 — 2026-03-16: Gap Analysis — HandoffManager + SessionManager Tests

#### Context

Continuing gap analysis. All P0–P2 backlog done, P3 deferred. Two runtime-core modules with zero test coverage:

1. `HandoffManager` — `writeHandoff()`, `emitHandoffEvent()`, `notifyTerminalEvent()`. Orchestrates terminal handoff: captures page snapshot, emits workflow event, sends notification, clears chat state.
2. `SessionManager` — `attachForRun()`, `sessionIdsForRun()`, `cleanupRun()`, `cleanupOrphans()`, `getSession()`. Manages browser session lifecycle with run→session reverse index.

#### Plan

1. Add `tests/handoffManager.test.mjs` — test writeHandoff with/without snapshot, emitHandoffEvent event shape, notifyTerminalEvent for completed/failed/cancelled, send failure swallowed, clearRunState called
2. Add `tests/sessionManager.test.mjs` — test attachForRun new session, reuse existing, orphan cleanup, cleanupRun, sessionIdsForRun, getSession delegation
3. Run `node --test` to verify
4. Update this log and commit

#### Implementation

Added two test files:

**`tests/handoffManager.test.mjs`** — 14 tests:
- `emitHandoffEvent` (2 tests): correct event shape (runId, type, summary, payload fields), passes page model snapshot
- `notifyTerminalEvent` (6 tests): completed/failed/cancelled/unknown status notifications, truncates long goals in status line, swallows send errors
- `writeHandoff` (6 tests): provided snapshot skips capture, captures from active session, skips terminated session, skips when no browserSessionId, swallows capture errors, tolerates missing clearRunState

**`tests/sessionManager.test.mjs`** — 17 tests:
- `sessionIdsForRun` (1 test): empty for unknown run
- `attachForRun` (6 tests): creates new session, passes correct metadata, isBackground for non-desktop, reuses active session, creates new for terminated/missing/when reuse=false
- `cleanupRun` (3 tests): destroys tracked session, no-op for unknown, swallows destroy errors
- `cleanupOrphans` (3 tests): keeps keepId, destroys all without keepId, no-op for unknown
- `getSession` (2 tests): delegates to kernel, null for unknown
- Multi-run isolation (1 test): independent tracking per run
- `attachForRun` orphan cleanup (1 test): second attach cleans first session

#### Verification

- `node --test tests/handoffManager.test.mjs tests/sessionManager.test.mjs` — 31/31 pass
- `node --test tests/*.test.mjs` — 361/361 pass (was 330, +31 new)

#### Status: DONE

#### Next Steps

- Consider tests for `RecoveryManager` (complex mocking: orchestrator + session + checkpoint interactions)
- Consider tests for `settings.ts` factories (createPlanner, createChatBridge, buildRuntimeDescriptor)
- Consider tests for `RunExecutor` (main step loop, requires planner + browser + orchestrator mocks)
- P3-10 (profile system) remains deferred

---

### Session 31 — 2026-03-16: Gap Analysis — RunExecutor Test Suite

#### Context

Continuing gap analysis. All P0–P2 backlog done, P3 deferred. Initially planned to test `RecoveryManager` and `settings.ts` factories, but both modules import from `OpenBrowseRuntime.js` which transitively pulls in `ElectronBrowserKernel` (requires Electron context). Pivoted to `RunExecutor`, the most complex untested module that IS importable from system Node.

#### Plan

1. Add `tests/runExecutor.test.mjs` — test plannerLoop (complete, fail, clarification, approval, cancellation, browser action, stuck detection, max steps), continueResume (navigate, pending action, recovery context injection)
2. Run `node --test` to verify
3. Update this log and commit

#### Implementation

**`tests/runExecutor.test.mjs`** — 18 tests:
- `plannerLoop` terminal paths (4 tests): task_complete, task_failed, clarification_request suspension, planner error
- `plannerLoop` browser_action (3 tests): successful action + continue, hard failure (non-soft), session lost
- `plannerLoop` soft failure handling (3 tests): element_not_found continues, max consecutive soft failures, max total soft failures
- `plannerLoop` control flow (3 tests): cooperative cancellation early return, max steps exceeded, approval gate suspension
- `plannerLoop` state management (1 test): recovery context cleared after first planner call
- `continueResume` (4 tests): navigate to lastKnownUrl, pending action execution, pending action failure, recovery context injection from snapshot

Key mock design: full mock of `RuntimeServices` (orchestrator, planner, browserKernel, chatBridge, securityPolicy, stores), `CancellationController`, `HandoffManager`, and `SessionManager`. Action history in `recordBrowserResult` mock includes `targetId` and `url` to prevent false cycle detection on unique actions.

#### Verification

- `node --test tests/runExecutor.test.mjs` — 18/18 pass
- `node --test tests/*.test.mjs` — 379/379 pass (was 361, +18 new)

#### Status: DONE

#### Next Steps

- `RecoveryManager` and `settings.ts` tests are blocked by Electron import dependency — would need either module mocking or extracting pure functions into separate files
- Consider extracting `detectCycle()` from RunExecutor and testing directly (currently private)
- Consider tests for Electron-dependent modules under Electron test harness
- P3-10 (profile system) remains deferred

---

### Session 32 — 2026-03-16: Gap Analysis — Extract and Test detectCycle

#### Context

All P0–P2 backlog done, P3 deferred. Continuing gap analysis from Session 31 which identified `detectCycle()` as extractable pure logic buried as a private function in `RunExecutor.ts`. The RunExecutor test suite tests cycle detection indirectly through the full planner loop, but doesn't exercise edge cases (near-miss patterns, boundary lengths, mixed cycle lengths, window boundaries).

#### Plan

1. Export `detectCycle` from `RunExecutor.ts` (keep it in the same file, just add `export`)
2. Add `tests/detectCycle.test.mjs` with comprehensive edge-case tests
3. Run `node --test` to verify
4. Update this log and commit

#### Implementation

Exported `detectCycle` from `RunExecutor.ts` (single keyword change: `function` → `export function`).

**`tests/detectCycle.test.mjs`** — 29 tests across 9 describe blocks:
- No cycle (5 tests): empty, single, all distinct, below-threshold 2-step and 3-step
- 2-step cycles (5 tests): exact 4 reps, 5 reps, 3 reps rejected, tail with prefix noise, near-miss broken last element
- 3-step cycles (4 tests): exact 3 reps, 4 reps, 2 reps rejected, tail with noise
- 4-step cycles (2 tests): exact 3 reps, 2 reps rejected
- 5-step cycles (2 tests): exact 3 reps, 2 reps rejected
- Beyond max length (1 test): 6-step pattern not detected
- Priority (1 test): shorter cycle wins when both match
- Realistic action keys (5 tests): click-scroll cycle, 3-step nav loop, distinct targetIds safe, distinct descriptions safe, same description cycle
- Edge cases (4 tests): all-identical 8 elements, 7 identical below threshold, 8 identical, 9 identical shortest wins

#### Verification

- `node --test tests/detectCycle.test.mjs` — 29/29 pass
- `node --test tests/*.test.mjs` — 408/408 pass (was 379, +29 new)

#### Status: DONE

#### Next Steps

- `RecoveryManager` and `settings.ts` tests remain blocked by Electron import dependency
- Consider tests for `compose.ts` (`createRuntimeStorage` / `assembleRuntimeServices`) — `createRuntimeStorage` is importable but requires mocking SQLite dynamic import
- P3-10 (profile system) remains deferred

---

### Session 33 — 2026-03-16: Gap Analysis — TelegramConfig + TelegramStateStore Tests

#### Context

Continuing gap analysis. All P0–P2 done, P3 deferred. Two chat-bridge modules have zero test coverage:

1. `TelegramConfig.resolveTelegramConfig()` — pure function resolving config from overrides + env vars. Controls whether Telegram bridge is enabled. Untested = risk of misconfigured bot or silent null return.
2. `TelegramStateStore` — file-backed state manager for Telegram bridge: chat approval, clarification tracking, run-chat mappings. Untested = risk of state corruption, lost clarifications, or orphaned reply targets.

#### Plan

1. Add `tests/telegramConfig.test.mjs` — test override priority, env var fallback, null when no token, pairing mode defaults, notification level
2. Add `tests/telegramStateStore.test.mjs` — test load/persist, approveChat, clarification lifecycle (register/resolveByRequestId/resolveByReplyTarget), run-chat mappings, clearClarificationsForRun, missing file fallback
3. Run `pnpm test` to verify
4. Update this log and commit

#### Implementation

Added two test files:

**`tests/telegramConfig.test.mjs`** — 18 tests:
- `resolveTelegramConfig` (18 tests): null when no botToken (2), override vs env priority for botToken/chatId/statePath/notificationLevel (4 each field), default values (statePath, pairingMode without/with chatId, notificationLevel), non-verbose env defaults to quiet

**`tests/telegramStateStore.test.mjs`** — 21 tests:
- `load` (4 tests): default state on missing file, load existing state, partial state handling, invalid JSON recovery
- `approveChat` (5 tests): set primary, no duplicates, keeps first primary, persists to disk, survives reload
- `clarification lifecycle` (5 tests): register/resolveByRequestId, wrong chatId returns null, unknown requestId, resolveByReplyTarget, unknown target
- `run-chat mappings` (3 tests): bind/resolve, unknown run, overwrite
- `clearClarificationsForRun` (3 tests): removes run's clarifications + reply targets + run-chat mapping, empty for unknown, no-op safe
- `listApprovedChatIds` (1 test): returns defensive copy

Import note: Uses relative path `../packages/chat-bridge/dist/TelegramConfig.js` (not package specifier) to avoid pulling in `TelegramChatBridge` which has network dependencies.

#### Verification

- `node --test tests/telegramConfig.test.mjs tests/telegramStateStore.test.mjs` — 39/39 pass
- `node --test tests/*.test.mjs` — 447/447 pass (was 408, +39 new)

#### Status: DONE

#### Next Steps

- `RecoveryManager` and `settings.ts` tests remain blocked by Electron import dependency
- Consider tests for `TelegramChatBridge` message routing (would need HTTP mock for Telegram API)
- P3-10 (profile system) remains deferred

---

### Session 34 — 2026-03-16: Gap Analysis — WatchScheduler Comprehensive Tests

#### Context

Continuing gap analysis. All P0–P2 done, P3 deferred. `IntervalWatchScheduler` has only 1 test (backoff + reset). Multiple methods and edge cases are untested:

1. `unregisterWatch` — stop and remove a watch, timer cleanup
2. `listWatches` — snapshot semantics, defensive copy
3. `dispose` — clear all watches and timers
4. `StubWatchScheduler` — returns "stub-watch"
5. In-flight guard — concurrent trigger prevention
6. Max backoff cap — exponential backoff capped at `maxBackoffMinutes`
7. Multiple watches — independent tracking
8. Success resets backoff — already partially tested, more edge cases

#### Plan

1. Add comprehensive tests to `tests/watchScheduler.test.mjs` (new file, existing `watch-scheduler.test.mjs` kept)
2. Run `pnpm test` to verify
3. Update this log and commit

#### Implementation

Added `tests/watchScheduler.test.mjs` — 17 tests across 8 describe blocks:

- `StubWatchScheduler` (1 test): returns "stub-watch" id
- `registerWatch` (2 tests): unique id containing intent id, two registrations produce different ids
- `listWatches` (3 tests): empty when no watches, returns registered watches with correct fields, defensive copy (different object references)
- `unregisterWatch` (3 tests): removes from list, no-op for unknown id, prevents future dispatch after unregister
- `dispose` (2 tests): clears all watches, prevents future dispatches
- `dispatch execution` (2 tests): dispatches after interval elapses (validates lastCompletedAt/lastTriggeredAt), dispatches multiple times
- `backoff` (3 tests): exponential backoff on consecutive failures (validates consecutiveFailures/lastError/backoffUntil), backoff capped at maxBackoffMinutes, success after failure resets state
- `multiple watches` (1 test): independent tracking per watch, unregister one doesn't affect others

Uses `minuteMs: 10` for fast test execution (10ms = 1 "minute").

#### Verification

- `node --test tests/watchScheduler.test.mjs` — 17/17 pass
- `node --test tests/*.test.mjs` — 464/464 pass (was 447, +17 new)

#### Status: DONE

#### Next Steps

- `RecoveryManager` and `settings.ts` tests remain blocked by Electron import dependency
- Consider tests for `TelegramChatBridge` message routing (would need HTTP mock for Telegram API)
- P3-10 (profile system) remains deferred

---

## 14. Feature Backlog

*Added: 2026-03-15 — based on user feedback after hands-on usage.*

This section tracks planned features, prioritized for iterative implementation.

### P0 — Critical UX

**~~1. Chat interface consistency across tabs~~** — DONE (Session 11 + Session 22 audit confirmed)

**~~2. Agent context-awareness on new task~~** — DONE (Session 22, verified all 4 implementation steps complete)

### P1 — Core Browser Features

**~~3. Hamburger menu (☰)~~** — DONE (Session 20, 2026-03-16). Implemented with New Session, History, DevTools, Print, Save as PDF, Bookmarks items.

**~~4. Clear chat history~~** — DONE (Session 20, 2026-03-16). Clear button in SidebarHeader + clearCurrentChat in useChatSessions. Persists to SQLite.

**~~5. Browsing history viewer~~** — DONE (Session 20, 2026-03-16). HistoryPanel with date grouping, search, clear all. Auto-recording on navigation. Hamburger + ManagementPanel tab.

**~~6. Cookie management UI~~** — DONE (Session 23, 2026-03-16). CookiePanel with filter, delete, clear all. IPC via session.cookies API. ManagementPanel tab + hamburger menu item.

### P2 — Enhancement Features

**~~7. Bookmark tab & system~~** — DONE (Session 20, 2026-03-16). Full stack: BookmarkPanel, star toggle in NavBar, ManagementPanel tab, hamburger item. SQLite-backed.

**~~8. Developer mode (F12)~~** — DONE (Session 20, 2026-03-16). `openDevTools({ mode: "detach" })` via hamburger menu. Grayed when no browser tab active.

**~~9. Print & Save~~** — DONE (Session 20, 2026-03-16). Print via `webContents.print()`, Save as PDF via `webContents.printToPDF()` + save dialog. Both in hamburger menu.

### Known Bugs

**~~11. False-positive cycle detection on repetitive but valid actions~~** — RESOLVED (Session 21, 2026-03-16)

Fixed by including `description` in cycle keys (differentiates clicks on different buttons) and requiring 4 full repetitions for 2-step cycles (was 3). Also extended cycle detection to 2–5 step patterns (was 2–3).

### P3 — Future

**10. Profile system / Google login**

User accounts, OAuth (Google Sign-In), profile sync across devices. Large scope — defer until core browser features are stable and the product surface is validated.

---

### Session 35 — 2026-03-16: Test Suite Consolidation — Remove Duplicate Test Files

#### Context

Gap analysis discovered 3 pairs of duplicate test files inflating the test count (464 → real unique coverage is lower). Each pair has an older file from early sessions and a newer comprehensive file from the gap analysis sessions:

1. `planner-parser.test.mjs` (14 tests, Session 15) + `parsePlannerResponse.test.mjs` (18 tests, Session 25) — both test `parsePlannerResponse`
2. `telegram-state.test.mjs` (1 test, earlier) + `telegramStateStore.test.mjs` (21 tests, Session 33) — both test `TelegramStateStore`
3. `watch-scheduler.test.mjs` (1 test, earlier) + `watchScheduler.test.mjs` (17 tests, Session 34) — both test `IntervalWatchScheduler`

#### Plan

1. Merge 2 unique tests from `planner-parser.test.mjs` into `parsePlannerResponse.test.mjs` (escaped quotes, clarification with missing optionals)
2. Delete old files: `planner-parser.test.mjs`, `telegram-state.test.mjs`, `watch-scheduler.test.mjs`
3. Run `node --test tests/*.test.mjs` to verify correct count
4. Update this log and commit

#### Implementation

**Merged into `parsePlannerResponse.test.mjs`** (2 unique tests from old file):
- "handles escaped quotes in JSON strings" — verifies escaped `"Submit"` in action description
- "parses clarification_request with missing optional fields" — verifies auto-generated id, empty contextSummary, empty options array

**Deleted 3 old files:**
- `tests/planner-parser.test.mjs` — 14 tests, all covered by `parsePlannerResponse.test.mjs` (12 redundant + 2 merged)
- `tests/telegram-state.test.mjs` — 1 test, fully covered by `telegramStateStore.test.mjs`'s 21 comprehensive tests
- `tests/watch-scheduler.test.mjs` — 1 test, fully covered by `watchScheduler.test.mjs`'s 17 comprehensive tests

#### Verification

- `node --test tests/*.test.mjs` — 450/450 pass (was 464, -16 removed, +2 merged = net -14)
- Test count now accurately reflects unique coverage (no inflation from duplicates)

#### Status: DONE

#### Next Steps

- `RecoveryManager` and `settings.ts` tests remain blocked by Electron import dependency
- Consider tests for `TelegramChatBridge` message routing (would need HTTP mock for Telegram API)
- P3-10 (profile system) remains deferred

*Session log entry written: 2026-03-16*

---

### Session 36 — 2026-03-16: Extract buildRuntimeDescriptor + Test Suite

#### Context

Gap analysis: all P0–P2 backlog items done. P3 deferred. Session 35 noted `settings.ts` tests blocked by Electron import chain. `buildRuntimeDescriptor` is a pure function with important phase-determination logic but is co-located in `settings.ts` which imports `wireInboundChat`/`wireBotCommands` from `OpenBrowseRuntime.js` → chains to Electron.

#### Plan

1. Extract `buildRuntimeDescriptor` from `settings.ts` into `runtimeDescriptor.ts` (no Electron deps)
2. Update imports in `settings.ts` and `compose.ts`
3. Re-export from `index.ts`
4. Run typecheck
5. Write comprehensive test suite for `buildRuntimeDescriptor` covering all 4 phase paths + edge cases
6. Run tests
7. Commit

#### Implementation

**Extracted `packages/runtime-core/src/runtimeDescriptor.ts`:**
- Moved `buildRuntimeDescriptor` pure function out of `settings.ts`
- Only imports `RuntimeDescriptor` type from `@openbrowse/contracts` — no Electron dependency chain
- This unblocks Node-based testing for the phase-determination logic

**Updated `settings.ts`:**
- Added `import { buildRuntimeDescriptor } from "./runtimeDescriptor.js"` (for internal use in `applyRuntimeSettings`)
- Added `export { buildRuntimeDescriptor } from "./runtimeDescriptor.js"` (preserves existing public API)
- Removed the 86-line inline function definition

**Updated `compose.ts`:**
- Changed import source from `./settings.js` to `./runtimeDescriptor.js` (direct dependency)

**Created `tests/runtimeDescriptor.test.mjs` — 17 tests:**
- Phase 1 (3 tests): browser stub forces phase1 regardless of other subsystems, preserves input fields
- Phase 2 (3 tests): browser live + chat stub, stub vs live planner affects deferred capabilities
- Phase 3 (5 tests): all live, no demos, hasDemos=false/undefined, planner variants
- Phase 4 (4 tests): all live + demos, live vs stub planner, code signing always deferred
- Cross-cutting (2 tests): descriptor shape validation, spread semantics

#### Verification

- `pnpm --filter @openbrowse/runtime-core typecheck` — ✓ clean
- `pnpm --filter @openbrowse/runtime-core build` — ✓ clean
- `node --test tests/runtimeDescriptor.test.mjs` — 17/17 pass
- `node --test tests/*.test.mjs` — 467/467 pass (was 450, +17 new)

#### Status: DONE

#### Next Steps

- `RecoveryManager` tests still blocked by Electron — could apply same extraction pattern
- `createPlanner`/`createChatBridge` factory tests — these import non-Electron packages but need mocking
- `TelegramChatBridge` message routing tests (needs HTTP mock)
- P3-10 (profile system) remains deferred

*Session log entry written: 2026-03-16*

---

### Session 37 — 2026-03-16: Make RecoveryManager Testable + Test Suite

#### Context

Session 36 noted: "RecoveryManager tests still blocked by Electron — could apply same extraction pattern." `RecoveryManager` imports `recoverRun` and `emitHandoffEvent` from `OpenBrowseRuntime.ts`, which chains to Electron via `browser-runtime` and `chat-bridge` imports. This makes it impossible to test under Node.

#### Plan

1. Make `RecoveryManager` accept `recoverRunFn` and `emitHandoffFn` as constructor-injected dependencies instead of hardcoded imports from `OpenBrowseRuntime.ts`
2. Remove the direct import of `OpenBrowseRuntime.ts` from `RecoveryManager.ts`
3. Update the sole consumer (`RuntimeEventBridge.ts`) to pass these functions
4. Run typecheck
5. Write comprehensive test suite covering: recovery categorization, strategy filtering, failure handling, metadata extraction, event logging
6. Run tests
7. Commit

#### Implementation

**Refactored `packages/runtime-core/src/RecoveryManager.ts`:**
- Removed direct import of `recoverRun` and `emitHandoffEvent` from `OpenBrowseRuntime.ts` (Electron chain breaker)
- Added `RecoverRunFn` and `EmitHandoffFn` type aliases for the two injectable functions
- Added `RecoveryManagerOptions` interface: `{ strategy?, recoverRunFn, emitHandoffFn }`
- Constructor now takes `RecoveryManagerOptions` as second parameter instead of optional `RecoveryStrategy`
- Extracted `extractRecoveryMetadata` as a standalone exported pure function (was private method)

**Updated `apps/desktop/src/main/RuntimeEventBridge.ts`:**
- Imports `recoverRun` and `emitHandoffEvent` from `@openbrowse/runtime-core`
- Passes them as constructor options to `RecoveryManager`

**Created `tests/recoveryManager.test.mjs` — 20 tests:**
- DefaultRecoveryStrategy (3 tests): shouldRetry for running/non-running, maxRetries value
- extractRecoveryMetadata (3 tests): full fields, missing optional fields, undefined stepCount default
- RecoveryManager orchestration (14 tests): empty stores, clarification/approval categorization, recovery_skipped logging, successful recovery, run_recovered logging, failure handling, recovery_failed logging, checkpoint store persistence on failure, custom strategy skipping, strategy-skipped logging, mixed success/failure, combined categories, non-Error throw handling, eventBus publication

#### Verification

- `pnpm --filter @openbrowse/runtime-core typecheck` — ✓ clean
- `pnpm --filter @openbrowse/runtime-core build` — ✓ clean
- `pnpm --filter @openbrowse/desktop typecheck` — ✓ clean
- `node --test tests/recoveryManager.test.mjs` — 20/20 pass
- `node --test tests/*.test.mjs` — 487/487 pass (was 467, +20 new)

#### Status: DONE

#### Next Steps

- `createPlanner`/`createChatBridge` factory tests — these import non-Electron packages but need mocking
- `TelegramChatBridge` message routing tests (needs HTTP mock for Telegram API)
- P3-10 (profile system) remains deferred

*Session log entry written: 2026-03-16*

---

### Session 38 — 2026-03-16: Extract createPlanner/createChatBridge Factories + Test Suite

#### Context

Session 37 noted: "createPlanner/createChatBridge factory tests — these import non-Electron packages but need mocking." These two factories in `settings.ts` are pure functions that don't use Electron, but `settings.ts` imports `wireInboundChat`/`wireBotCommands` from `OpenBrowseRuntime.ts` which chains to Electron. Same extraction pattern as Sessions 36-37.

#### Plan

1. Extract `createPlanner` and `createChatBridge` from `settings.ts` into `factories.ts` (no Electron deps)
2. Update `settings.ts` to import/re-export from `./factories.js`
3. Build runtime-core
4. Write comprehensive test suite for both factories
5. Run tests
6. Commit

#### Implementation

**Created `packages/runtime-core/src/factories.ts`:**
- Moved `createPlanner` and `createChatBridge` pure factory functions out of `settings.ts`
- Imports only from `@openbrowse/chat-bridge`, `@openbrowse/contracts`, `@openbrowse/planner` — no Electron dependency chain
- This unblocks Node-based testing for both factory functions

**Updated `settings.ts`:**
- Removed inline definitions of both factories (90 lines)
- Added `import { createPlanner, createChatBridge } from "./factories.js"` (internal use in `applyRuntimeSettings`)
- Added `export { createPlanner, createChatBridge } from "./factories.js"` (preserves public API)
- Removed unused imports: `resolveTelegramConfig`, `type ChatBridge`, `type TelegramNotificationLevel`, `StubChatBridge`, `StubPlannerGateway`, `ClaudePlannerGateway`, `type PlannerGateway`, `type RuntimeDescriptor`

**Created `tests/factories.test.mjs` — 20 tests:**
- createPlanner (10 tests): stub when disabled, stub with key but disabled, live with key, custom model, default model fallback, env var fallback, no key anywhere, whitespace trimming on key/model, whitespace-only key
- createChatBridge (10 tests): stub when disabled, stub with no token, live with token, locked-to-chat vs pairing-mode descriptors, whitespace trimming on token/chatId, whitespace-only token, chatBridgeInit presence/absence

#### Verification

- `pnpm --filter @openbrowse/runtime-core build` — ✓ clean
- `pnpm --filter @openbrowse/desktop typecheck` — ✓ clean
- `node --test tests/factories.test.mjs` — 20/20 pass
- `node --test tests/*.test.mjs` — 507/507 pass (was 487, +20 new)

#### Status: DONE

#### Next Steps

- `TelegramChatBridge` message routing tests (needs HTTP mock for Telegram API)
- P3-10 (profile system) remains deferred
- Consider extracting `readStoredRuntimeSettings`/`applyRuntimeSettings` for further testability (still blocked by `wireInboundChat`/`wireBotCommands`)

*Session log entry written: 2026-03-16*

---

### Session 39 — 2026-03-16: Expand Store Contract Tests — 8 Untested InMemory Stores

#### Context

Gap analysis: store-contract.test.mjs covers only 3 of 11 InMemory store implementations (RunCheckpointStore, WorkflowLogStore, PreferenceStore — 30 tests). The remaining 8 stores have zero test coverage:
1. SessionTrackingStore (7 methods)
2. ChatSessionStore (10 methods)
3. BookmarkStore (8 methods)
4. BrowsingHistoryStore (6 methods)
5. BrowserProfileStore (4 methods)
6. CookieContainerStore (6 methods)
7. StandaloneTabStore (4 methods)
8. ChatBridgeStateStore (4 methods)

#### Plan

1. Create `tests/storeContractExtended.test.mjs` with comprehensive tests for all 8 stores
2. Run the new test file
3. Run full test suite to confirm no regressions
4. Update this log and commit

#### Implementation

**Created `tests/storeContractExtended.test.mjs` — 60 tests across 8 store types:**
- SessionTrackingStore (7 tests): create/get, get null, terminate, listByRun, listActive, listActiveByRun, deleteByRun
- ChatSessionStore (12 tests): create/get, get null, updateTitle, listSessions sorted, deleteSession cascades, deleteSession false, appendMessage+listMessages order, appendMessage updates session, clearMessages, linkRun+listRunIds, linkRun idempotent, listMessages empty
- BookmarkStore (10 tests): create/get, get null, getByUrl, getByUrl null, update fields, listByFolder, listAll sorted, search title+URL, search empty, delete true/false
- BrowsingHistoryStore (8 tests): record+listRecent, listRecent limit, listByDateRange, search case-insensitive, deleteByDateRange, deleteByDateRange 0, deleteAll, deleteAll empty
- BrowserProfileStore (5 tests): save/get, get null, upsert, listAll, delete true/false
- CookieContainerStore (7 tests): create/get, get null, update fields, listAll, listByProfile, delete true/false, update no-op
- StandaloneTabStore (5 tests): save/get, get null, upsert, listAll, delete true/false
- ChatBridgeStateStore (6 tests): set/get, get null, overwrite, delete true/false, listAll, various value types

#### Verification

- `node --test tests/storeContractExtended.test.mjs` — 60/60 pass
- `node --test tests/*.test.mjs` — 567/567 pass (was 507, +60 new)

#### Status: DONE

#### Next Steps

- `TelegramChatBridge` message routing tests (needs HTTP mock for Telegram API)
- P3-10 (profile system) remains deferred
- Consider extracting `readStoredRuntimeSettings`/`applyRuntimeSettings` for further testability

*Session log entry written: 2026-03-16*

---

### Session 40 — 2026-03-16: Stale Doc Fix + ScriptedPlannerGateway & Demo Scenario Tests

#### Context

All P0–P2 backlog done, P3 deferred. Gap analysis continuing. `ScriptedPlannerGateway` has only 2 indirect tests (`scripted-planner.test.mjs`). The class has 4 methods (`decide`, `reset`, `getCurrentStep`, constructor with `initialStepIndex`) and supports function-based decisions — all undertested. The 3 demo scenario factory functions (`createTravelSearchScenario`, `createAppointmentBookingScenario`, `createPriceMonitorScenario`) have zero structural validation tests.

Also fixed stale engineering note: element cap was documented as 50 but has been 150 since Session 20.

#### Plan

1. Fix stale engineering note (element cap 50 → 150) ✓
2. Add `tests/scriptedPlanner.test.mjs` — comprehensive tests for ScriptedPlannerGateway
3. Add `tests/demoScenarios.test.mjs` — structural validation of all 3 demo scenario factories
4. Run tests
5. Commit

#### Implementation

**Fixed stale engineering note** (Section 10): Element cap documented as 50, corrected to 150 with text cap 3000/4000 (updated in Session 20).

**Created `tests/scriptedPlanner.test.mjs` — 13 tests:**
- `getCurrentStep` (2 tests): starts at 0, respects `initialStepIndex`
- `decide` sequencing (3 tests): advances step index, returns correct decision per step, auto-completes with label when steps exhausted
- Function-based decisions (2 tests): receives PlannerInput, reads checkpoint notes
- `reset` (2 tests): sets index back to 0, enables replay from beginning
- Edge cases (4 tests): `initialStepIndex` skips earlier steps, empty scenario auto-completes immediately with "0 steps", auto-complete includes scenario label, mixed static and function decisions

**Created `tests/demoScenarios.test.mjs` — 31 tests:**
- Travel Search (9 tests): metadata, 8 steps, navigate to Google Flights, simulated page model, type departure/destination, clarification for dates, function uses answer, task_complete with airlines, all steps valid
- Appointment Booking (7 tests): metadata, 7 steps, navigate to ZocDoc, clarification for provider (3+ options), approval request (irreversible), task_complete with booking, all steps valid
- Price Monitor (9 tests): metadata, 4 steps, clarification for product URL, function navigate, URL extraction from answer, fallback URL, extract action, task_complete with price, all steps valid
- Cross-scenario (2 tests): unique IDs, non-empty labels

#### Verification

- `node --test tests/scriptedPlanner.test.mjs tests/demoScenarios.test.mjs` — 44/44 pass
- `node --test tests/*.test.mjs` — 611/611 pass (was 567, +44 new)
- `pnpm run typecheck` — clean

#### Status: DONE

#### Next Steps

- `TelegramChatBridge` message routing tests (needs HTTP mock for Telegram API)
- P3-10 (profile system) remains deferred
- Consider extracting `readStoredRuntimeSettings`/`applyRuntimeSettings` for further testability

*Session log entry written: 2026-03-16*

---

### Session 41 — 2026-03-16: Extract mapToolCallToDecision + Test Suite

#### Context

Gap analysis: `ClaudePlannerGateway.ts` contains `mapToolCallToDecision`, a pure function that translates Claude tool_use calls (12 tool types) into `PlannerDecision` objects. This is the critical translation layer between the Anthropic API response and the runtime's decision model. Currently: private, unexported, untested. The gateway class itself can't be tested under Node (needs real API), but the mapping logic is a pure function that can be extracted and tested.

Also contains `BROWSER_TOOLS` — the tool schema definitions sent to Claude. Extracting both enables testing and reuse.

#### Plan

1. Extract `mapToolCallToDecision`, `ToolInput` type, and `BROWSER_TOOLS` from `ClaudePlannerGateway.ts` into `toolMapping.ts`
2. Update `ClaudePlannerGateway.ts` to import from `./toolMapping.js`
3. Run typecheck
4. Write comprehensive test suite for all 12 tool mappings + edge cases
5. Run tests
6. Commit

#### Implementation

**Created `packages/planner/src/toolMapping.ts`:**
- Extracted `mapToolCallToDecision` pure function (was private in `ClaudePlannerGateway.ts`)
- Extracted `BROWSER_TOOLS` constant (12 tool schema definitions sent to Claude)
- Exported `ToolInput` interface for typed tool call inputs
- No new dependencies — only imports types from `@anthropic-ai/sdk` and `@openbrowse/contracts`

**Updated `packages/planner/src/ClaudePlannerGateway.ts`:**
- Removed 320 lines of inline tool definitions and mapping logic
- Added `import { BROWSER_TOOLS, mapToolCallToDecision, type ToolInput } from "./toolMapping.js"`
- Gateway class unchanged — only import source changed

**Updated `packages/planner/src/index.ts`:**
- Added `export * from "./toolMapping.js"` to public API

**Created `tests/toolMapping.test.mjs` — 36 tests across 15 describe blocks:**
- BROWSER_TOOLS schema validation (4 tests): count, uniqueness, structure, expected names
- browser_navigate (2 tests): full mapping, default description
- browser_click (2 tests): targetId mapping, default description
- browser_type (2 tests): targetId+value mapping, default description
- browser_select (2 tests): targetId+value mapping, default description
- browser_scroll (4 tests): direction, element-scoped ref, default direction, default description
- browser_hover (2 tests): targetId mapping, default description
- browser_press_key (3 tests): key value, key combinations, default description
- browser_wait (3 tests): duration as string, default 1000, default description
- browser_screenshot (1 test): fixed description
- task_complete (2 tests): summary, reasoning fallback
- task_failed (2 tests): reason, reasoning fallback
- ask_user (5 tests): question+options, no options, reasoning fallback, id prefix, createdAt
- unknown tool (1 test): returns task_failed
- cross-cutting (1 test): reasoning preserved across all 12 tool types

#### Verification

- `pnpm --filter @openbrowse/planner build` — ✓ clean
- `pnpm run typecheck` — ✓ clean
- `node --test tests/toolMapping.test.mjs` — 36/36 pass
- `node --test tests/*.test.mjs` — 647/647 pass (was 611, +36 new)

#### Status: DONE

#### Next Steps

- `TelegramChatBridge` message routing tests (needs HTTP mock for Telegram API)
- P3-10 (profile system) remains deferred
- Consider extracting `readStoredRuntimeSettings`/`applyRuntimeSettings` for further testability
- Consider extracting `assembleRuntimeServices` from `compose.ts` (blocked by `bootstrapRun` import from `OpenBrowseRuntime.ts`)

*Session log entry written: 2026-03-16*

---

### Session 42 — 2026-03-16: Extract readStoredRuntimeSettings + Test Suite

#### Context

Session 41 noted: "Consider extracting `readStoredRuntimeSettings`/`applyRuntimeSettings` for further testability." `readStoredRuntimeSettings` is a pure async function that only depends on `services.preferenceStore.get()` and `createDefaultRuntimeSettings()`. However, it lives in `settings.ts` which imports `wireInboundChat`/`wireBotCommands` from `OpenBrowseRuntime.ts` → Electron chain. `applyRuntimeSettings` does depend on Electron imports, but `readStoredRuntimeSettings` does not.

#### Plan

1. Extract `readStoredRuntimeSettings` and `RUNTIME_SETTINGS_NAMESPACE` into `settingsStore.ts` (no Electron deps)
2. Update `settings.ts` to import from `./settingsStore.js`
3. Re-export from `index.ts`
4. Run typecheck
5. Write test suite for `readStoredRuntimeSettings` covering: defaults, stored values, JSON parsing, invalid JSON, partial settings
6. Run tests
7. Commit

#### Implementation

**Created `packages/runtime-core/src/settingsStore.ts`:**
- Extracted `readStoredRuntimeSettings` pure async function out of `settings.ts`
- Extracted `RUNTIME_SETTINGS_NAMESPACE` constant
- Signature changed from `(services: RuntimeServices)` to `(preferenceStore: PreferenceStore)` — cleaner dependency, no RuntimeServices bag needed
- Only imports from `@openbrowse/contracts` and `@openbrowse/memory-store/memory` — no Electron dependency chain

**Updated `settings.ts`:**
- Removed inline `readStoredRuntimeSettings` function (30 lines) and `RUNTIME_SETTINGS_NAMESPACE` constant
- Added `import { readStoredRuntimeSettings, RUNTIME_SETTINGS_NAMESPACE } from "./settingsStore.js"`
- Added `export { readStoredRuntimeSettings, RUNTIME_SETTINGS_NAMESPACE } from "./settingsStore.js"` (preserves public API)
- Updated 3 call sites: `readStoredRuntimeSettings(services)` → `readStoredRuntimeSettings(services.preferenceStore)`
- Removed unused imports: `createDefaultRuntimeSettings`, `RiskClassPolicies`

**Created `tests/settingsStore.test.mjs` — 18 tests:**
- Namespace constant (1 test): correct value
- Defaults (4 tests): all defaults when empty, anthropicApiKey empty, plannerModel default, notificationLevel quiet
- Stored values (5 tests): each of the 5 string settings read correctly from store
- riskClassPolicies JSON (4 tests): valid JSON, invalid JSON fallback, empty value fallback, all 6 risk classes
- Partial settings (2 tests): mixed stored/default values, all 6 settings simultaneously
- Return shape (2 tests): exactly 6 keys, concurrent independent reads

#### Verification

- `pnpm --filter @openbrowse/runtime-core build` — ✓ clean
- `pnpm --filter @openbrowse/desktop typecheck` — ✓ clean
- `node --test tests/settingsStore.test.mjs` — 18/18 pass
- `node --test tests/*.test.mjs` — 665/665 pass (was 647, +18 new)

#### Status: DONE

#### Next Steps

- `TelegramChatBridge` message routing tests (needs HTTP mock for Telegram API)
- P3-10 (profile system) remains deferred
- Consider extracting `assembleRuntimeServices` from `compose.ts` (blocked by `bootstrapRun` import from `OpenBrowseRuntime.ts`)

*Session log entry written: 2026-03-16*

---

### Session 43 — 2026-03-16: Extract assembleRuntimeServices from Electron dependency + Test Suite + Duplicate Cleanup

#### Context

Session 42 noted: "Consider extracting assembleRuntimeServices from compose.ts (blocked by bootstrapRun import from OpenBrowseRuntime.ts)." assembleRuntimeServices creates the scheduler with a hardcoded bootstrapRuntimeRun import from OpenBrowseRuntime.ts which chains to Electron. Making the scheduler dispatch function injectable (same pattern as RecoveryManager Session 37) will unblock Node-based testing.

Also cleaning up scripted-planner.test.mjs duplicate (2 tests, both covered by scriptedPlanner.test.mjs 13 tests).

#### Plan

1. Add `schedulerDispatch` parameter to `AssembleServicesParams`
2. Remove `bootstrapRun` import from `compose.ts`
3. Update `composeRuntime.ts` to pass `bootstrapRun` as `schedulerDispatch`
4. Run typecheck
5. Write test suite for `assembleRuntimeServices` and `createRuntimeStorage`
6. Delete duplicate `scripted-planner.test.mjs`
7. Run tests
8. Commit

#### Implementation

**Refactored `packages/runtime-core/src/compose.ts`:**
- Removed direct import of `bootstrapRun` from `OpenBrowseRuntime.ts` (Electron chain breaker)
- Added `schedulerDispatch: (services: RuntimeServices, intent: TaskIntent) => Promise<unknown>` to `AssembleServicesParams`
- Scheduler now calls `params.schedulerDispatch(services, schedulerIntent)` instead of hardcoded `bootstrapRuntimeRun`
- `compose.ts` is now fully importable from system Node without Electron

**Updated `apps/desktop/src/main/runtime/composeRuntime.ts`:**
- Imports `bootstrapRun` from `@openbrowse/runtime-core`
- Passes it as `schedulerDispatch: bootstrapRun` to `assembleRuntimeServices`

**Created `tests/compose.test.mjs` — 19 tests:**
- `createRuntimeStorage` (3 tests): no dbPath returns in-memory, all 11 store properties present, invalid dbPath falls back to memory
- `assembleRuntimeServices` (16 tests): all RuntimeServices keys present, store pass-through, kernel/bridge/planner pass-through, config/settings pass-through, EventBus creation, TaskOrchestrator creation, DefaultApprovalPolicy creation, scheduler creation, hasDemos propagation (true/false), telegramStatePath, sqliteDb, descriptor built from subsystem descriptors, init functions pass-through, schedulerDispatch integration, riskClassPolicies used in securityPolicy

**Deleted duplicate `tests/scripted-planner.test.mjs`** — 2 tests fully covered by `scriptedPlanner.test.mjs` (13 tests)

#### Verification

- `pnpm --filter @openbrowse/runtime-core build` — ✓ clean
- `pnpm --filter @openbrowse/desktop typecheck` — ✓ clean
- `node --test tests/compose.test.mjs` — 19/19 pass
- `node --test tests/*.test.mjs` — 682/682 pass (was 665, +19 new, -2 duplicate removed)

#### Status: DONE

#### Next Steps

- `TelegramChatBridge` message routing tests (needs HTTP mock for Telegram API)
- P3-10 (profile system) remains deferred
- All major pure-function modules now have test coverage; remaining untested code requires Electron context or network mocking

*Session log entry written: 2026-03-16*

---

### Session 44 — 2026-03-16: RunExecutor Stuck Detection + Safety Path Tests

#### Context

Gap analysis: RunExecutor has 18 tests covering happy paths and basic failure modes, but several critical safety/reliability paths are untested: consecutive identical action detection, URL visit count limit, cycle detection integration, page model capture failure with retry/fallback, cancellation after planner call, checkpoint-based cancellation, and step progress sending. These are the planner loop's core safety mechanisms.

#### Plan

1. Add tests to `tests/runExecutor.test.mjs` for untested plannerLoop paths
2. Targets: consecutive identical actions → fail, URL visit count → fail, cycle detection → fail, capturePageModel retry/fallback, cancellation after planner, checkpoint cancellation, step progress
3. Run tests
4. Update this log and commit

#### Implementation

**Extended `tests/runExecutor.test.mjs` — 9 new tests (18 → 27):**

- `consecutive identical actions` (1 test): 9+ identical actionKeys trigger fail with "repeated" message; uses custom `recordBrowserResult` mock to produce unique history entries (avoiding false cycle detection trigger)
- `URL visit count limit` (1 test): pre-populated `urlVisitCounts` at 12 triggers fail with "visited" message
- `cycle detection integration` (1 test): pre-populated 7-entry alternating action history + 1 new entry completes 2-step cycle (4 reps), triggers fail with "cycle" message
- `capturePageModel retry on first failure` (1 test): first `capturePageModel` throws, second succeeds → run completes normally; verifies retry logic (includes 500ms settle delay)
- `capturePageModel double failure fallback` (1 test): both captures throw → fallback page model with `PAGE_MODEL_CAPTURE_FAILED` alert → planner still called → run completes
- `cancellation after planner` (1 test): cancellation flag set during planner.decide callback → detected at post-planner checkpoint → acknowledged, no handoff
- `checkpoint-based cancellation` (1 test): `runCheckpointStore.load` returns cancelled run → loop exits early returning cancelled status
- `step progress sending` (1 test): `shouldSendStepProgress()` returns true → chatBridge.send called with step text containing channel "telegram"
- `network_error soft failure` (1 test): `failureClass: "network_error"` treated as soft failure (like `element_not_found`), loop continues

#### Verification

- `pnpm run typecheck` — ✓ clean
- `node --test tests/runExecutor.test.mjs` — 27/27 pass
- `node --test tests/*.test.mjs` — 691/691 pass (was 682, +9 new)

#### Status: DONE

#### Next Steps

- `TelegramChatBridge` message routing tests (needs HTTP mock for Telegram API)
- P3-10 (profile system) remains deferred
- Consider testing `continueResume` without `lastKnownUrl` (skip navigate path)
- Consider testing `buildPlannerPrompt` untested conditional sections (scrollSection, activePageHint, selfAssessment triggers)

*Session log entry written: 2026-03-16*

---

### Session 45 — 2026-03-16: Gap Analysis — buildPlannerPrompt Untested Conditional Sections

#### Context

Continuing gap analysis. `buildPlannerPrompt` has 18 tests but 11 conditional sections are untested: failedUrlsSection, usedQueriesSection, repeatedNavWarning, scrollSection, lastActionSection, urlWarning, pageTypeStr, alertsSection, formsSection, activePageHint, and self-assessment trigger 3 (URL visit count >= 4).

#### Plan

1. Add tests to `tests/planner-prompt.test.mjs` for all 11 untested conditional sections
2. Run tests
3. Update this log and commit

#### Implementation

Extended `tests/planner-prompt.test.mjs` — 27 new tests (18 → 45, but file already had 17 existing + 1 replaced = 44 total):

- `failedUrlsSection` (2 tests): unique failed URLs listed, absent when no failures
- `usedQueriesSection` (2 tests): unique typed queries listed, absent when no type actions
- `repeatedNavWarning` (2 tests): triggers on 3 same-URL navigates, absent for varied
- `scrollSection` (2 tests): shows Y position, absent when undefined
- `lastActionSection` (2 tests): success result, failure with class
- `urlWarning` (2 tests): frequent URLs listed (>=4), absent below threshold
- `pageTypeStr` (2 tests): shows non-unknown type, absent for unknown
- `alertsSection` (2 tests): lists alerts, absent when empty
- `formsSection` (2 tests): enriched fields with labels/types/required/values/submitRef, absent when empty
- `activePageHint` (3 tests): appears on step 0 + non-blank URL, absent for about:blank, absent after step 0
- `selfAssessment trigger 3` (1 test): URL visited 4+ times triggers PROGRESS CHECK
- `typedText in action history` (1 test): Typed text field rendered
- `targetUrl in action history` (1 test): URL field rendered
- `element attributes` (1 test): href, inputType, value, disabled, readonly, off-screen all rendered
- `no interactive elements` (1 test): "(no interactive elements found)" message
- `constraints none` (1 test): "none" shown when constraints empty

#### Verification

- `pnpm run typecheck` — ✓ clean
- `node --test tests/planner-prompt.test.mjs` — 44/44 pass
- `node --test tests/*.test.mjs` — 718/718 pass (was 691, +27 new)

#### Status: DONE

#### Next Steps

- `TelegramChatBridge` message routing tests (needs HTTP mock for Telegram API)
- P3-10 (profile system) remains deferred
- Consider testing `continueResume` without `lastKnownUrl` (skip navigate path)

*Session log entry written: 2026-03-16*

---

### Session 46 — 2026-03-16: Comprehensive TaskOrchestrator Test Suite

#### Context

Gap analysis: `TaskOrchestrator` has 10 public methods (`createRun`, `startRun`, `attachSession`, `observePage`, `applyPlannerDecision` × 6 decision types, `recordBrowserResult`, `resumeFromClarification`, `resumeFromApproval`, `failRun`, `cancelRun`) but only 1 test covering clarification suspend/resume. This is the largest pure-logic coverage gap in the codebase.

Also adding `continueResume` without `lastKnownUrl` test to `runExecutor.test.mjs`.

#### Plan

1. Replace `task-orchestrator.test.mjs` with comprehensive test suite covering all 10 methods
2. Add `continueResume` skip-navigate test to `runExecutor.test.mjs`
3. Run tests
4. Update this log and commit

#### Implementation

**Rewrote `tests/task-orchestrator.test.mjs` — 52 tests (was 1):**
- `createRun` (5 tests): field mapping, createdAt handling, constraints/metadata, preferredProfileId
- `startRun` (2 tests): queued→running transition, invalid transition from completed
- `attachSession` (2 tests): profileId/browserSessionId/pageModelId, optional pageModelId
- `observePage` (7 tests): URL/title/summary/stepCount updates, stepCount increments, snapshot with truncated visibleText, formValues extraction from input elements, omitted formValues when empty, browserSessionId override, empty title→undefined
- `applyPlannerDecision — clarification_request` (2 tests): full suspension fields, fallback when no request object
- `applyPlannerDecision — approval_request` (2 tests): full suspension fields with action, irreversibleActionSummary fallback
- `applyPlannerDecision — task_complete` (2 tests): full completion fields, completionSummary priority over reasoning
- `applyPlannerDecision — task_failed` (2 tests): full failure fields, failureSummary priority over reasoning
- `applyPlannerDecision — browser_action` (3 tests): keeps running with nextSuggestedStep, reasoning fallback, queued→running transition
- `recordBrowserResult` (12 tests): actionHistory append, cap at 25, consecutiveSoftFailures for element_not_found/network_error, reset on success, non-soft excluded, urlVisitCounts for navigate/non-navigate, targetUrl/typedText recording, lastFailureClass set/cleared
- `resumeFromClarification` (2 tests): transitions to running with answer in notes, throws from completed
- `resumeFromApproval` (3 tests): granted/denied notes, custom respondedAt
- `failRun` (3 tests): running→failed, suspended→failed, throws from completed
- `cancelRun` (4 tests): running→cancelled, queued→cancelled, suspended→cancelled, throws from failed
- Full lifecycle (1 test): create→start→attach→observe→decide→record→complete

**Extended `tests/runExecutor.test.mjs` — 1 new test (27 → 28):**
- `continueResume skips navigate when no lastKnownUrl`: verifies no navigate action executed, goes straight to plannerLoop

#### Verification

- `node --test tests/task-orchestrator.test.mjs` — 52/52 pass
- `node --test tests/runExecutor.test.mjs` — 28/28 pass
- `node --test tests/*.test.mjs` — 770/770 pass (was 718, +52 new, +1 new, -1 replaced)

#### Status: DONE

#### Next Steps

- `TelegramChatBridge` message routing tests (needs HTTP mock for Telegram API)
- P3-10 (profile system) remains deferred
- Consider testing `ClaudePlannerGateway.decide` integration paths (needs API mock)

*Session log entry written: 2026-03-16*

---

### Session 47 — 2026-03-16: ClaudePlannerGateway Unit Tests (Mock API)

#### Context

Gap analysis: `ClaudePlannerGateway` is the sole untested pure-logic module in `packages/planner`. It has 4 distinct code paths: (1) happy path — first API call returns tool_use, (2) text-only response triggers retry with forced tool_choice, (3) timeout returns task_failed, (4) retry also returns no tool_use → task_failed. All are testable by overriding the `client.messages.create` method after construction.

#### Plan

1. Create `tests/claudePlannerGateway.test.mjs` with mock-based tests for all code paths
2. Run tests, update log, commit

#### Implementation

**Created `tests/claudePlannerGateway.test.mjs` — 17 tests:**

- `happy path — browser_action` (1 test): first API call returns `tool_use` with `browser_click` → correct `browser_action` decision with targetId, description, reasoning
- `happy path — task_complete` (1 test): `task_complete` tool → correct decision with completionSummary
- `happy path — task_failed` (1 test): `task_failed` tool → correct decision with failureSummary
- `happy path — clarification_request` (1 test): `ask_user` tool → correct decision with question, options, runId
- `happy path — browser_navigate` (1 test): `browser_navigate` tool → navigate action with URL
- `reasoning extraction — multiple text blocks` (1 test): two text blocks joined with newline
- `reasoning extraction — no text blocks` (1 test): fallback "No reasoning provided"
- `retry path — text-only first response` (1 test): first call returns text-only → retry with `tool_choice: "any"` → second call returns tool_use → correct decision; verifies both API calls made
- `retry path — context preservation` (1 test): retry messages include original assistant response + follow-up prompt
- `retry failure — text-only on both calls` (1 test): both text-only → `task_failed` with "no tool call after retry"
- `retry failure — retry throws` (1 test): retry throws → `task_failed` with "no tool call after retry"
- `timeout` (1 test): error containing "Planner timed out" → `task_failed` with timeout message (not re-thrown)
- `non-timeout error re-throws` (1 test): other errors propagate normally
- `config — custom model and maxTokens` (1 test): configured values passed to API
- `config — defaults` (1 test): default `claude-opus-4-6` model, 4096 maxTokens
- `API params` (1 test): BROWSER_TOOLS, system prompt, and user message all passed correctly
- `runId propagation` (1 test): custom runId appears in clarification_request

Mock approach: override `gateway.client.messages.create` after construction (compiled JS exposes `client` as a public property). No import mocking needed.

#### Verification

- `pnpm run typecheck` — ✓ clean
- `node --test tests/claudePlannerGateway.test.mjs` — 17/17 pass
- `node --test tests/*.test.mjs` — 787/787 pass (was 770, +17 new)

#### Status: DONE

#### Next Steps

- `TelegramChatBridge` message routing tests (needs Grammy Bot mock — more complex)
- P3-10 (profile system) remains deferred
- All pure-logic modules in `planner`, `orchestrator`, `runtime-core`, `observability`, `security`, `chat-bridge` (except TelegramChatBridge) now have test coverage

*Session log entry written: 2026-03-16*

---

### Session 48 — 2026-03-16: TelegramChatBridge Public API Tests (Mock Bot)

#### Context

Gap analysis: `TelegramChatBridge` is the last untested module in the entire codebase (excluding Electron-dependent modules). It implements the `ChatBridge` interface and manages Telegram bot message routing. Grammy's `Bot` constructor works with a fake token without network calls — all API methods (`bot.api.sendMessage`, `bot.api.editMessageReplyMarkup`, etc.) can be monkey-patched after construction.

#### Plan

1. Create `tests/telegramChatBridge.test.mjs` with mock-based tests for all public methods
2. Test targets: `send` (chatId resolution, split messages, error handling), `sendClarification` (markdown, keyboard, fallback), `shouldSendStepProgress`, `bindRunToChat`, `clearRunState`, `normalizeInbound`, `start`/`stop` (idempotency, chatId auto-approve)
3. Run tests
4. Update this log and commit

#### Implementation

**Created `tests/telegramChatBridge.test.mjs` — 30 tests:**

- `shouldSendStepProgress` (3 tests): verbose=true, quiet=false, undefined=false
- `normalizeInbound` (1 test): passthrough identity
- `start` (4 tests): registers 4 commands, idempotent, auto-approves config.chatId, handles setMyCommands failure
- `stop` (2 tests): no-op when not started, clears started flag
- `send` (7 tests): config.chatId fallback, run binding priority, primary approved fallback, no chatId silent return, error swallowed, long message splitting at line boundaries, short message single call
- `sendClarification` (6 tests): markdown+keyboard+registration, no keyboard when no options, plain text fallback on markdown error, double failure silent, Markdown special char escaping, no chatId silent return
- `bindRunToChat` (1 test): delegates to stateStore
- `clearRunState` (3 tests): removes stale clarifications + edits keyboard, no-op for unknown, swallows edit errors
- `setInboundHandler` / `setCommandHandler` (2 tests): stores handler references
- `resolveOutboundChatId priority` (1 test): run binding > config.chatId > primary approved

Mock approach: Grammy's `Bot` constructor works with a fake token without network calls. After construction, monkey-patch `bot.api.sendMessage`, `bot.api.editMessageReplyMarkup`, `bot.api.setMyCommands`, `bot.start`, and `bot.stop` — capturing all calls in an array. Each test creates an isolated bridge with a temp state directory.

#### Verification

- `node --test tests/telegramChatBridge.test.mjs` — 30/30 pass
- `node --test tests/*.test.mjs` — 817/817 pass (was 787, +30 new)

#### Status: DONE

#### Next Steps

- All pure-logic modules across all packages now have test coverage (817 tests, 0 failures)
- Remaining untested code requires Electron context (BrowserViewManager, ElectronBrowserKernel, AppBrowserShell, renderer components)
- P3-10 (profile system) remains deferred
- Consider integration testing under Electron test harness for SQLite stores and browser kernel

*Session log entry written: 2026-03-16*

---

### Session 49 — 2026-03-16: Stale Documentation Fix + Dead Code Removal (parsePlannerResponse)

#### Context

Gap analysis (Session 48 done, all pure-logic modules tested, 817 tests). Code review found:

1. **Stale schema version in Section 10**: says "Current schema version: **3**" but `schema.ts` has `SCHEMA_VERSION = 4`. Migration 4 (V3→V4) added all session/chat/bookmark/history/profile/container/tab/state tables — undocumented in the table.
2. **Stale Planner Output Format in Section 10**: says `ClaudePlannerGateway` uses `output_config.format` with a flat JSON schema. This was the old approach. The gateway now uses `tools` + `tool_choice` (12 tool definitions from `BROWSER_TOOLS`) with `mapToolCallToDecision`. `parsePlannerResponse` is referenced but no longer used.
3. **Dead code**: `parsePlannerResponse` is exported from `packages/planner/src/index.ts` but never imported by any runtime code. It was the old JSON-parsing approach replaced by tool-use mapping in Session 41. Its 20-test file (`tests/parsePlannerResponse.test.mjs`) tests dead code.

#### Plan

1. Fix schema version 3→4 and add migration 4 to the table
2. Rewrite Planner Output Format section to reflect tool-use approach
3. Remove `parsePlannerResponse.ts` and its re-export from `index.ts`
4. Remove `tests/parsePlannerResponse.test.mjs`
5. Run typecheck + tests
6. Update this log and commit

#### Implementation

**Fixed stale Section 10 — Schema Migrations:**
- Updated version 3→4
- Added migration 4 row documenting 11 new tables (browser_sessions, chat_sessions, chat_messages, chat_session_runs, bookmarks, browsing_history, browser_profiles, cookie_containers, user_accounts, standalone_tabs, chat_bridge_state)

**Fixed stale Section 10 — Planner Output Format:**
- Rewrote to reflect actual tool-use approach: `BROWSER_TOOLS` (12 tools), `tool_choice: "auto"` → retry with `"any"`, `mapToolCallToDecision`
- Removed references to `output_config.format`, JSON schema, `parsePlannerResponse`, and `extractJson` fallbacks

**Removed dead code — `parsePlannerResponse`:**
- Deleted `packages/planner/src/parsePlannerResponse.ts` (147 lines) — old JSON-parsing approach replaced by `mapToolCallToDecision` in Session 41
- Removed `export * from "./parsePlannerResponse.js"` from `packages/planner/src/index.ts`
- Deleted `tests/parsePlannerResponse.test.mjs` (19 tests, 195 lines) — tested dead code

#### Verification

- `pnpm --filter @openbrowse/planner build` — ✓ clean
- `pnpm run typecheck` — ✓ clean
- `node --test tests/*.test.mjs` — 798/798 pass (was 817, -19 dead code tests removed)

#### Status: DONE

#### Next Steps

- All pure-logic modules across all packages have test coverage (798 tests, 0 failures)
- Remaining untested code requires Electron context (BrowserViewManager, ElectronBrowserKernel, AppBrowserShell, renderer components)
- P3-10 (profile system) remains deferred
- Consider integration testing under Electron test harness for SQLite stores and browser kernel

*Session log entry written: 2026-03-16 (Session 49)*

---

### Session 50 — 2026-03-16: Add Required-Field Guards to mapToolCallToDecision (Boundary Validation)

#### Context

Code review / gap analysis after all P0-P2 backlog complete and 798 tests passing. Found that `mapToolCallToDecision` in `packages/planner/src/toolMapping.ts` passes optional `ToolInput` fields directly into `BrowserAction` fields without validation. If Claude omits a required field (e.g. `url` for `browser_navigate`, `key` for `browser_press_key`, `ref` for `browser_click`), `undefined` propagates to the browser kernel, causing a runtime error instead of a clean `task_failed` at the planner boundary.

#### Plan

1. Add presence guards for required fields in each tool case in `mapToolCallToDecision`
2. Return `task_failed` with descriptive message when required field is missing
3. Add tests for all missing-required-field cases
4. Run typecheck + tests
5. Update this log and commit

#### Implementation

**Modified `packages/planner/src/toolMapping.ts`:**
- Added `fail()` helper to DRY up task_failed returns
- Added required-field guards before each browser action case:
  - `browser_navigate`: requires `url`
  - `browser_click`: requires `ref`
  - `browser_type`: requires `ref` and `text`
  - `browser_select`: requires `ref` and `value`
  - `browser_hover`: requires `ref`
  - `browser_press_key`: requires `key`
- `browser_scroll`, `browser_wait`, `browser_screenshot` have no strictly required fields (all have sensible defaults)
- Missing fields now return `task_failed` with a descriptive `failureSummary` (e.g. `"browser_navigate called without url"`)

**Added 10 tests to `tests/toolMapping.test.mjs`:**
- 8 missing-field cases: navigate/url, click/ref, type/ref, type/text, select/ref, select/value, hover/ref, press_key/key
- 2 empty-string cases: navigate with `""` url, type with `""` text (both falsy, caught by guards)

#### Verification

- `pnpm --filter @openbrowse/planner build` — ✓ clean
- `pnpm run typecheck` — ✓ clean
- `node --test tests/toolMapping.test.mjs` — 46/46 pass (was 36, +10 new)
- `node --test tests/*.test.mjs` — 808/808 pass (was 798, +10 new)

#### Status: DONE

#### Next Steps

- Issue 1 from gap analysis: validate `riskClassPolicies` from JSON.parse in `settingsStore.ts` (security boundary)
- Issue 4: add try/catch around JSON.parse in `SqliteRunCheckpointStore` (resilience)
- Issue 5: surface retry error in `ClaudePlannerGateway` catch block (observability)
- P3-10 (profile system) remains deferred

*Session log entry written: 2026-03-16 (Session 50)*

---

### Session 51 — 2026-03-16: Harden JSON.parse Boundaries + Surface Retry Error

#### Context

Gap analysis follow-up from Session 50. Three small hardening issues at JSON.parse / error boundaries:

1. **settingsStore.ts line 27**: `JSON.parse(riskClassPoliciesRaw.value)` assigned directly without shape validation. Non-object or invalid keys/values propagate.
2. **SqliteRunCheckpointStore.ts lines 38/43/48**: `JSON.parse(row.data)` can throw on corrupted data, crashing the caller.
3. **ClaudePlannerGateway.ts line 76**: Bare `catch {}` on retry swallows error info.

#### Plan

1. Add `validateRiskClassPolicies()` to `settingsStore.ts` — strip invalid keys/values
2. Wrap `JSON.parse` in `SqliteRunCheckpointStore` with try/catch
3. Capture retry error in `ClaudePlannerGateway` and include in failureSummary
4. Add tests for all three changes
5. Run typecheck + tests
6. Update this log and commit

#### Implementation

**Fix 1 — `packages/runtime-core/src/settingsStore.ts`:**
- Added exported `validateRiskClassPolicies(parsed: unknown)` function
- Validates input is a non-null, non-array object
- Strips keys not in `VALID_RISK_CLASSES` set (financial, credential, destructive, submission, navigation, general)
- Strips values not in `VALID_POLICIES` set (always_ask, auto_approve, default)
- `readStoredRuntimeSettings` now calls `validateRiskClassPolicies()` on the parsed result

**Fix 2 — `packages/memory-store/src/SqliteRunCheckpointStore.ts`:**
- `load()`: wrapped `JSON.parse` in try/catch, returns `null` on parse failure
- `listByStatus()` and `listAll()`: extracted shared `parseRows()` helper with try/catch per row — corrupted rows are silently skipped

**Fix 3 — `packages/planner/src/ClaudePlannerGateway.ts`:**
- Retry catch block now captures error message in `retryError` variable
- `failureSummary` includes ` (retry error: <message>)` suffix when retry threw

**Tests added:**
- `tests/settingsStore.test.mjs`: +12 tests (9 for `validateRiskClassPolicies` + 3 integration tests for invalid stored JSON shapes)
- `tests/claudePlannerGateway.test.mjs`: updated 1 test to assert retry error is surfaced in failureSummary

#### Verification

- `pnpm --filter @openbrowse/runtime-core build` — ✓ clean
- `pnpm --filter @openbrowse/planner build` — ✓ clean
- `pnpm --filter @openbrowse/memory-store build` — ✓ clean
- `pnpm run typecheck` — ✓ clean
- `node --test tests/settingsStore.test.mjs` — 30/30 pass (was 18, +12 new)
- `node --test tests/claudePlannerGateway.test.mjs` — 17/17 pass (1 updated assertion)
- `node --test tests/*.test.mjs` — 820/820 pass (was 808, +12 new)

#### Status: DONE

#### Next Steps

- Issue 4 from gap analysis (try/catch `JSON.parse` in `SqliteRunCheckpointStore`) — DONE in this session
- Issue 5 (surface retry error in `ClaudePlannerGateway`) — DONE in this session
- All three gap analysis hardening issues now resolved
- P3-10 (profile system) remains deferred
- Consider integration testing under Electron test harness for SQLite stores and browser kernel

*Session log entry written: 2026-03-16 (Session 51)*

---

### Session 52 — 2026-03-16: Test Suite Consolidation — Remove 3 Superseded Test Files

#### Context

Gap analysis found 3 older test files that are fully superseded by comprehensive replacements from later sessions. Same consolidation pattern as Session 35.

Duplicates identified:
1. `orchestrator-state.test.mjs` (12 tests, Session 15) — superseded by `task-orchestrator.test.mjs` (52 tests, Session 46). 4 unique tests to merge: form values cap at 20, inputs without value, targetId capture, targetId absent.
2. `safety-recovery.test.mjs` (10 tests, Session 15) — all 10 tests covered by dedicated files: `approval-deny-continue.test.mjs`, `approval-policy.test.mjs`, `auditTrail.test.mjs`, `logReplayer.test.mjs`.
3. `planner-loop.test.mjs` (9 tests, Session 18) — all 9 tests covered by `runExecutor.test.mjs` (28 tests, Session 44) which tests the same `plannerLoop` function.

#### Plan

1. Merge unique tests from `orchestrator-state.test.mjs` into `task-orchestrator.test.mjs`
2. Delete `orchestrator-state.test.mjs`, `safety-recovery.test.mjs`, `planner-loop.test.mjs`
3. Run `node --test tests/*.test.mjs` to verify correct count
4. Update this log and commit

#### Implementation

**Merged into `task-orchestrator.test.mjs`** (3 unique tests from old file):
- "observePage caps formValues at 20 entries" — verifies form extraction cap
- "observePage only captures inputs with non-empty value" — verifies empty/non-input elements produce undefined formValues
- "recordBrowserResult omits targetId when action has none" — verifies navigate actions don't inject spurious targetId

**Deleted 3 old files:**
- `tests/orchestrator-state.test.mjs` — 12 tests, all covered by `task-orchestrator.test.mjs` (9 redundant + 3 merged)
- `tests/safety-recovery.test.mjs` — 10 tests, all covered by dedicated files (`approval-deny-continue`, `approval-policy`, `auditTrail`, `logReplayer`)
- `tests/planner-loop.test.mjs` — 9 tests, all covered by `runExecutor.test.mjs`'s 28 comprehensive tests

#### Verification

- `node --test tests/*.test.mjs` — 792/792 pass (was 820, -31 removed, +3 merged = net -28)
- Test count now accurately reflects unique coverage (no inflation from duplicates)
- 36 test files remain (was 39)

#### Status: DONE

#### Next Steps

- All pure-logic modules across all packages have test coverage (792 tests, 0 failures)
- Remaining untested code requires Electron context
- P3-10 (profile system) remains deferred
- Consider integration testing under Electron test harness for SQLite stores and browser kernel

*Session log entry written: 2026-03-16 (Session 52)*

---

### Session 53 — 2026-03-16: Extract classifyFailure + parseKeyboardShortcut from ElectronBrowserKernel + Tests

#### Context

Gap analysis: all P0–P2 backlog items done. P3 deferred. All pure-logic modules tested (792 tests). `ElectronBrowserKernel.ts` contains two pure functions embedded in Electron-dependent code:

1. `classifyFailure(message)` — maps error messages to `BrowserActionFailureClass` values. Important for stuck detection and planner feedback.
2. `dispatchKeyboardShortcut` contains modifier+key parsing logic that's pure.

Same extraction pattern as Sessions 36–37.

#### Plan

1. Extract `classifyFailure` from `ElectronBrowserKernel.ts` into `validation.ts` (no Electron deps)
2. Extract keyboard shortcut modifier/key parsing into a pure `parseKeyboardShortcut` function in `validation.ts`
3. Update imports in `ElectronBrowserKernel.ts`
4. Re-export from `index.ts`
5. Run typecheck + build
6. Write comprehensive tests for both functions
7. Run tests
8. Commit

#### Implementation

**Extracted into `packages/browser-runtime/src/validation.ts`:**
- `classifyFailure(message: string): BrowserActionFailureClass` — maps error messages to failure class enum. Checks in priority order: element_not_found > navigation_timeout > validation_error > network_error > interaction_failed (default).
- `parseKeyboardShortcut(shortcut: string): ParsedKeyboardShortcut` — parses shortcut strings like "Ctrl+Shift+Enter" into CDP-compatible `{ modifiers, key }`. Supports all modifier keys (Ctrl, Shift, Alt, Meta, Cmd) and named keys (Enter→Return, Space→" ", arrow keys, etc.).
- Added `ParsedKeyboardShortcut` interface export.
- Added `import type { BrowserActionFailureClass }` from contracts.

**Updated `ElectronBrowserKernel.ts`:**
- Removed inline `classifyFailure` function (was lines 42–51)
- Removed inline `MODIFIER_BITS`, `KEY_NAMES` constants and parsing logic from `dispatchKeyboardShortcut`
- Now imports `classifyFailure` and `parseKeyboardShortcut` from `./validation.js`
- Removed unused `BrowserActionFailureClass` import from contracts
- `dispatchKeyboardShortcut` reduced from 20 lines to 4 lines

**Tests added to `tests/validation.test.mjs` — +32 tests:**
- `classifyFailure` (17 tests): all 5 failure classes, all network error patterns, priority when multiple keywords match, empty string, unknown error
- `parseKeyboardShortcut` (15 tests): single key, each modifier, combined modifiers, named key resolution (Enter, Space, arrow keys, Delete, Tab, Backspace, Escape), Cmd→Meta mapping, whitespace handling, unknown key passthrough

#### Verification

- `pnpm --filter @openbrowse/browser-runtime build` — ✓ clean
- `pnpm --filter @openbrowse/desktop typecheck` — ✓ clean
- `node --test tests/validation.test.mjs` — 58/58 pass (was 26, +32 new)
- `node --test tests/*.test.mjs` — 824/824 pass (was 792, +32 new)

#### Status: DONE

#### Next Steps

- All pure-logic modules across all packages now have test coverage (824 tests, 0 failures)
- Remaining untested code requires Electron context (CdpClient, ElectronBrowserKernel session management, SQLite stores)
- P3-10 (profile system) remains deferred
- Consider integration testing under Electron test harness

*Session log entry written: 2026-03-16 (Session 53)*

---

### Session 54 — 2026-03-16: Extract parseApprovalAnswer from OpenBrowseRuntime + Test Suite

#### Context

Gap analysis: all P0–P2 backlog items done. P3 deferred. All pure-logic modules tested (824 tests). `OpenBrowseRuntime.ts` contains `parseApprovalAnswer(answer: string): boolean | null` — a pure function that maps user text to approve/deny/unknown. It's used in the approval flow (`resumeTaskFromMessage` and `resumeTaskFromMessageDetached`) but is a private module-scoped function, untestable in isolation. Same extraction pattern as Sessions 36–37, 53.

#### Plan

1. Extract `parseApprovalAnswer` from `OpenBrowseRuntime.ts` into a new `approvalParsing.ts` file (no Electron deps)
2. Export from `index.ts`
3. Update `OpenBrowseRuntime.ts` to import from `./approvalParsing.js`
4. Run typecheck + build
5. Write comprehensive test suite for `parseApprovalAnswer`
6. Run tests
7. Commit

#### Implementation

**Extracted `packages/runtime-core/src/approvalParsing.ts`:**
- Moved `parseApprovalAnswer(answer: string): boolean | null` out of `OpenBrowseRuntime.ts`
- Pure function, no dependencies — maps user free-text to approve (true), deny (false), or ambiguous (null)
- Used in the approval flow by `resumeTaskFromMessage` and `resumeTaskFromMessageDetached`

**Updated `OpenBrowseRuntime.ts`:**
- Removed inline `parseApprovalAnswer` function (lines 150–155)
- Added `import { parseApprovalAnswer } from "./approvalParsing.js"`

**Updated `index.ts`:**
- Added `export * from "./approvalParsing.js"` to preserve public API

**Created `tests/approvalParsing.test.mjs` — 25 tests:**
- Affirmative answers (7 tests): approve, approved, yes, y, ok, allow, go → true
- Negative answers (7 tests): deny, denied, no, n, block, cancel, stop → false
- Ambiguous/unrecognized (4 tests): empty string, random text, partial match, full sentence → null
- Case insensitivity (4 tests): APPROVE, Yes, DENY, No
- Whitespace handling (3 tests): trimmed approve, trimmed deny, whitespace-only → null

#### Verification

- `pnpm --filter @openbrowse/runtime-core build` — ✓ clean
- `pnpm --filter @openbrowse/desktop typecheck` — ✓ clean
- `node --test tests/approvalParsing.test.mjs` — 25/25 pass
- `node --test tests/*.test.mjs` — 849/849 pass (was 824, +25 new)

#### Status: DONE

#### Next Steps

- All pure-logic modules across all packages now have test coverage (849 tests, 0 failures)
- Remaining untested code requires Electron context (CdpClient, ElectronBrowserKernel session management, SQLite stores)
- P3-10 (profile system) remains deferred
- Consider integration testing under Electron test harness

*Session log entry written: 2026-03-16 (Session 54)*

---

### Session 55 — 2026-03-16: Code Review — Refactor Approval-Handling Duplication + Fix Stale Comment

#### Context

Gap analysis: all P0–P2 backlog items done. P3 deferred. All pure-logic modules tested (849 tests). Code review found:

1. **Stale comment** in `contracts/src/tasks.ts` line 99: says "Max 15" for `actionHistory` but `RunExecutor.ts` retains 25 entries (`.slice(-25)`). The cycle detection window is 20, so 25 is correct — the comment is just stale.

2. **Code duplication** in `OpenBrowseRuntime.ts`: `resumeTaskFromMessage` (lines 207–274) and `resumeTaskFromMessageDetached` (lines 276–344) share ~80% identical approval-handling logic (parse answer, handle null, handle denial with deny-continue vs cancel, handle approval, handle clarification). The only differences are how resume and terminal callbacks work.

#### Plan

1. Fix stale "Max 15" comment → "Max 25"
2. Extract shared approval-handling into `private async handleSuspensionMessage()` with resume/terminal callbacks
3. Simplify both public methods to delegate to the shared helper
4. Run typecheck + tests
5. Update log and commit

#### Implementation

**Fix 1 — `packages/contracts/src/tasks.ts`:**
- Line 99: Fixed stale comment "Max 15" → "Max 25" to match `RunExecutor.ts` line 255 (`.slice(-25)`)

**Fix 2 — `packages/runtime-core/src/OpenBrowseRuntime.ts`:**
- Extracted `private async handleSuspensionMessage(message, doResume, onTerminal)` — contains the shared approval-handling logic previously duplicated across `resumeTaskFromMessage` and `resumeTaskFromMessageDetached`
- `resumeTaskFromMessage` now delegates to `handleSuspensionMessage` with `doResume → this.resumeExecution` and `onTerminal → no-op`
- `resumeTaskFromMessageDetached` delegates with `doResume → this.detachedResume(run, onSettled, action)` and `onTerminal → onSettled?.(run)`
- Net removal of ~65 duplicated lines. All behavior preserved — same approval parsing, denial outcome handling, clarification resume, workflow event logging, and handoff writes.

#### Verification

- `pnpm run typecheck` — ✓ clean
- `node --test tests/*.test.mjs` — 849/849 pass (unchanged)

#### Status: DONE

#### Next Steps

- All pure-logic modules across all packages now have test coverage (849 tests, 0 failures)
- Remaining untested code requires Electron context (CdpClient, ElectronBrowserKernel session management, SQLite stores)
- P3-10 (profile system) remains deferred
- Consider integration testing under Electron test harness

*Session log entry written: 2026-03-16 (Session 55)*

---

### Session 56 — 2026-03-16: Extract Bot Command Handlers into Testable Module + Test Suite

#### Context

Gap analysis: all P0–P2 backlog items done. P3 deferred. All pure-logic modules tested (849 tests). `wireBotCommands` in `OpenBrowseRuntime.ts` contains ~100 lines of command routing logic for `/status`, `/list`, `/cancel`, `/handoff` — 4 commands with multiple code paths each. This logic is pure (services bag + command + args → response text) but untestable because it's embedded in a function gated by `instanceof TelegramChatBridge`. Same extraction pattern as Sessions 36–54.

#### Plan

1. Extract `handleBotCommand(services, command, args)` into `botCommands.ts` (no TelegramChatBridge dependency)
2. Update `wireBotCommands` in `OpenBrowseRuntime.ts` to delegate to the new function
3. Export from `index.ts`
4. Run typecheck + build
5. Write comprehensive test suite covering all 4 commands + edge cases
6. Run tests
7. Commit

#### Implementation

**Created `packages/runtime-core/src/botCommands.ts`:**
- Extracted `handleBotCommand(services, command, args, cancelRunFn?)` pure function
- Returns `BotCommandResult` with `responses: string[]` — no TelegramChatBridge dependency
- `cancelRunFn` is injectable (same DI pattern as RecoveryManager, compose.ts)
- Handles all 4 commands: `/status`, `/list`, `/cancel`, `/handoff`

**Updated `OpenBrowseRuntime.ts`:**
- `wireBotCommands` now delegates to `handleBotCommand` (5 lines vs 100+)
- Removed unused `buildHandoffArtifact`/`renderHandoffMarkdown` imports (moved to `botCommands.ts`)
- Added `import { handleBotCommand } from "./botCommands.js"`

**Updated `index.ts`:**
- Added `export * from "./botCommands.js"` to public API

**Created `tests/botCommands.test.mjs` — 28 tests:**
- `/status` (6 tests): no active runs, running runs with emoji/id/goal, suspended runs, step count + URL, URL omitted, filters terminal statuses
- `/list` (8 tests): empty, default 5, custom count, cap at 20, status emojis (✓✗⊘⏳), unknown status ?, sorted by updatedAt desc, invalid args default
- `/cancel` (7 tests): no cancelFn available, no running tasks, auto-picks most recent, cancel returns null, specific id, id not found, goal truncation at 60
- `/handoff` (5 tests): specific runId, auto-picks most recent terminal, not found, no terminal runs, long markdown chunking at 4000
- Cross-cutting (2 tests): unknown command error, responses always array

#### Verification

- `pnpm --filter @openbrowse/runtime-core build` — ✓ clean
- `pnpm --filter @openbrowse/desktop typecheck` — ✓ clean
- `node --test tests/botCommands.test.mjs` — 28/28 pass
- `node --test tests/*.test.mjs` — 877/877 pass (was 849, +28 new)

#### Status: DONE

#### Next Steps

- All pure-logic modules across all packages now have test coverage (877 tests, 0 failures)
- Remaining untested code requires Electron context (CdpClient, ElectronBrowserKernel session management, SQLite stores)
- P3-10 (profile system) remains deferred
- Consider testing `handleInboundMessage`/`handleNewTaskMessage` module-level orchestration (needs service mocking with OpenBrowseRuntime constructor)

*Session log entry written: 2026-03-16 (Session 56)*

---

### Session 57 — 2026-03-16: Fix scrollY Drop Bug + Stale Forms Type in capturePageModel

#### Context

Code review / gap analysis found two issues in `ElectronBrowserKernel.capturePageModel`:

1. **Bug**: `scrollY` is extracted by `EXTRACT_PAGE_MODEL_SCRIPT` and defined in the `PageModel` contract, but not mapped in `capturePageModel`'s return statement. This means `scrollY` is always `undefined` in production — scroll position context is never sent to the planner (no scroll section in prompt) and never preserved in recovery snapshots.

2. **Stale type annotation**: The raw result type for `forms` is typed as `Array<{ action: string; method: string; fieldCount: number }>` but the script also returns `fields` and `submitRef`. These properties flow through at runtime due to JS's structural nature, but the type is misleading and incomplete.

#### Plan

1. Add `scrollY: raw.scrollY` to `capturePageModel` return in `ElectronBrowserKernel.ts`
2. Add `scrollY` to the raw type annotation
3. Add `fields` and `submitRef` to the raw forms type annotation
4. Run typecheck
5. Run tests
6. Update this log and commit

#### Implementation

**Fixed `packages/browser-runtime/src/ElectronBrowserKernel.ts`:**
- Added `scrollY: raw.scrollY` to `capturePageModel` return object — **fixes the scroll position drop bug**
- Added `scrollY?: number` to the raw result type annotation
- Added `fields` and `submitRef` to the raw `forms` type annotation to match what the script actually returns
- No behavioral change for forms (data was already flowing through at runtime, just typed incorrectly)

**Impact of the scrollY fix:**
- `buildPlannerPrompt` scroll section will now render `Scroll position: Y=...px` instead of being always absent
- `TaskOrchestrator.observePage` snapshots will now include `scrollY` for recovery context
- `RunExecutor.continueResume` recovery context will now include `preInterruptionScrollY`

#### Verification

- `pnpm run typecheck` — ✓ clean
- `node --test tests/*.test.mjs` — 877/877 pass (unchanged)

#### Status: DONE

#### Next Steps

- All pure-logic modules across all packages have test coverage (877 tests, 0 failures)
- Remaining untested code requires Electron context
- P3-10 (profile system) remains deferred

*Session log entry written: 2026-03-16 (Session 57)*

---

### Session 58 — 2026-03-16: Consolidate MAX_STEPS Constant + Surface totalSoftFailures in Planner Prompt

#### Context

Code review found two issues in the planner loop safety surface:

1. **Duplicated constant**: `MAX_LOOP_STEPS = 35` in `RunExecutor.ts` and `MAX_STEPS = 35` in `buildPlannerPrompt.ts`. If one changes without the other, the step budget shown to Claude will diverge from the actual loop limit.

2. **Invisible hard limit**: `RunExecutor.ts` terminates runs at `MAX_TOTAL_SOFT_FAILURES = 8` total soft failures across the entire run. But `buildPlannerPrompt` only shows `consecutiveSoftFailures` — the planner has NO visibility into the running total approaching the kill limit. This can cause unexpected hard termination without the planner having a chance to adjust strategy.

#### Plan

1. Export `MAX_PLANNER_STEPS = 35` from `buildPlannerPrompt.ts`, import in `RunExecutor.ts` (single source of truth)
2. Add `totalSoftFailures` warning section to the planner prompt when count >= 5 (of 8 max)
3. Add tests for both changes
4. Run typecheck + tests
5. Update this log and commit

#### Implementation

**Fix 1 — Consolidated `MAX_STEPS` constant:**
- Exported `MAX_PLANNER_STEPS = 35` from `packages/planner/src/buildPlannerPrompt.ts` (was private `MAX_STEPS`)
- Updated `packages/runtime-core/src/RunExecutor.ts`: removed local `MAX_LOOP_STEPS = 35`, imported `MAX_PLANNER_STEPS` from `@openbrowse/planner`
- Single source of truth: if the step budget changes, both the planner prompt and the execution loop update together

**Fix 2 — `totalSoftFailures` prompt visibility:**
- Added `totalSoftWarning` section to `buildPlannerPrompt`: when `totalSoftFailures >= 5`, shows `CRITICAL: N total soft failures across this run (limit: 8)` with advice to switch strategy
- Placed after the existing `softFailureWarning` (consecutive) — gives the planner 3 remaining "strikes" before hard termination
- Previously, the planner had no visibility into the running total — runs could be killed without the planner having a chance to adjust

**Tests added to `tests/planner-prompt.test.mjs` — 6 new tests:**
- `MAX_PLANNER_STEPS is exported and equals 35` — verifies export value and type
- `system prompt uses MAX_PLANNER_STEPS for step budget` — verifies step budget string
- `totalSoftWarning appears when totalSoftFailures >= 5` — verifies CRITICAL + limit: 8
- `totalSoftWarning appears at 7 total soft failures` — verifies at higher count
- `totalSoftWarning absent when totalSoftFailures < 5` — verifies no warning at 4
- `totalSoftWarning absent when totalSoftFailures undefined` — verifies no warning at default

#### Verification

- `pnpm --filter @openbrowse/planner build` — ✓ clean
- `pnpm --filter @openbrowse/runtime-core build` — ✓ clean
- `pnpm run typecheck` — ✓ clean
- `node --test tests/planner-prompt.test.mjs` — 50/50 pass (was 44, +6 new)
- `node --test tests/runExecutor.test.mjs` — 28/28 pass (unchanged)
- `node --test tests/*.test.mjs` — 883/883 pass (was 877, +6 new)

#### Status: DONE

#### Next Steps

- All pure-logic modules across all packages have test coverage (883 tests, 0 failures)
- Remaining untested code requires Electron context
- P3-10 (profile system) remains deferred
- Consider surfacing `focusedElementId` from PageModel in the planner prompt (captured but unused)

*Session log entry written: 2026-03-16 (Session 58)*

---

### Session 59 — 2026-03-16: Surface focusedElementId in Planner Prompt + Tests

#### Context

Gap analysis (Session 58): `focusedElementId` is captured by the CDP extraction script, stored in `PageModel`, mapped through `ElectronBrowserKernel.capturePageModel`, but never surfaced in the planner prompt. This means the planner has no visibility into which element currently has keyboard focus — important context for deciding whether to type, press Enter, or click a different field.

#### Plan

1. Add `focusedElementId` context line to `buildPlannerPrompt` in the user prompt section (near scroll position)
2. Add tests for presence/absence of focused element context
3. Run typecheck + tests
4. Update this log and commit

#### Implementation

**Modified `packages/planner/src/buildPlannerPrompt.ts`:**
- Added `focusedSection` — renders `Focused element: [el_X] — this element currently has keyboard focus` when `pageModel.focusedElementId` is truthy
- Placed after scroll position, before CAPTCHA hint in the user prompt

**Impact:** The planner now knows which element has keyboard focus. This helps with:
- Deciding whether to type (if the right field is already focused, no need to click first)
- Understanding form state (which input the user was interacting with)
- Pressing Enter after focus is on a submit button

**Added 3 tests to `tests/planner-prompt.test.mjs`:**
- `focusedSection shows focused element` — verifies `[el_7]` and "keyboard focus" in output
- `focusedSection absent when no focused element` — verifies no "Focused element:" when undefined
- `focusedSection absent when focusedElementId is empty string` — verifies falsy empty string handled

#### Files Changed

| File | Change |
|---|---|
| `packages/planner/src/buildPlannerPrompt.ts` | Added `focusedSection` variable + inserted into user prompt |
| `tests/planner-prompt.test.mjs` | +3 tests for focusedSection presence/absence |

#### Verification

- `pnpm --filter @openbrowse/planner build` — ✓ clean
- `pnpm run typecheck` — ✓ clean
- `node --test tests/planner-prompt.test.mjs` — 53/53 pass (was 50, +3 new)
- `node --test tests/*.test.mjs` — 886/886 pass (was 883, +3 new)

#### Status: DONE

#### Next Steps

- All pure-logic modules across all packages have test coverage (886 tests, 0 failures)
- Remaining untested code requires Electron context
- P3-10 (profile system) remains deferred
- Consider adding `ariaSelected`/`ariaChecked`/`ariaExpanded` state to element rendering in prompt (captured by CDP but not surfaced)

*Session log entry written: 2026-03-16 (Session 59)*

---

### Session 60 — 2026-03-16: Surface ARIA State Attributes in Page Model + Planner Prompt

#### Context

Gap analysis (Session 59): suggested surfacing `ariaSelected`/`ariaChecked`/`ariaExpanded` state in planner prompt. Investigation reveals these are NOT captured by the CDP extraction script at all — the planner has no visibility into checkbox/radio checked state, dropdown expanded state, or tab selected state. This limits the planner's ability to understand and interact with toggleable elements.

#### Plan

1. Add `checked`, `selected`, `expanded` to CDP element extraction in `extractPageModel.ts`
2. Add corresponding optional fields to `PageElementModel` contract in `contracts/browser.ts`
3. Surface in `buildPlannerPrompt.ts` element rendering (e.g., "(checked)", "(selected)", "(expanded)")
4. Add tests for presence/absence of state annotations
5. Run typecheck + tests
6. Update this log and commit

#### Implementation

**Modified `packages/contracts/src/browser.ts`:**
- Added `checked?: boolean`, `selected?: boolean`, `expanded?: boolean` optional fields to `PageElementModel`
- These represent ARIA interactive state: checkbox/radio checked state, tab/option selected state, accordion/dropdown expanded state

**Modified `packages/browser-runtime/src/cdp/extractPageModel.ts`:**
- `checked`: Captures `el.checked` for checkbox/radio inputs, falls back to `aria-checked="true"` for custom components
- `selected`: Captures `aria-selected="true"` for tabs, list items, tree items
- `expanded`: Captures `aria-expanded` — `true` for expanded, `false` for collapsed, `undefined` when absent

**Modified `packages/planner/src/buildPlannerPrompt.ts`:**
- Element rendering now shows `(checked)`, `(selected)`, `(expanded)`, `(collapsed)` state annotations
- Placed before `(disabled)` and `(readonly)` for natural reading order

**Impact:** The planner now knows:
- Whether a checkbox/radio is checked or unchecked (no need to guess from page text)
- Which tab is currently selected (avoid clicking an already-active tab)
- Whether a dropdown/accordion is open or closed (decide whether to expand or collapse)

**Added 8 tests to `tests/planner-prompt.test.mjs`:**
- checked present/absent, selected present/absent, expanded/collapsed/absent, multiple states together

#### Verification

- `pnpm run typecheck` — ✓ clean
- `pnpm --filter @openbrowse/planner build` — ✓ clean
- `node --test tests/planner-prompt.test.mjs` — 61/61 pass (was 53, +8 new)
- `node --test tests/*.test.mjs` — 894/894 pass (was 886, +8 new)

#### Status: DONE

#### Next Steps

- All pure-logic modules across all packages have test coverage (894 tests, 0 failures)
- Remaining untested code requires Electron context
- P3-10 (profile system) remains deferred
- Consider surfacing `aria-label` override in element rendering when it differs from visible text

*Session log entry written: 2026-03-16 (Session 60)*

---

### Session 61 — 2026-03-16: Surface Select Option Values in Page Model + Planner Prompt

#### Context

Gap analysis: `<select>` elements appear in the page model as role "combobox" with their current `value`, but the **available options** are not captured. The `browser_select` tool expects an option `value` parameter, but the planner has no visibility into what options exist. This forces the planner to guess, leading to validation errors or incorrect selections.

#### Plan

1. Add `options?: Array<{ value: string; label: string }>` to `PageElementModel` in `contracts/browser.ts`
2. Capture `<option>` elements for `<select>` in `extractPageModel.ts` (cap at 20 options per select)
3. Surface options in `buildPlannerPrompt.ts` element rendering
4. Add tests for options rendering in `planner-prompt.test.mjs`
5. Run typecheck + tests
6. Update this log and commit

#### Implementation

**Modified `packages/contracts/src/browser.ts`:**
- Added `options?: Array<{ value: string; label: string }>` to `PageElementModel`
- Only populated for `<select>` elements — dropdown option values the planner needs for `browser_select`

**Modified `packages/browser-runtime/src/cdp/extractPageModel.ts`:**
- For `<select>` elements, captures up to 20 non-disabled `<option>` children
- Each option: `{ value, label }` (label capped at 60 chars)
- Returns `undefined` when no options exist (keeps payload clean for non-select elements)

**Modified `packages/planner/src/buildPlannerPrompt.ts`:**
- Element rendering now shows `options=["val" (Label), ...]` for elements with options
- Omits label parenthetical when label equals value (avoids redundancy like `"Small" (Small)`)
- This gives the planner the exact values to pass to `browser_select`

**Impact:** The planner can now use `browser_select` accurately by seeing available option values in the prompt, instead of guessing.

**Added 4 tests to `tests/planner-prompt.test.mjs`:**
- Options rendered with value+label parenthetical
- Label parenthetical omitted when label equals value
- Options absent when undefined
- Options absent when empty array

#### Verification

- `pnpm run typecheck` — ✓ clean
- `pnpm --filter @openbrowse/planner build` — ✓ clean
- `node --test tests/planner-prompt.test.mjs` — 65/65 pass (was 61, +4 new)
- `node --test tests/*.test.mjs` — 898/898 pass (was 894, +4 new)

#### Status: DONE

#### Next Steps

- All pure-logic modules across all packages have test coverage (898 tests, 0 failures)
- Remaining untested code requires Electron context
- P3-10 (profile system) remains deferred
- Consider similar option extraction for `<datalist>` elements (HTML5 autocomplete suggestions)

*Session log entry written: 2026-03-16 (Session 61)*

---

### Session 62 — 2026-03-16: Surface datalist Autocomplete Suggestions in Page Model + Planner Prompt

#### Context

Gap analysis (Session 61): suggested extracting `<datalist>` autocomplete suggestions. `<input>` elements with a `list` attribute link to a `<datalist>` element that provides autocomplete suggestions. Currently these suggestions are invisible to the planner — it can't see what options are available for autocomplete inputs (e.g., city selectors, search suggestion boxes). Same pattern as `<select>` options from Session 61.

#### Plan

1. Extend CDP extraction in `extractPageModel.ts` to capture `<datalist>` options for `<input list="...">` elements (cap at 20, reuse `options` field)
2. No contract changes needed — `options` field already exists on `PageElementModel`
3. No planner prompt changes needed — `options` rendering already handles the field
4. Add tests for datalist options in `planner-prompt.test.mjs` (rendering already works, just verify)
5. Run typecheck + tests
6. Update this log and commit

#### Implementation

**Modified `packages/browser-runtime/src/cdp/extractPageModel.ts`:**
- Extended `options` extraction to handle `<input>` elements with `list` attribute linking to a `<datalist>`
- Uses `document.getElementById(el.getAttribute('list'))` to resolve the datalist, verifies it's a `DATALIST` element
- Reuses the same option extraction logic as `<select>`: cap at 20, skip disabled, capture `value` and `label`
- Merged extraction into a single IIFE that handles both `SELECT` and `INPUT[list]` cases

**Impact:** The planner can now see autocomplete suggestions for `<input>` fields with `<datalist>` (e.g., city selectors, search suggestion boxes). These appear in the prompt as `options=["val" (Label), ...]` — the same rendering as `<select>` options.

**Added 2 tests to `tests/planner-prompt.test.mjs`:**
- datalist options rendered same as select options (value+label format)
- datalist options omit label when same as value (deduplication)

#### Verification

- `pnpm run typecheck` — ✓ clean
- `node --test tests/planner-prompt.test.mjs` — 67/67 pass (was 65, +2 new)
- `node --test tests/*.test.mjs` — 900/900 pass (was 898, +2 new)

#### Status: DONE

#### Next Steps

- All pure-logic modules across all packages have test coverage (900 tests, 0 failures)
- Remaining untested code requires Electron context
- P3-10 (profile system) remains deferred
- Consider surfacing `aria-description` or `aria-errormessage` for form validation feedback

*Session log entry written: 2026-03-16 (Session 62)*

---

### Session 63 — 2026-03-16: Surface Form Validation State in Page Model + Planner Prompt

#### Context

Gap analysis (Session 62): suggested surfacing `aria-errormessage` / form validation feedback. Currently, when a form submission fails validation, the planner cannot see which fields are invalid or why. The `alerts` extraction catches some page-level errors, but field-level validation (HTML5 `validationMessage`, `aria-invalid`) is invisible. This causes the planner to re-submit forms without fixing the actual validation error.

#### Plan

1. Add `invalid?: boolean` to `PageElementModel` in `contracts/browser.ts`
2. Capture `aria-invalid="true"` or `el.validity?.valid === false` in `extractPageModel.ts`
3. Add `validationMessage?: string` to `PageFormField` in `contracts/browser.ts`
4. Capture `el.validationMessage` in `extractForms()` in `extractPageModel.ts`
5. Surface `(invalid)` annotation in `buildPlannerPrompt.ts` element rendering
6. Surface `validationMessage` in `buildPlannerPrompt.ts` forms section
7. Add tests to `planner-prompt.test.mjs`
8. Run typecheck + tests
9. Update this log and commit

#### Implementation

**Modified `packages/contracts/src/browser.ts`:**
- Added `invalid?: boolean` to `PageElementModel` — captures form validation / `aria-invalid` state
- Added `validationMessage?: string` to `PageFormField` — captures HTML5 constraint validation messages

**Modified `packages/browser-runtime/src/cdp/extractPageModel.ts`:**
- Element enumeration: captures `invalid` from `aria-invalid="true"` or `el.validity.valid === false` (with non-empty `validationMessage`)
- Form fields: captures `el.validationMessage` (capped at 120 chars), only when non-empty

**Modified `packages/planner/src/buildPlannerPrompt.ts`:**
- Element rendering: shows `(invalid)` annotation between `(collapsed)` and `(disabled)` for natural reading order
- Form fields: shows `INVALID: "message"` after current value, making validation errors immediately visible

**Impact:** The planner can now:
- See which form fields have validation errors (red-outlined fields in the browser)
- Read the exact validation message (e.g., "Please enter a valid email address")
- Fix the specific field instead of re-submitting the entire form blindly

**Added 5 tests to `tests/planner-prompt.test.mjs`:**
- invalid element shows (invalid) annotation
- non-invalid element omits (invalid) annotation
- invalid annotation appears before disabled (ordering)
- form field shows validation message
- form field omits validation message when absent

#### Verification

- `pnpm run typecheck` — ✓ clean
- `pnpm --filter @openbrowse/planner build` — ✓ clean
- `node --test tests/planner-prompt.test.mjs` — 72/72 pass (was 67, +5 new)
- `node --test tests/*.test.mjs` — 905/905 pass (was 900, +5 new)

#### Status: DONE

#### Next Steps

- All pure-logic modules across all packages have test coverage (905 tests, 0 failures)
- Remaining untested code requires Electron context
- P3-10 (profile system) remains deferred
- Consider surfacing `aria-label` override when it differs from visible text (Session 60 suggestion)

*Session log entry written: 2026-03-16 (Session 63)*

---

### Session 64 — 2026-03-16: Surface Element Visible Text When It Differs From aria-label

#### Context

Gap analysis (Session 60/63 suggestion): `getLabel()` in `extractPageModel.ts` uses `aria-label` as its first priority. When `aria-label` is set, the element's visible `innerText` is lost. For icon buttons (e.g., aria-label="Close" but showing "✕"), search toggles (aria-label="Search" but showing a magnifying glass icon text), or styled buttons where aria-label differs from display text, the planner only sees the programmatic label and cannot correlate with what's visually on the page.

#### Plan

1. Add `text?: string` to `PageElementModel` in `contracts/browser.ts`
2. In `extractPageModel.ts`, capture `el.innerText` (trimmed, capped at 40 chars) and include as `text` only when it differs from `label` and is non-empty
3. Surface `text="..."` in `buildPlannerPrompt.ts` element rendering
4. Add tests to `planner-prompt.test.mjs`
5. Run typecheck + tests
6. Update this log and commit

#### Implementation

**Modified `packages/contracts/src/browser.ts`:**
- Added `text?: string` optional field to `PageElementModel`
- Captures the element's visible `innerText` when it differs from the resolved `label` (which may come from `aria-label`, `aria-labelledby`, `<label>`, title, or placeholder)

**Modified `packages/browser-runtime/src/cdp/extractPageModel.ts`:**
- After resolving `label` via `getLabel()`, captures `el.innerText` (trimmed, capped at 40 chars)
- Sets `text` field only when `innerText` is non-empty AND differs from `label`
- Zero overhead for elements where label matches visible text (field is `undefined`)

**Modified `packages/planner/src/buildPlannerPrompt.ts`:**
- Element rendering now shows `text="..."` after label, before href
- Example: `[el_5] button "Close" text="✕" *` — planner sees both the programmatic label and what's visually displayed

**Impact:** The planner can now distinguish between:
- An icon button with `aria-label="Close"` showing "✕"
- A styled button with `aria-label="Search"` showing a different visual text
- Any element where the accessibility label differs from visible content
This helps the planner correlate what it "sees" in the prompt with what a user would see on screen.

**Added 3 tests to `tests/planner-prompt.test.mjs`:**
- text rendered when different from label
- text absent when undefined
- text absent when same as label (undefined check)

#### Verification

- `pnpm run typecheck` — ✓ clean
- `pnpm --filter @openbrowse/planner build` — ✓ clean
- `node --test tests/planner-prompt.test.mjs` — 75/75 pass (was 72, +3 new)
- `node --test tests/*.test.mjs` — 908/908 pass (was 905, +3 new)

#### Status: DONE

#### Next Steps

- All pure-logic modules across all packages have test coverage (908 tests, 0 failures)
- Remaining untested code requires Electron context
- P3-10 (profile system) remains deferred
- Consider surfacing `aria-description` for elements that have additional descriptive context

*Session log entry written: 2026-03-16 (Session 64)*

---

### Session 65 — 2026-03-16: Surface Active Dialog/Modal Detection in Page Model + Planner Prompt

#### Context

Gap analysis: when a modal dialog is open (cookie consent banners, confirmation dialogs, login modals, popups), background elements are typically blocked by the dialog overlay. The planner currently has no way to know a dialog is present — it may try to click background elements that are unreachable. The `alerts` extraction catches `[role=alertdialog]` text, but doesn't indicate that a dialog is *blocking* the page.

#### Plan

1. Add `activeDialog?: { label: string }` to `PageModel` in `contracts/browser.ts`
2. In `extractPageModel.ts`, detect open `<dialog[open]>` or visible `[role="dialog"]`/`[role="alertdialog"]` elements
3. In `buildPlannerPrompt.ts`, surface dialog notice prominently so the planner prioritizes dialog elements
4. Add tests to `planner-prompt.test.mjs`
5. Run typecheck + tests
6. Update this log and commit

#### Implementation

**Modified `packages/contracts/src/browser.ts`:**
- Added `activeDialog?: { label: string }` to `PageModel`
- Captures the accessible label of the currently open modal dialog

**Modified `packages/browser-runtime/src/cdp/extractPageModel.ts`:**
- Added `detectActiveDialog()` function
- Detects native `<dialog open>` elements first, then visible `[role="dialog"]`/`[role="alertdialog"]`
- Resolves label from `aria-label`, `aria-labelledby`, or first heading inside the dialog
- Falls back to "Dialog" when no label is available

**Modified `packages/planner/src/buildPlannerPrompt.ts`:**
- Added `dialogHint` section: `** DIALOG OPEN: "Label" — A modal dialog is covering the page...`
- Placed between CAPTCHA hint and alerts section for prominence
- Instructs the planner to interact with dialog elements first (accept, dismiss, fill) before background elements

**Impact:** The planner now knows when a modal dialog is blocking the page and will prioritize interacting with the dialog instead of trying to click unreachable background elements. Common scenarios: cookie consent banners, confirmation dialogs, login modals, popups.

**Added 3 tests to `tests/planner-prompt.test.mjs`:**
- active dialog hint shown when activeDialog present
- active dialog hint absent when no activeDialog
- active dialog hint absent when activeDialog is undefined

#### Verification

- `pnpm run typecheck` — ✓ clean
- `pnpm --filter @openbrowse/planner build` — ✓ clean
- `node --test tests/planner-prompt.test.mjs` — 78/78 pass (was 75, +3 new)
- `node --test tests/*.test.mjs` — 911/911 pass (was 908, +3 new)

#### Status: DONE

#### Next Steps

- All pure-logic modules across all packages have test coverage (911 tests, 0 failures)
- Remaining untested code requires Electron context
- P3-10 (profile system) remains deferred
- Consider surfacing `aria-description` for elements that have additional descriptive context
- Consider table structure extraction for data-heavy pages

*Session log entry written: 2026-03-16 (Session 65)*

---

### Session 66 — 2026-03-16: Surface aria-description in Page Model and Planner Prompt

#### Context

Gap analysis (Session 65 suggestion): elements can have `aria-description` or `aria-describedby` attributes that provide additional context beyond the label. For example, a "Delete" button might have `aria-description="Permanently removes the selected items"`, or a form field might have a linked description like "Password must be at least 8 characters". The planner currently has no way to see this supplementary context, which could help it make better decisions about which elements to interact with and how.

#### Plan

1. Add `description?: string` to `PageElementModel` in `contracts/browser.ts`
2. In `extractPageModel.ts`, capture `aria-description` attribute or resolve `aria-describedby` reference text (trimmed, capped at 80 chars)
3. Surface `desc="..."` in `buildPlannerPrompt.ts` element rendering
4. Add tests to `planner-prompt.test.mjs`
5. Run typecheck + tests
6. Update this log and commit

#### Implementation

**Modified `packages/contracts/src/browser.ts`:**
- Added `description?: string` optional field to `PageElementModel`
- Captures the element's `aria-description` or resolved `aria-describedby` text

**Modified `packages/browser-runtime/src/cdp/extractPageModel.ts`:**
- After resolving `label` and `text`, captures `aria-description` attribute directly
- Falls back to resolving `aria-describedby` (space-separated IDs → referenced element text content)
- Capped at 80 chars, only set when non-empty
- Zero overhead for elements without description attributes (field is `undefined`)

**Modified `packages/planner/src/buildPlannerPrompt.ts`:**
- Element rendering now shows `desc="..."` after text, before href
- Example: `[el_5] button "Delete" desc="Permanently removes the selected items" *`

**Impact:** The planner can now see supplementary context for elements:
- A "Delete" button with `aria-description="Permanently removes the selected items"`
- A form field with `aria-describedby` linking to helper text like "Password must be at least 8 characters"
- Any element where authors added descriptive context beyond the label
This helps the planner understand element purpose and make better interaction decisions.

**Added 3 tests to `tests/planner-prompt.test.mjs`:**
- description rendered when present
- description absent when undefined
- description rendered after text and before href (ordering)

#### Verification

- `pnpm run typecheck` — ✓ clean
- `pnpm --filter @openbrowse/planner build` — ✓ clean
- `node --test tests/planner-prompt.test.mjs` — 81/81 pass (was 78, +3 new)
- `node --test tests/*.test.mjs` — 914/914 pass (was 911, +3 new)

#### Status: DONE

#### Next Steps

- All pure-logic modules across all packages have test coverage (914 tests, 0 failures)
- Remaining untested code requires Electron context
- P3-10 (profile system) remains deferred
- Consider table structure extraction for data-heavy pages
- Consider surfacing `aria-level` for headings to convey document structure

*Session log entry written: 2026-03-16 (Session 66)*

---

### Session 67 — 2026-03-16: Surface Heading Level in Page Model and Planner Prompt

#### Context

Gap analysis (Session 66 suggestion): headings (h1–h6) and elements with `role="heading"` have an implicit or explicit level that conveys document structure hierarchy. The planner currently sees headings as generic elements — it can't distinguish an h1 page title from an h3 subsection. Surfacing heading level helps the planner understand page structure and make better navigation/extraction decisions.

#### Plan

1. Add `level?: number` to `PageElementModel` in `contracts/browser.ts`
2. In `extractPageModel.ts`, capture heading level from tag name (h1→1, h2→2, etc.) or explicit `aria-level` attribute for `role="heading"` elements
3. Surface `level=N` in `buildPlannerPrompt.ts` element rendering for heading elements
4. Add tests to `planner-prompt.test.mjs`
5. Run typecheck + tests
6. Update this log and commit

#### Implementation

**Modified `packages/contracts/src/browser.ts`:**
- Added `level?: number` optional field to `PageElementModel`
- Captures the heading level (1–6) for h1–h6 elements and role="heading" with aria-level

**Modified `packages/browser-runtime/src/cdp/extractPageModel.ts`:**
- After resolving `description`, detects heading level from tag name (`H1`→1, `H2`→2, etc.)
- Falls back to explicit `aria-level` attribute for elements with `role="heading"`
- Only set for heading elements (field is `undefined` for non-headings)

**Modified `packages/planner/src/buildPlannerPrompt.ts`:**
- Element rendering now shows `level=N` after role/label, before text
- Example: `[el_3] heading "Getting Started" level=2 *`

**Impact:** The planner can now see document structure hierarchy:
- `[el_1] heading "Welcome to OpenBrowse" level=1` — page title
- `[el_5] heading "Features" level=2` — main section
- `[el_9] heading "Browser Automation" level=3` — subsection
This helps the planner understand page structure, prioritize content extraction, and navigate to the right sections.

**Added 3 tests to `tests/planner-prompt.test.mjs`:**
- heading level rendered when present
- heading level absent when undefined
- heading level rendered after role/label and before text (ordering)

#### Verification

- `pnpm run typecheck` — ✓ clean
- `pnpm --filter @openbrowse/planner build` — ✓ clean
- `node --test tests/planner-prompt.test.mjs` — 84/84 pass (was 81, +3 new)
- `node --test tests/*.test.mjs` — 917/917 pass (was 914, +3 new)

#### Status: DONE

#### Next Steps

- All pure-logic modules across all packages have test coverage (917 tests, 0 failures)
- Remaining untested code requires Electron context
- P3-10 (profile system) remains deferred
- Consider table structure extraction for data-heavy pages
- Consider surfacing `aria-current` for navigation elements (active page, step indicators)

*Session log entry written: 2026-03-16 (Session 67)*

---

### Session 68 — 2026-03-16: Surface aria-current in Page Model and Planner Prompt

#### Context

Gap analysis (Session 67 suggestion): `aria-current` is used on navigation elements (nav links, breadcrumb items, step indicators) to mark the currently active item. Values: "page", "step", "location", "date", "time", or "true". The planner currently has no visibility into which nav item is active — it may click a link that's already the current page, or miss the current step in a multi-step flow.

#### Plan

1. Add `current?: string` to `PageElementModel` in `contracts/browser.ts`
2. In `extractPageModel.ts`, capture `aria-current` attribute when truthy
3. Surface `(current)` or `(current=page)` annotation in `buildPlannerPrompt.ts` element rendering
4. Add tests to `planner-prompt.test.mjs`
5. Run typecheck + tests
6. Update this log and commit

#### Implementation

**Modified `packages/contracts/src/browser.ts`:**
- Added `current?: string` optional field to `PageElementModel`
- Captures the `aria-current` attribute value for navigation elements, breadcrumbs, step indicators

**Modified `packages/browser-runtime/src/cdp/extractPageModel.ts`:**
- After resolving heading level, captures `aria-current` attribute
- Filters out `"false"` values (spec says `aria-current="false"` means not current)
- Only set when truthy (field is `undefined` for non-current elements)

**Modified `packages/planner/src/buildPlannerPrompt.ts`:**
- Element rendering now shows `(current=page)`, `(current=step)`, `(current=location)`, etc.
- For `aria-current="true"` (boolean form), shows bare `(current)` without redundant `=true`
- Placed after `level` and before `text` for natural reading order

**Impact:** The planner can now see:
- Which nav link is the current page (`(current=page)`)
- Which step is active in a multi-step flow (`(current=step)`)
- Which breadcrumb is the current location (`(current=location)`)
This prevents the planner from clicking already-active navigation items and helps it understand flow state.

**Added 4 tests to `tests/planner-prompt.test.mjs`:**
- current=page rendered for nav links
- bare (current) rendered when value is "true"
- current absent when undefined
- current=step rendered for step indicators

#### Verification

- `pnpm run typecheck` — ✓ clean
- `pnpm --filter @openbrowse/planner build` — ✓ clean
- `node --test tests/planner-prompt.test.mjs` — 88/88 pass (was 84, +4 new)
- `node --test tests/*.test.mjs` — 921/921 pass (was 917, +4 new)

#### Status: DONE

#### Next Steps

- All pure-logic modules across all packages have test coverage (921 tests, 0 failures)
- Remaining untested code requires Electron context
- P3-10 (profile system) remains deferred
- Consider table structure extraction for data-heavy pages
- Consider surfacing `aria-sort` for sortable table columns

*Session log entry written: 2026-03-16 (Session 68)*

---

### Session 69 — 2026-03-16: Surface aria-sort in Page Model and Planner Prompt

#### Context

Gap analysis (Session 68 suggestion): `aria-sort` is used on table column headers (`<th>` or `[role=columnheader]`) to indicate the current sort direction. Values: "ascending", "descending", "other", "none". Without this, the planner cannot see which column a table is sorted by or in which direction, leading to unnecessary re-sorting or missed sort state.

#### Plan

1. Add `sort?: string` to `PageElementModel` in `contracts/browser.ts`
2. In `extractPageModel.ts`, capture `aria-sort` attribute (skip "none")
3. Surface `(sort=ascending)` etc. annotation in `buildPlannerPrompt.ts` element rendering
4. Add tests to `planner-prompt.test.mjs`
5. Run typecheck + tests
6. Update this log and commit

#### Implementation

**Modified `packages/contracts/src/browser.ts`:**
- Added `sort?: string` optional field to `PageElementModel`
- Captures the `aria-sort` attribute value for sortable table column headers

**Modified `packages/browser-runtime/src/cdp/extractPageModel.ts`:**
- After resolving `aria-current`, captures `aria-sort` attribute
- Filters out `"none"` values (spec says `aria-sort="none"` means no sort applied)
- Only set when truthy (field is `undefined` for unsorted columns)

**Modified `packages/planner/src/buildPlannerPrompt.ts`:**
- Element rendering now shows `(sort=ascending)`, `(sort=descending)`, `(sort=other)`
- Placed after `current` annotation for natural reading order

**Impact:** The planner can now see:
- Which column a table is sorted by and in which direction
- Whether sorting is ascending, descending, or other
This prevents the planner from clicking a column that's already sorted in the desired direction and helps it understand data table state.

**Added 4 tests to `tests/planner-prompt.test.mjs`:**
- sort=ascending rendered for sorted column header
- sort=descending rendered for sorted column header
- sort annotation absent when undefined
- sort=other rendered for non-standard sort

#### Verification

- `pnpm run typecheck` — ✓ clean
- `node --test tests/planner-prompt.test.mjs` — 92/92 pass (was 88, +4 new)
- `node --test tests/*.test.mjs` — 925/925 pass (was 921, +4 new)

#### Status: DONE

#### Next Steps

- All pure-logic modules across all packages have test coverage (925 tests, 0 failures)
- Remaining untested code requires Electron context
- P3-10 (profile system) remains deferred
- Consider table structure extraction for data-heavy pages
- Consider surfacing `aria-roledescription` for custom widget descriptions

*Session log entry written: 2026-03-16 (Session 69)*

---

### Session 70 — 2026-03-16: Surface aria-roledescription in Page Model and Planner Prompt

#### Context

Gap analysis (Session 69 suggestion): `aria-roledescription` overrides the default role text for custom widgets. For example, `<div role="slider" aria-roledescription="temperature control">` should be presented as "temperature control" instead of generic "slider". Without this, the planner sees only the generic ARIA role and may not understand what a custom widget does.

#### Plan

1. Add `roleDescription?: string` to `PageElementModel` in `contracts/browser.ts`
2. In `extractPageModel.ts`, capture `aria-roledescription` attribute (capped at 40 chars)
3. Surface `roleDesc="..."` in `buildPlannerPrompt.ts` element rendering (after role/label)
4. Add tests to `planner-prompt.test.mjs`
5. Run typecheck + tests
6. Update this log and commit

#### Implementation

**Modified `packages/contracts/src/browser.ts`:**
- Added `roleDescription?: string` optional field to `PageElementModel`
- Captures the `aria-roledescription` attribute value for custom widget descriptions

**Modified `packages/browser-runtime/src/cdp/extractPageModel.ts`:**
- After resolving `aria-sort`, captures `aria-roledescription` attribute
- Trimmed, capped at 40 chars, only set when non-empty
- Zero overhead for elements without the attribute (field is `undefined`)

**Modified `packages/planner/src/buildPlannerPrompt.ts`:**
- Element rendering now shows `roleDesc="..."` after sort annotation and before text
- Example: `[el_5] slider "Temperature" roleDesc="temperature control" *`

**Impact:** The planner can now see custom widget descriptions:
- A slider with `aria-roledescription="temperature control"` instead of generic "slider"
- A carousel with `aria-roledescription="image gallery"` instead of generic "group"
- Any custom component where authors provided a human-readable role description
This helps the planner understand what custom widgets do and interact with them more appropriately.

**Added 3 tests to `tests/planner-prompt.test.mjs`:**
- roleDescription rendered when present
- roleDescription absent when undefined
- roleDescription rendered after sort and before text (ordering)

#### Verification

- `pnpm run typecheck` — ✓ clean
- `pnpm --filter @openbrowse/planner build` — ✓ clean
- `node --test tests/planner-prompt.test.mjs` — 95/95 pass (was 92, +3 new)
- `node --test tests/*.test.mjs` — 928/928 pass (was 925, +3 new)

#### Status: DONE

#### Next Steps

- All pure-logic modules across all packages have test coverage (928 tests, 0 failures)
- Remaining untested code requires Electron context
- P3-10 (profile system) remains deferred
- Consider table structure extraction for data-heavy pages
- Consider surfacing `aria-valuemin`/`aria-valuemax`/`aria-valuenow` for range widgets (sliders, progress bars)

*Session log entry written: 2026-03-16 (Session 70)*

---

### Session 71 — 2026-03-16: Surface aria-value* Properties in Page Model and Planner Prompt

#### Context

Gap analysis (Session 70 suggestion): `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, and `aria-valuetext` are used on range widgets (`role=slider`, `role=progressbar`, `role=spinbutton`, `role=scrollbar`, `role=meter`). Without these, the planner cannot see a slider's current position, a progress bar's completion percentage, or a spinbutton's current/min/max values. This leads to blind interactions with range controls.

#### Plan

1. Add `valueNow?: number`, `valueMin?: number`, `valueMax?: number`, `valueText?: string` to `PageElementModel` in `contracts/browser.ts`
2. In `extractPageModel.ts`, capture `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, `aria-valuetext` attributes
3. Surface `range=now/min–max` or `valueText="..."` annotation in `buildPlannerPrompt.ts`
4. Add tests to `planner-prompt.test.mjs`
5. Run typecheck + tests
6. Update this log and commit

#### Implementation

**Modified `packages/contracts/src/browser.ts`:**
- Added `valueNow?: number`, `valueMin?: number`, `valueMax?: number`, `valueText?: string` optional fields to `PageElementModel`
- Captures ARIA range widget properties for sliders, progress bars, spinbuttons, scrollbars, meters

**Modified `packages/browser-runtime/src/cdp/extractPageModel.ts`:**
- After `aria-roledescription`, captures `aria-valuenow`, `aria-valuemin`, `aria-valuemax` (parsed as float, NaN filtered)
- Captures `aria-valuetext` (trimmed, capped at 60 chars)
- Fields are `undefined` for elements without these attributes (zero overhead)

**Modified `packages/planner/src/buildPlannerPrompt.ts`:**
- `valueText` takes precedence: renders `valueText="72°F (warm)"`
- Otherwise `valueNow` renders as `range=50/0–100` (with min/max) or `range=50` (without)
- Missing min or max shown as `?` (e.g., `range=3/1–?`)
- Placed after `roleDesc` and before `text` for natural reading order

**Impact:** The planner can now see:
- A slider at 50% out of 0–100 range
- A progress bar at 75% completion
- A spinbutton at value 3 with min 1
- Human-readable value text like "72°F (warm)" for range widgets
This prevents blind interactions with range controls and helps the planner understand current widget state.

**Added 6 tests to `tests/planner-prompt.test.mjs`:**
- valueNow rendered as range with min/max
- valueNow without min/max rendered as simple range
- valueText takes precedence over valueNow
- range annotation absent when no value properties
- valueNow with partial min renders `?` for missing max
- range annotation placed after roleDesc and before text (ordering)

#### Verification

- `pnpm run typecheck` — ✓ clean
- `node --test tests/planner-prompt.test.mjs` — 101/101 pass (was 95, +6 new)
- `node --test tests/*.test.mjs` — 934/934 pass (was 928, +6 new)

#### Status: DONE

#### Next Steps

- All pure-logic modules across all packages have test coverage (934 tests, 0 failures)
- Remaining untested code requires Electron context
- P3-10 (profile system) remains deferred
- Consider table structure extraction for data-heavy pages
- Consider surfacing `aria-orientation` for sliders/scrollbars (horizontal vs vertical)

*Session log entry written: 2026-03-16 (Session 71)*

---

### Session 72 — 2026-03-16: Surface Table Structure in Page Model and Planner Prompt

#### Context

Gap analysis (Sessions 67–71 repeatedly suggested): data tables on pages like comparison shopping, flight results, product lists, search result tables have no structural representation in the page model. The planner only gets a flat text dump in `visibleText` with no column/row awareness. This prevents the planner from understanding tabular data, making it difficult to compare items, extract specific cell values, or navigate table-heavy pages effectively.

#### Plan

1. Add `tables?: Array<{ caption?: string; headers: string[]; rowCount: number; sampleRows?: string[][] }>` to `PageModel` in `contracts/browser.ts`
2. Add `extractTables()` function to `extractPageModel.ts` — capture up to 3 visible tables with headers and first 3 sample rows
3. Surface table summaries in `buildPlannerPrompt.ts` between forms and scroll position
4. Add tests to `planner-prompt.test.mjs`
5. Run typecheck + tests
6. Update this log and commit

#### Implementation

**Modified `packages/contracts/src/browser.ts`:**
- Added `tables?: Array<{ caption?: string; headers: string[]; rowCount: number; sampleRows?: string[][] }>` to `PageModel`
- Captures structural representation of data tables on the page

**Modified `packages/browser-runtime/src/cdp/extractPageModel.ts`:**
- Added `extractTables()` function: scans up to 3 visible `<table>` elements
- Captures `<caption>` text (capped at 80 chars)
- Extracts headers from `<thead><tr>` or first `<tr>` (up to 10 columns, 40 chars each)
- Counts body rows (from `<tbody>` or all `<tr>` minus header)
- Captures first 3 sample rows with cell text (up to 10 columns, 40 chars each)
- Returns `undefined` when no tables exist (zero overhead)

**Modified `packages/planner/src/buildPlannerPrompt.ts`:**
- Added `tablesSection` — renders `Data tables on page:` with structured table summaries
- Each table shows: caption (if any), headers joined by ` | `, row count, and sample rows
- Placed between forms section and scroll position in the user prompt

**Impact:** The planner can now see:
- Table structure on data-heavy pages (comparison shopping, flight results, product lists)
- Column headers for understanding what data is available
- Sample rows for understanding data format and values
- Row counts for understanding table size
This prevents the planner from relying solely on flat text dumps to understand tabular data.

**Added 7 tests to `tests/planner-prompt.test.mjs`:**
- table with caption, headers, sample rows rendered correctly
- table without caption omits quote-wrapped caption
- (no headers) shown when headers empty
- singular "row" for rowCount 1
- tables section absent when undefined
- tables section absent when empty array
- multiple tables both rendered

#### Verification

- `pnpm run typecheck` — ✓ clean
- `pnpm --filter @openbrowse/planner build` — ✓ clean
- `node --test tests/planner-prompt.test.mjs` — 108/108 pass (was 101, +7 new)
- `node --test tests/*.test.mjs` — 941/941 pass (was 934, +7 new)

#### Status: DONE

#### Next Steps

- All pure-logic modules across all packages have test coverage (941 tests, 0 failures)
- Remaining untested code requires Electron context
- P3-10 (profile system) remains deferred
- Consider surfacing `aria-orientation` for sliders/scrollbars (horizontal vs vertical)
- Consider table column/row span awareness for complex tables

*Session log entry written: 2026-03-16 (Session 72)*

---

### Session 73 — 2026-03-16: Surface aria-pressed for Toggle Buttons in Page Model

#### Context

Gap analysis: toggle buttons (dark mode switches, mute buttons, bookmark/favorite toggles, like buttons) are ubiquitous on modern pages. The page model currently surfaces `checked` for checkboxes/radios and `expanded` for disclosure widgets, but has no representation for `aria-pressed` on toggle buttons. Without this, the planner cannot determine whether a toggle is currently active or inactive, leading to blind toggling.

#### Plan

1. Add `pressed?: boolean | "mixed"` to `PageElementModel` in `contracts/browser.ts`
2. Extract `aria-pressed` in `extractPageModel.ts` element enumeration
3. Surface `(pressed)` / `(not pressed)` / `(partially pressed)` in `buildPlannerPrompt.ts` element lines
4. Add tests to `planner-prompt.test.mjs`
5. Run typecheck + tests
6. Update this log and commit

#### Implementation

**Modified `packages/contracts/src/browser.ts`:**
- Added `pressed?: boolean | "mixed"` to `PageElementModel`
- Supports true (pressed), false (not pressed), and "mixed" (partially pressed) states

**Modified `packages/browser-runtime/src/cdp/extractPageModel.ts`:**
- Extracts `aria-pressed` attribute during element enumeration
- Maps "true" → `true`, "false" → `false`, "mixed" → `"mixed"`, absent → `undefined`

**Modified `packages/planner/src/buildPlannerPrompt.ts`:**
- Renders `(pressed)`, `(not pressed)`, or `(partially pressed)` in element lines
- Placed after expanded/collapsed rendering

**Impact:** The planner can now see toggle button state on pages with:
- Dark mode / light mode toggles
- Mute/unmute buttons
- Bookmark/favorite/like toggles
- Bold/italic/underline toolbar buttons
- Any button with `aria-pressed` attribute

**Added 4 tests to `tests/planner-prompt.test.mjs`:**
- pressed=true renders (pressed)
- pressed=false renders (not pressed)
- pressed=mixed renders (partially pressed)
- pressed undefined does not render pressed text

#### Verification

- `pnpm run typecheck` — ✓ clean
- `pnpm --filter @openbrowse/planner build` — ✓ clean
- `node --test tests/planner-prompt.test.mjs` — 112/112 pass (was 108, +4 new)
- `node --test tests/*.test.mjs` — 945/945 pass (was 941, +4 new)

#### Status: DONE

#### Next Steps

- All pure-logic modules across all packages have test coverage (945 tests, 0 failures)
- Remaining untested code requires Electron context
- P3-10 (profile system) remains deferred
- Consider surfacing `aria-orientation` for sliders/scrollbars (horizontal vs vertical)
- Consider table column/row span awareness for complex tables
- Consider surfacing `aria-multiselectable` for listboxes/grids

*Session log entry written: 2026-03-16 (Session 73)*

---

### Session 74 — 2026-03-16: Surface aria-orientation for Sliders/Scrollbars in Page Model

#### Context

Gap analysis (Sessions 71–73 suggested): sliders, scrollbars, separators, toolbars, and tab lists can have `aria-orientation` set to "horizontal" or "vertical". Without this, the planner cannot determine the axis of interaction for range widgets (e.g., whether to drag left/right or up/down) or understand toolbar/tablist layout direction.

#### Plan

1. Add `orientation?: "horizontal" | "vertical"` to `PageElementModel` in `contracts/browser.ts`
2. Extract `aria-orientation` in `extractPageModel.ts` element enumeration
3. Surface `(horizontal)` / `(vertical)` in `buildPlannerPrompt.ts` element lines
4. Add tests to `planner-prompt.test.mjs`
5. Run typecheck + tests
6. Update this log and commit

#### Implementation

**Modified `packages/contracts/src/browser.ts`:**
- Added `orientation?: "horizontal" | "vertical"` to `PageElementModel`
- Captures axis direction for sliders, scrollbars, separators, toolbars, and tab lists

**Modified `packages/browser-runtime/src/cdp/extractPageModel.ts`:**
- Extracts `aria-orientation` attribute during element enumeration
- Maps "horizontal" → `"horizontal"`, "vertical" → `"vertical"`, absent → `undefined`

**Modified `packages/planner/src/buildPlannerPrompt.ts`:**
- Renders `(horizontal)` or `(vertical)` in element lines
- Placed after pressed rendering, before invalid

**Impact:** The planner can now see orientation for:
- Sliders (drag left/right vs up/down)
- Scrollbars (horizontal vs vertical scrolling)
- Separators (horizontal vs vertical dividers)
- Toolbars (horizontal vs vertical layout)
- Tab lists (horizontal vs vertical tab arrangement)

**Added 3 tests to `tests/planner-prompt.test.mjs`:**
- orientation=horizontal renders (horizontal)
- orientation=vertical renders (vertical)
- orientation undefined does not render orientation text

#### Verification

- `pnpm run typecheck` — ✓ clean
- `node --test tests/planner-prompt.test.mjs` — 115/115 pass (was 112, +3 new)
- `node --test tests/*.test.mjs` — 948/948 pass (was 945, +3 new)

#### Status: DONE

#### Next Steps

- All pure-logic modules across all packages have test coverage (948 tests, 0 failures)
- Remaining untested code requires Electron context
- P3-10 (profile system) remains deferred
- Consider surfacing `aria-multiselectable` for listboxes/grids
- Consider table column/row span awareness for complex tables
- Consider surfacing `aria-autocomplete` for combobox/search inputs

*Session log entry written: 2026-03-16 (Session 74)*

---

### Session 75 — 2026-03-16: Surface aria-autocomplete for Combobox/Search Inputs in Page Model

#### Context

Gap analysis (Session 74 suggestion): `aria-autocomplete` is used on combobox, searchbox, and text input elements to indicate the type of autocomplete behavior. Values: "inline" (text completion in the field), "list" (popup list of suggestions), "both" (inline + list), or "none". Without this, the planner cannot distinguish between a plain text input and one that will show a suggestion dropdown — affecting whether it should type slowly and wait for suggestions or type the full value immediately.

#### Plan

1. Add `autocomplete?: "inline" | "list" | "both"` to `PageElementModel` in `contracts/browser.ts`
2. Extract `aria-autocomplete` in `extractPageModel.ts` element enumeration (filter "none")
3. Surface `(autocomplete=list)` etc. in `buildPlannerPrompt.ts` element lines
4. Add tests to `planner-prompt.test.mjs`
5. Run typecheck + tests
6. Update this log and commit

#### Implementation

**Modified `packages/contracts/src/browser.ts`:**
- Added `autocomplete?: "inline" | "list" | "both"` to `PageElementModel`
- Captures the autocomplete behavior hint for combobox, searchbox, and text input elements

**Modified `packages/browser-runtime/src/cdp/extractPageModel.ts`:**
- Extracts `aria-autocomplete` attribute during element enumeration
- Maps "inline" → `"inline"`, "list" → `"list"`, "both" → `"both"`, absent or "none" → `undefined`

**Modified `packages/planner/src/buildPlannerPrompt.ts`:**
- Renders `(autocomplete=inline)`, `(autocomplete=list)`, or `(autocomplete=both)` in element lines
- Placed after orientation rendering, before invalid

**Impact:** The planner can now see autocomplete behavior for:
- Search boxes with dropdown suggestions (`autocomplete=list`)
- Address fields with inline completion (`autocomplete=inline`)
- Combo inputs with both inline and list suggestions (`autocomplete=both`)
This helps the planner decide whether to type the full value or wait for suggestion dropdowns.

**Added 4 tests to `tests/planner-prompt.test.mjs`:**
- autocomplete=list renders (autocomplete=list)
- autocomplete=both renders (autocomplete=both)
- autocomplete=inline renders (autocomplete=inline)
- autocomplete undefined does not render autocomplete text

#### Verification

- `pnpm run typecheck` — ✓ clean
- `pnpm --filter @openbrowse/planner build` — ✓ clean
- `node --test tests/planner-prompt.test.mjs` — 119/119 pass (was 115, +4 new)
- `node --test tests/*.test.mjs` — 952/952 pass (was 948, +4 new)

#### Status: DONE

#### Next Steps

- All pure-logic modules across all packages have test coverage (952 tests, 0 failures)
- Remaining untested code requires Electron context
- P3-10 (profile system) remains deferred
- Consider surfacing `aria-multiselectable` for listboxes/grids
- Consider table column/row span awareness for complex tables

*Session log entry written: 2026-03-16 (Session 75)*

---

### Session 76 — 2026-03-16: Surface aria-multiselectable for Listbox/Grid Elements in Page Model

#### Context

Gap analysis (Session 75 suggestion): `aria-multiselectable` is used on `listbox`, `grid`, `tablist`, and `tree` container elements to indicate whether multiple children can be selected simultaneously. Without this, the planner cannot distinguish between a single-select listbox and a multi-select one — affecting whether it tries to select multiple items or assumes only one selection is allowed.

#### Plan

1. Add `multiselectable?: boolean` to `PageElementModel` in `contracts/browser.ts`
2. Extract `aria-multiselectable="true"` in `extractPageModel.ts` element enumeration
3. Surface `(multiselectable)` annotation in `buildPlannerPrompt.ts` element rendering
4. Add tests to `planner-prompt.test.mjs`
5. Run typecheck + tests
6. Update this log and commit

#### Implementation

**Modified `packages/contracts/src/browser.ts`:**
- Added `multiselectable?: boolean` optional field to `PageElementModel`
- Captures the `aria-multiselectable` attribute for listbox, grid, tablist, and tree container elements

**Modified `packages/browser-runtime/src/cdp/extractPageModel.ts`:**
- After `autocomplete`, captures `aria-multiselectable="true"` → `true`, otherwise `undefined`
- Zero overhead for elements without the attribute (field is `undefined`)

**Modified `packages/planner/src/buildPlannerPrompt.ts`:**
- Element rendering now shows `(multiselectable)` annotation between `autocomplete` and `invalid`
- Example: `[el_5] listbox "Colors" (multiselectable) *`

**Impact:** The planner can now distinguish between single-select and multi-select list/grid containers. This affects whether it tries to select multiple items or assumes only one selection is allowed.

**Added 4 tests to `tests/planner-prompt.test.mjs`:**
- multiselectable renders (multiselectable) for listbox
- multiselectable absent when undefined
- multiselectable absent when false
- multiselectable renders after autocomplete and before invalid (ordering)

#### Verification

- `pnpm run typecheck` — ✓ clean
- `pnpm --filter @openbrowse/planner build` — ✓ clean
- `node --test tests/planner-prompt.test.mjs` — 123/123 pass (was 119, +4 new)
- `node --test tests/*.test.mjs` — 956/956 pass (was 952, +4 new)

#### Status: DONE

#### Next Steps

- All pure-logic modules across all packages have test coverage (956 tests, 0 failures)
- Remaining untested code requires Electron context
- P3-10 (profile system) remains deferred
- Consider surfacing `aria-required` for form elements that must be filled
- Consider table column/row span awareness for complex tables

*Session log entry written: 2026-03-16 (Session 76)*

---

### Session 77 — 2026-03-16: Fix Hard Failure on Pending Action Soft Failure in continueResume

#### Context

Code review found a bug in `RunExecutor.continueResume()` (lines 351-368). When a `pendingAction` (from an approval resume) fails, the run is immediately terminated via `failRun()` regardless of failure type. In contrast, `plannerLoop` (lines 198-234) treats `element_not_found` and `network_error` as soft failures that allow the planner to retry with a different approach.

This matters because on resume, the page DOM has changed (new browser session, re-navigation to `lastKnownUrl`). The pending action's `targetId` may no longer exist because:
1. The page was re-rendered and element IDs were reassigned
2. Dynamic content changed between suspension and resume
3. The page structure shifted after re-navigation

Expected behavior: soft failure classes should be recoverable — skip the pending action and enter the planner loop, which will see the current page state and decide what to do.

#### Plan

1. In `continueResume`, check `result.failureClass` before calling `failRun`
2. Treat `element_not_found` and `network_error` as soft failures → record result but continue to planner loop
3. Only call `failRun` for hard failures (other failure classes)
4. Add tests for both soft and hard failure paths
5. Run typecheck + tests
6. Update this log and commit

#### Implementation

**Fixed `packages/runtime-core/src/RunExecutor.ts` — `continueResume()` pending action failure handling:**
- Before: ALL pending action failures → `failRun()` → run terminates
- After: `element_not_found` and `network_error` failures → add note to `checkpoint.notes` → continue to planner loop
- Hard failures (interaction_failed, validation_error, etc.) → still call `failRun()` as before
- The note informs the planner that the pending action failed and the page state may have changed

**Impact:** On approval resume, when the page DOM has changed and the approved action's target element no longer exists, the run recovers gracefully instead of terminating. The planner sees the current page state and can retry with a different approach.

**Updated `tests/runExecutor.test.mjs` — 2 new tests, 1 updated (28 → 30):**
- Renamed "continueResume fails if pending action fails" → "continueResume fails if pending action has hard failure" — now explicitly uses `failureClass: "interaction_failed"`
- Added "continueResume recovers from pending action element_not_found (soft failure)" — verifies run completes, note added to checkpoint
- Added "continueResume recovers from pending action network_error (soft failure)" — verifies run continues to planner loop

#### Verification

- `pnpm --filter @openbrowse/runtime-core build` — ✓ clean
- `pnpm run typecheck` — ✓ clean
- `node --test tests/runExecutor.test.mjs` — 30/30 pass (was 28, +2 new)
- `node --test tests/*.test.mjs` — 958/958 pass (was 956, +2 new)

#### Status: DONE

#### Next Steps

- All pure-logic modules across all packages have test coverage (958 tests, 0 failures)
- Remaining untested code requires Electron context
- P3-10 (profile system) remains deferred
- Consider similar soft-failure recovery for other resume paths
- Consider surfacing `aria-required` for form elements in element list

*Session log entry written: 2026-03-16 (Session 77)*

---

### Session 78 — 2026-03-16: Surface aria-required in Page Model for Form Element Required State

#### Context

The page model currently surfaces `required` only inside `forms[].fields[].required` (via HTML `required` attribute or `aria-required="true"`). However, the element list — which the planner uses for action planning — does not expose required state. This means the planner cannot see which individual textboxes, comboboxes, or other inputs are required when deciding form-filling strategy.

Previous sessions added `pressed`, `orientation`, `autocomplete`, `multiselectable`, and `invalid` following the same pattern. This session adds `required`.

#### Plan

1. Add `required?: boolean` to `PageElementModel` in `packages/contracts/src/browser.ts`
2. Extract `required` (HTML attribute) and `aria-required="true"` in `extractPageModel.ts` element enumeration
3. Render `(required)` in `buildPlannerPrompt.ts` element line — place after `multiselectable` and before `invalid`
4. Add 4 planner-prompt tests: required=true renders, undefined absent, false absent, ordering
5. Run typecheck + tests
6. Update this log and commit

#### Implementation

**`packages/contracts/src/browser.ts`** — Added `required?: boolean` to `PageElementModel` interface.

**`packages/browser-runtime/src/cdp/extractPageModel.ts`** — Added `required` extraction in element enumeration:
- Uses `(el.required || el.getAttribute('aria-required') === 'true') ? true : undefined`
- Covers both HTML `required` attribute (input, select, textarea) and ARIA `aria-required="true"` (custom widgets)
- Placed after `multiselectable` and before `invalid` in the element object

**`packages/planner/src/buildPlannerPrompt.ts`** — Added `(required)` rendering in element line after `(multiselectable)` and before `(invalid)`.

**`tests/planner-prompt.test.mjs`** — 4 new tests (123 → 127):
- `required=true` renders `(required)` for textbox
- `required` absent when undefined
- `required` absent when false
- `required` renders after multiselectable and before invalid (ordering)

#### Verification

- `pnpm run typecheck` — ✓ clean
- `node --test tests/planner-prompt.test.mjs` — 127/127 pass (was 123, +4 new)
- `node --test tests/*.test.mjs` — 962/962 pass (was 958, +4 new)

#### Status: DONE

#### Next Steps

- All pure-logic modules across all packages have test coverage (962 tests, 0 failures)
- Remaining untested code requires Electron context
- P3-10 (profile system) remains deferred
- Consider surfacing `aria-haspopup` so planner knows which buttons open menus/dialogs
- Consider surfacing `aria-busy` for loading states

*Session log entry written: 2026-03-16 (Session 78)*

---

### Session 79 — 2026-03-16: Surface aria-haspopup in Page Model for Menu/Dialog Trigger Awareness

#### Context

The planner currently cannot distinguish between buttons that perform direct actions and buttons that open menus, dialogs, listboxes, or other popups. The `aria-haspopup` attribute indicates what type of popup a trigger element controls (`true`/`menu`, `dialog`, `listbox`, `tree`, `grid`). Surfacing this helps the planner:
- Know which buttons will open dropdown menus vs perform actions
- Anticipate that clicking a trigger will reveal new interactive elements
- Understand the interaction pattern (menu navigation, dialog filling, listbox selection)

Previous sessions added `pressed`, `orientation`, `autocomplete`, `multiselectable`, `required`, and `invalid` following the same pattern.

#### Plan

1. Add `hasPopup?: string` to `PageElementModel` in `packages/contracts/src/browser.ts`
2. Extract `aria-haspopup` in `extractPageModel.ts` element enumeration (normalize `true` → `menu`)
3. Render `(haspopup=<type>)` in `buildPlannerPrompt.ts` element line — place after `required` and before `invalid`
4. Add 4 planner-prompt tests: haspopup renders, absent when undefined, "true" normalizes to "menu", ordering
5. Run typecheck + tests
6. Update this log and commit

#### Implementation

**`packages/contracts/src/browser.ts`** — Added `hasPopup?: string` to `PageElementModel` interface.

**`packages/browser-runtime/src/cdp/extractPageModel.ts`** — Added `hasPopup` extraction in element enumeration:
- Reads `aria-haspopup` attribute; normalizes `"true"` → `"menu"` (per ARIA spec, `true` is equivalent to `menu`)
- Filters out `"false"` (treated as no popup)
- Valid values: `menu`, `dialog`, `listbox`, `tree`, `grid`

**`packages/planner/src/buildPlannerPrompt.ts`** — Added `(haspopup=<type>)` rendering in element line after `(required)` and before `(invalid)`.

**`tests/planner-prompt.test.mjs`** — 4 new tests (127 → 131):
- `hasPopup` renders `(haspopup=menu)` for button with menu trigger
- `hasPopup` absent when undefined
- `hasPopup` renders `(haspopup=dialog)` for dialog triggers
- `hasPopup` renders after required and before invalid (ordering)

#### Verification

- `pnpm run typecheck` — ✓ clean
- `node --test tests/planner-prompt.test.mjs` — 131/131 pass (was 127, +4 new)
- `node --test tests/*.test.mjs` — 966/966 pass (was 962, +4 new)

#### Status: DONE

#### Next Steps

- All pure-logic modules across all packages have test coverage (966 tests, 0 failures)
- Remaining untested code requires Electron context
- P3-10 (profile system) remains deferred
- Consider surfacing `aria-busy` so planner sees loading states
- Consider surfacing `aria-live` regions so planner knows about dynamic content areas

*Session log entry written: 2026-03-16 (Session 79)*
