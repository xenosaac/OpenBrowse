import type { TaskRun } from "@openbrowse/contracts";
import { buildHandoffArtifact, renderHandoffMarkdown } from "@openbrowse/observability";
import type { RuntimeServices } from "./types.js";

export interface BotCommandResult {
  responses: string[];
}

/**
 * Pure command handler for bot commands (/status, /list, /cancel, /handoff).
 * Extracted from wireBotCommands so it can be tested without TelegramChatBridge.
 *
 * @param cancelRunFn — injectable cancel function (defaults to inline cancel logic)
 */
export async function handleBotCommand(
  services: RuntimeServices,
  command: string,
  args: string,
  cancelRunFn?: (services: RuntimeServices, runId: string, summary: string) => Promise<TaskRun | null>
): Promise<BotCommandResult> {
  const responses: string[] = [];
  const respond = (text: string) => { responses.push(text); };

  switch (command) {
    case "status": {
      const runs = await services.runCheckpointStore.listAll();
      const active = runs.filter(
        (r) => r.status === "running" || r.status.startsWith("suspended")
      );
      if (active.length === 0) {
        respond("No active runs.");
        break;
      }
      const lines = active.map((r) => {
        const emoji = r.status === "running" ? "\u2699" : "\u23F8";
        const steps = r.checkpoint.stepCount ?? 0;
        const url = r.checkpoint.lastKnownUrl
          ? ` \u2014 ${r.checkpoint.lastKnownUrl.slice(0, 50)}`
          : "";
        return `${emoji} \`${r.id.slice(0, 12)}\` ${r.goal.slice(0, 40)} (step ${steps}${url})`;
      });
      respond(`Active runs:\n${lines.join("\n")}`);
      break;
    }

    case "list": {
      const n = Math.min(parseInt(args) || 5, 20);
      const all = await services.runCheckpointStore.listAll();
      const recent = all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, n);
      if (recent.length === 0) {
        respond("No runs yet.");
        break;
      }
      const statusEmoji: Record<string, string> = {
        running: "\u2699", completed: "\u2713", failed: "\u2717",
        cancelled: "\u2298", suspended_for_clarification: "\u23F8",
        suspended_for_approval: "\u23F8", queued: "\u23F3"
      };
      const lines = recent.map((r) => {
        const e = statusEmoji[r.status] ?? "?";
        return `${e} \`${r.id.slice(0, 12)}\` ${r.goal.slice(0, 50)}`;
      });
      respond(`Recent runs:\n${lines.join("\n")}`);
      break;
    }

    case "cancel": {
      if (!cancelRunFn) {
        respond("Cancel not available.");
        break;
      }
      const targetId = args.trim() || null;
      if (!targetId) {
        const all = await services.runCheckpointStore.listAll();
        const running = all
          .filter((r) => r.status === "running")
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        if (running.length === 0) {
          respond("No running tasks to cancel.");
          break;
        }
        const target = running[0];
        const cancelled = await cancelRunFn(services, target.id, "Cancelled by remote operator.");
        respond(
          cancelled
            ? `Cancelled: "${target.goal.slice(0, 60)}"`
            : "Failed to cancel the run."
        );
        break;
      }
      const cancelled = await cancelRunFn(services, targetId, "Cancelled by remote operator.");
      if (!cancelled) {
        respond(`Run not found: ${targetId}`);
        break;
      }
      respond(`Cancelled: "${cancelled.goal.slice(0, 60)}"`);
      break;
    }

    case "handoff": {
      const targetId = args.trim() || null;
      let run: TaskRun | null = null;
      if (targetId) {
        run = await services.runCheckpointStore.load(targetId);
      } else {
        const all = await services.runCheckpointStore.listAll();
        const terminal = all
          .filter((r) => ["completed", "failed", "cancelled"].includes(r.status))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        run = terminal[0] ?? null;
      }
      if (!run) {
        respond("Run not found.");
        break;
      }
      const artifact = buildHandoffArtifact(run);
      const md = renderHandoffMarkdown(artifact);
      for (let i = 0; i < md.length; i += 4000) {
        respond(md.slice(i, i + 4000));
      }
      break;
    }

    default:
      respond(`Unknown command: /${command}`);
  }

  return { responses };
}
