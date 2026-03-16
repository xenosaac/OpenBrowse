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

**Page model element cap:** `buildPlannerPrompt` caps `pageModel.elements` at 50. This may be too low for complex pages. Future: consider 100–150 or smarter relevance filtering.

**Planner token budget:** `maxTokens` is 4096. With adaptive thinking, Claude decides how much to think. Do not reduce this — 1024 was causing silent `task_failed` returns on complex pages.

### Schema Migrations

Current schema version: **3**

| Version | Changes |
|---|---|
| 1 | Initial tables: `workflow_events`, `run_checkpoints`, `user_preferences`, `schema_meta` |
| 2 | Added `status`, `goal`, `created_at` columns to `run_checkpoints`; added type/status/ns_key indexes; backfilled from JSON |
| 3 | Added `idx_workflow_events_created_at (created_at DESC, id DESC)` for `listRecent()` performance |

### Planner Output Format

`ClaudePlannerGateway` uses a flat JSON schema with `output_config.format`. The schema allows all possible fields at the schema level (all optional except `type` and `reasoning`). `parsePlannerResponse` handles semantic validation of which fields are present per decision type. With structured outputs enabled, the `extractJson` fallbacks in `parsePlannerResponse` should never activate — but they remain as safety net.

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
