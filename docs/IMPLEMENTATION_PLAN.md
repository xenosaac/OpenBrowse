# Implementation Plan

## Phase 0: Framework Lock-In

- finalize module boundaries
- finalize run/clarification contracts
- finalize browser profile ownership model
- finalize local log format

## Phase 1: Runnable Skeleton

- replace stub scripts with real TypeScript build tooling
- wire Electron main/preload/renderer
- stand up a persistent local store
- prove run creation and resume from a fake Telegram reply

## Phase 2: Browser Runtime

- embed Chromium-backed shell through Electron
- manage app-owned profiles
- capture real page models
- execute a narrow action set: navigate, click, type, extract

## Phase 3: Remote Clarification Loop

- wire Telegram adapter
- match replies back to suspended runs
- resume from stored checkpoints
- render the same state inside the desktop console

## Phase 4: First Demo Tasks

- travel search with clarification
- appointment booking with clarification
- unread-summary monitor for a single web app

## Phase 5: Safety and Recovery

- approval gates for send/submit/purchase
- local replay UI
- crash recovery for unfinished runs
- watcher backoff and retry policy
