# Task Lifecycle

## 1. Intake

A task begins from:

- the desktop app
- a chat message
- a scheduled watcher

The system converts the request into a `TaskIntent`.

## 2. Run Creation

The orchestrator creates a `TaskRun` with:

- a stable run id
- the source channel
- the chosen browser profile
- current goal and constraints
- initial checkpoint state

## 3. Browser Attachment

The browser runtime either:

- reuses a warm managed session
- or creates a fresh session for the task

It then produces a `PageModel` rather than leaking raw DOM state.

## 4. Planning Loop

The planner receives:

- the user goal
- the run checkpoint
- recent page model
- prior clarifications
- policy hints

It returns one of:

- `browser_action`
- `clarification_request`
- `approval_request`
- `task_complete`
- `task_failed`

## 5. Clarification Suspension

If the planner needs a user decision, the orchestrator:

- stores a checkpoint
- emits a `ClarificationRequest`
- marks the run suspended
- sends the question through the chat bridge

The run is not discarded.

## 6. Resume

When the user replies, the chat bridge routes the answer back to the suspended run.
The orchestrator restores the checkpoint and resumes the same run.

## 7. Logging

Every transition writes to the local workflow log:

- run started
- page modeled
- action executed
- clarification requested
- clarification answered
- run completed or failed

## 8. Watchers

Watch tasks are just recurring task intents.
They reuse the same lifecycle and do not invent a separate execution path.

