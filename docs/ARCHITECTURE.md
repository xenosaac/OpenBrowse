# OpenBrowse Architecture

OpenBrowse borrows two ideas:

- from OpenClaw: gateway/session/memory/workflow modularity
- from Chromium-style browser products: strict separation between browser shell, page runtime, and control plane

## System Shape

```text
Desktop Shell
  -> Runtime Composition
    -> Task Orchestrator
      -> Planner
      -> Browser Runtime
      -> Chat Bridge
      -> Memory Store
      -> Scheduler
      -> Observability
      -> Security
```

## Process Boundaries

### Desktop Shell

The desktop shell is the browser product surface:

- window/tab UI
- profile selection
- task console
- local settings
- IPC entry points

It should stay thin. It starts the runtime but should not own business logic.

### Runtime Composition

The runtime composition layer is the OpenClaw-like control plane inside the app.
It wires modules together and owns lifecycle:

- boot services
- inject configuration
- register IPC handlers
- start schedulers
- recover unfinished runs

### Task Orchestrator

The orchestrator is the product core.
It owns:

- run creation
- state transitions
- clarification suspension
- resume after user replies
- finalization and checkpointing

This is the equivalent of an assistant/session workflow brain, but scoped to browser tasks.

### Planner

The planner turns a task goal plus current run state into a next decision:

- continue autonomously
- ask a clarification question
- request an approval
- stop with a summarized outcome

The planner is deliberately model-agnostic.

### Browser Runtime

The browser runtime provides controlled access to Chromium sessions:

- managed browser profiles
- session attachment and recovery
- page modeling
- action execution
- navigation snapshots

This should expose product-level contracts, not raw browser APIs.

### Chat Bridge

The chat bridge translates between external message channels and task runs:

- send clarification questions
- route replies back to the correct suspended run
- stream progress summaries
- support remote notifications and watcher alerts

### Memory Store

The memory store is local-first and split into three concerns:

- workflow log
- run checkpoints
- user preference memory

This is what lets long tasks recover without context collapse.

### Scheduler

The scheduler owns recurring watch tasks:

- unread summaries
- price changes
- periodic inbox scans
- rule-based re-checks

Schedulers create runs; they do not implement task logic.

### Observability

Observability is a first-class module because agentic browser products fail without replay:

- append-only event log
- audit trail
- run timeline
- metrics sinks

### Security

Security is not only about secrets.
It decides whether a step may proceed:

- irreversible action gates
- purchase/send/submit approval policies
- secret references
- credential handoff policy

## Module Rules

- `contracts` stays dependency-free and declares the shared language.
- `orchestrator` may depend on all execution-side modules, but not on UI code.
- `planner` never talks to the browser directly.
- `browser-runtime` never decides policy.
- `chat-bridge` does not own workflow state.
- `memory-store` is append-first; it should preserve replayability.
- `scheduler` creates task intents, not custom side effects.

## Why This Shape

The product needs two things at once:

1. browser-level control
2. remote conversational continuity

OpenClaw proves the second matters.
Browser agents prove the first matters.
This architecture isolates both so neither leaks into the wrong layer.

