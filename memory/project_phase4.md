---
name: phase4_persistent_harness
description: What was built in Phase 4 (Persistent Harness) and remaining gaps
type: project
---

## Phase 4: Persistent Harness — COMPLETED 2026-03-14

### What changed

**contracts/src/tasks.ts**
- New `RunActionRecord` interface: `{ step, type, description, ok, failureClass?, url?, createdAt }`
- New `RunHandoffArtifact` interface: structured handoff for human/agent consumption
- `RunCheckpoint` enriched: `lastPageTitle?`, `lastPageSummary?`, `stepCount?`, `actionHistory?`, `stopReason?`, `nextSuggestedStep?`, `lastFailureClass?`, `consecutiveSoftFailures?`

**contracts/src/memory.ts**
- Added `handoff_written` to `WorkflowEventType`

**orchestrator/src/TaskOrchestrator.ts**
- `createRun()`: initializes `stepCount: 0`, `actionHistory: []`, `consecutiveSoftFailures: 0`
- `observePage()`: captures `lastPageTitle`, `lastPageSummary`, increments `stepCount`
- `recordBrowserResult()`: appends `RunActionRecord` to `actionHistory` (max 10), tracks `lastFailureClass`, `consecutiveSoftFailures`
- `applyPlannerDecision()`: sets `nextSuggestedStep` for browser_action decisions, sets `stopReason` for all terminal/suspension transitions
- `failRun()` / `cancelRun()`: preserve `stopReason`

**observability/src/RunHandoff.ts** (new)
- `buildHandoffArtifact(run: TaskRun): RunHandoffArtifact` — builds structured artifact from checkpoint
- `renderHandoffMarkdown(artifact: RunHandoffArtifact): string` — produces inspectable markdown with action table, stop reason, next step, failure info

**observability/src/AuditTrail.ts**
- Handles `handoff_written` event type in switch cases

**runtime-core/src/OpenBrowseRuntime.ts**
- Imports `buildHandoffArtifact`, `renderHandoffMarkdown`
- `writeHandoff(run)` private method: builds artifact + logs `handoff_written` event with markdown in payload
- Called at all terminal state transitions: hard failure, planner-decided termination, suspension, loop exceeded

**runtime-core/src/index.ts**
- Re-exports `buildHandoffArtifact`, `renderHandoffMarkdown` from observability

**apps/desktop IPC + preload**
- New `run:handoff` IPC handler: loads run from checkpoint store, returns `{ artifact, markdown }`
- New `getRunHandoff(runId)` preload API

### Soft vs hard failure semantics
- Soft (`element_not_found`): `consecutiveSoftFailures++`, loop continues, tracked in checkpoint
- Hard (all others): `stopReason` set, `writeHandoff` called immediately, run terminates
- Both failure classes preserved in `actionHistory` records and `lastFailureClass`

### Remaining gaps
- No renderer UI for viewing handoff markdown (IPC exists but no panel built)
- No max `consecutiveSoftFailures` guard (e.g., fail run after 5 consecutive soft failures)
- Recovery path (`continueResume`) doesn't call `writeHandoff` after resumption failures

**How to apply:** Reference for Phase 5 scope.
