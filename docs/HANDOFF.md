# OpenBrowse Handoff

This file is the project-local handoff for future implementation agents.
Read this before making structural changes.

## Project Scope

OpenBrowse is:

- a standalone macOS browser app
- Apple-silicon-only
- Chromium-based in product strategy
- local-first in workflow logs and task memory
- designed for remote conversational task continuation

OpenBrowse is not:

- a browser extension
- a generic cross-platform automation framework
- a CLI-first tool for developers

## Product Thesis

The core product behavior is:

1. user starts a browser task
2. agent operates autonomously when possible
3. when a decision is missing, the agent asks a concise remote clarification question
4. the user replies from chat
5. the same task run resumes from checkpoint

The product goal is not "perfect autonomous execution."
The goal is "long browser tasks that do not collapse when the user is away from the machine."

## Current Repository State

The repository is scaffold-first, not runnable yet.

Implemented so far:

- monorepo layout with `apps/desktop` and focused domain packages
- architecture docs
- task lifecycle docs
- initial TypeScript contracts
- stub modules for orchestrator, planner, browser runtime, chat bridge, memory store, scheduler, observability, and security
- placeholder desktop runtime composition

Not implemented yet:

- real Electron wiring
- real Chromium session/profile management
- persistent storage
- real Telegram transport
- real LLM planner integration
- real page modeling and action execution

## Module Intent

### `apps/desktop`

Thin desktop/browser shell.
Should own product surface and process boundaries, not workflow logic.

### `packages/contracts`

Shared domain language.
Keep dependency-free.

### `packages/orchestrator`

Product core.
Owns task run lifecycle, suspension, resume, and checkpoint-aware transitions.

### `packages/planner`

LLM-facing decision interface.
Should remain model-provider-agnostic.

### `packages/browser-runtime`

Owns browser sessions, managed profiles, page models, and action execution.
Do not leak raw browser APIs across the rest of the repo.

### `packages/chat-bridge`

Maps remote chat messages to task runs.
Should not own workflow state.

### `packages/memory-store`

Owns workflow logs, checkpoints, and preference memory.
Must preserve replayability.

### `packages/scheduler`

Creates recurring task intents for monitoring flows.

### `packages/observability`

Owns eventing, replay hooks, and run timelines.

### `packages/security`

Owns approval and irreversible-action policy.

## Architectural Rules

- Keep the desktop app thin.
- Keep orchestration logic out of renderer/UI layers.
- Keep planner isolated from direct browser APIs.
- Keep browser runtime isolated from approval/policy decisions.
- Keep local replay and checkpointing as first-class behavior.
- Prefer app-managed browser profiles over attaching blindly to the user's primary Chrome profile.

## Recommended Implementation Order

1. Replace placeholder scripts with real build tooling.
2. Wire Electron main/preload/renderer structure.
3. Add persistent local storage for runs, workflow logs, and preferences.
4. Implement managed Chromium sessions and first real page model capture.
5. Implement Telegram chat bridge and suspended-run resume.
6. Implement one narrow end-to-end demo flow with clarification.

## First Good Demo

Recommended initial demo:

- user asks OpenBrowse to search a travel workflow
- agent gathers options
- agent asks one concise clarification question remotely
- user replies through chat
- agent resumes and completes the run

This demonstrates the core wedge better than a generic "open webpage and click buttons" demo.

## Handoff Guidance For Other Agents

- Read `README.md`, `docs/ARCHITECTURE.md`, `docs/TASK_LIFECYCLE.md`, and this file first.
- Preserve the current module boundaries unless there is a strong architectural reason to change them.
- If you add a new subsystem, document why it cannot fit into the existing package map.
- Do not prematurely couple the product to a single model provider, a single website, or a single chat transport.
- Keep the implementation biased toward macOS + Apple silicon only.
