import { StubBrowserKernel } from "@openbrowse/browser-runtime";
import type { RuntimeConfig, TaskIntent, TaskMessage, TaskRun, WorkflowEvent } from "@openbrowse/contracts";
import { StubChatBridge } from "@openbrowse/chat-bridge";
import {
  InMemoryPreferenceStore,
  InMemoryRunCheckpointStore,
  InMemoryWorkflowLogStore
} from "@openbrowse/memory-store";
import { EventBus } from "@openbrowse/observability";
import { DefaultClarificationPolicy, TaskOrchestrator } from "@openbrowse/orchestrator";
import { StubPlannerGateway } from "@openbrowse/planner";
import { StubWatchScheduler } from "@openbrowse/scheduler";
import { DefaultApprovalPolicy } from "@openbrowse/security";

export interface RuntimeServices {
  browserKernel: StubBrowserKernel;
  chatBridge: StubChatBridge;
  eventBus: EventBus<{ workflow: WorkflowEvent }>;
  orchestrator: TaskOrchestrator;
  planner: StubPlannerGateway;
  preferenceStore: InMemoryPreferenceStore;
  runCheckpointStore: InMemoryRunCheckpointStore;
  runtimeConfig: RuntimeConfig;
  scheduler: StubWatchScheduler;
  securityPolicy: DefaultApprovalPolicy;
  workflowLogStore: InMemoryWorkflowLogStore;
}

export function createDefaultRuntimeConfig(): RuntimeConfig {
  return {
    platform: "macos",
    siliconOnly: true,
    appName: "OpenBrowse",
    workflowLogPath: "~/Library/Application Support/OpenBrowse/workflow",
    managedProfilesPath: "~/Library/Application Support/OpenBrowse/profiles"
  };
}

export function composeRuntime(runtimeConfig: RuntimeConfig = createDefaultRuntimeConfig()): RuntimeServices {
  return {
    browserKernel: new StubBrowserKernel(),
    chatBridge: new StubChatBridge(),
    eventBus: new EventBus<{ workflow: WorkflowEvent }>(),
    orchestrator: new TaskOrchestrator({
      clarificationPolicy: new DefaultClarificationPolicy()
    }),
    planner: new StubPlannerGateway(),
    preferenceStore: new InMemoryPreferenceStore(),
    runCheckpointStore: new InMemoryRunCheckpointStore(),
    runtimeConfig,
    scheduler: new StubWatchScheduler(),
    securityPolicy: new DefaultApprovalPolicy(),
    workflowLogStore: new InMemoryWorkflowLogStore()
  };
}

export async function bootstrapRun(services: RuntimeServices, intent: TaskIntent): Promise<TaskRun> {
  const run = services.orchestrator.createRun(intent);
  const profile = await services.browserKernel.ensureProfile(intent.preferredProfileId);
  const session = await services.browserKernel.attachSession(profile);
  const pageModel = await services.browserKernel.capturePageModel(session);
  const decision = await services.planner.decide({ run, pageModel });
  const updatedRun = services.orchestrator.applyPlannerDecision(
    {
      ...run,
      profileId: profile.id,
      checkpoint: {
        ...run.checkpoint,
        browserSessionId: session.id,
        lastPageModelId: pageModel.id
      }
    },
    decision
  );

  await services.runCheckpointStore.save(updatedRun);
  await services.workflowLogStore.append({
    id: `event_${updatedRun.id}`,
    runId: updatedRun.id,
    type: "planner_decision",
    summary: decision.reasoning,
    createdAt: new Date().toISOString(),
    payload: {
      plannerDecision: decision.type
    }
  });

  if (decision.clarificationRequest) {
    await services.chatBridge.sendClarification(decision.clarificationRequest);
  }

  return updatedRun;
}

export async function handleInboundMessage(
  services: RuntimeServices,
  message: TaskMessage
): Promise<TaskRun | null> {
  if (!message.runId) {
    return null;
  }

  const run = await services.runCheckpointStore.load(message.runId);

  if (!run || !run.checkpoint.pendingClarificationId) {
    return null;
  }

  const resumedRun = services.orchestrator.resumeFromClarification(run, {
    requestId: run.checkpoint.pendingClarificationId,
    runId: run.id,
    answer: message.text,
    respondedAt: message.createdAt
  });

  await services.runCheckpointStore.save(resumedRun);
  await services.workflowLogStore.append({
    id: `event_resume_${resumedRun.id}`,
    runId: resumedRun.id,
    type: "clarification_answered",
    summary: `Run resumed from message on ${message.channel}.`,
    createdAt: new Date().toISOString(),
    payload: {
      channel: message.channel
    }
  });

  return resumedRun;
}

