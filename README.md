# Project OpenBrowse

OpenBrowse is a macOS-only, Apple-silicon-only agentic browser shell.
It combines:

- OpenClaw-style remote, messaging-native workflow continuity
- a local-first task runtime with resumable execution and workflow logs
- a Chromium-based browser shell with full control over managed sessions

This repository is intentionally scaffolded around module boundaries first.
The immediate goal is to make the product architecture explicit before implementation begins.

## Product Thesis

OpenBrowse is not "browser automation with a chat window."

It is:

- a standalone browser app
- a long-running task orchestrator
- a remote clarification loop over channels like Telegram
- a local workflow log + memory system

The browser is only one subsystem inside the runtime.

## Design Constraints

- Platform: macOS only
- Hardware: Apple silicon only
- Product surface: standalone app, not a browser extension
- Engine strategy: reuse Chromium-based infrastructure rather than building a browser from scratch
- Workflow principle: clarify, suspend, resume; do not fail hard on every missing preference

## Repository Layout

- `apps/desktop`
  - macOS browser shell, IPC surface, and runtime composition
- `packages/contracts`
  - shared domain types across all modules
- `packages/orchestrator`
  - task state machine and run coordination
- `packages/planner`
  - LLM-facing planning and clarification interfaces
- `packages/browser-runtime`
  - managed profile/session control and page modeling
- `packages/chat-bridge`
  - Telegram-style inbound/outbound task messaging
- `packages/memory-store`
  - workflow logs, checkpoints, preferences, and run memory
- `packages/scheduler`
  - recurring monitors and watch jobs
- `packages/observability`
  - event bus, audit trail, and metrics hooks
- `packages/security`
  - approval rules, secret references, and irreversible-action gates
- `docs`
  - product architecture, module map, and task lifecycle

## First Implementation Target

The first milestone is a coherent framework:

1. model task runs and clarification loops
2. define browser/session contracts
3. define how chat replies resume suspended work
4. define local logging and checkpoints
5. define the desktop shell's process boundaries

## Suggested Implementation Order

1. Wire the `contracts`, `orchestrator`, and `memory-store` packages.
2. Implement a local task registry and run checkpointing.
3. Add the `browser-runtime` with managed profiles and stubbed page models.
4. Add `chat-bridge` and suspended-run resume flow.
5. Add the desktop shell and task console UI.
6. Connect the planner and start real execution loops.
