import { useState } from "react";
import type { TaskRun } from "@openbrowse/contracts";

interface Props {
  runs: TaskRun[];
  onResume: (run: TaskRun | null) => void | Promise<void>;
}

export function RemoteQuestions({ runs, onResume }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  if (runs.length === 0) {
    return <p style={{ color: "#9090a8" }}>No pending questions.</p>;
  }

  const getAnswer = (runId: string): string => answers[runId] ?? "";

  const setAnswer = (runId: string, value: string): void => {
    setAnswers((current) => ({
      ...current,
      [runId]: value
    }));
  };

  const handleResume = async (run: TaskRun, channel: "desktop" | "telegram" = "desktop") => {
    const answer = getAnswer(run.id).trim();
    if (!answer) return;
    setBusy(run.id);
    try {
      const resumedRun = (await window.openbrowse.resumeTask({
        id: `desktop_${Date.now()}`,
        channel,
        runId: run.id,
        text: answer,
        createdAt: new Date().toISOString()
      })) as TaskRun | null;
      if (
        resumedRun &&
        resumedRun.status !== "suspended_for_clarification" &&
        resumedRun.status !== "suspended_for_approval"
      ) {
        setAnswers((current) => {
          const next = { ...current };
          delete next[run.id];
          return next;
        });
      }
      await onResume(resumedRun);
    } catch (err) {
      console.error("[RemoteQuestions] Failed to resume task:", err);
    } finally {
      setBusy(null);
    }
  };

  const handleQuickApproval = async (run: TaskRun, answer: "approve" | "deny") => {
    setBusy(run.id);
    try {
      const resumedRun = (await window.openbrowse.resumeTask({
        id: `desktop_${Date.now()}`,
        channel: "desktop",
        runId: run.id,
        text: answer,
        createdAt: new Date().toISOString()
      })) as TaskRun | null;
      await onResume(resumedRun);
    } catch (err) {
      console.error("[RemoteQuestions] Quick approval failed:", err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      {runs.map((run) => (
        <div key={run.id} style={styles.card}>
          <strong>{run.goal}</strong>
          {run.suspension && (
            <p style={styles.question}>{run.suspension.question}</p>
          )}
          {run.suspension?.type === "approval" && (
            <div style={styles.quickActions}>
              <button
                onClick={() => handleQuickApproval(run, "approve")}
                disabled={busy === run.id}
                style={{ ...styles.button, ...styles.approveButton }}
              >
                Approve
              </button>
              <button
                onClick={() => handleQuickApproval(run, "deny")}
                disabled={busy === run.id}
                style={{ ...styles.button, ...styles.denyButton }}
              >
                Deny
              </button>
            </div>
          )}
          <div style={styles.form}>
            <input
              type="text"
              value={getAnswer(run.id)}
              onChange={(e) => setAnswer(run.id, e.target.value)}
              placeholder={run.suspension?.type === "approval" ? "Type approve / deny..." : "Type your answer..."}
              style={styles.input}
              onKeyDown={(e) => e.key === "Enter" && handleResume(run)}
              disabled={busy === run.id}
            />
            <button
              onClick={() => handleResume(run, "desktop")}
              disabled={busy === run.id}
              style={styles.button}
            >
              {busy === run.id ? "Resuming..." : "Resume"}
            </button>
            <button
              onClick={() => handleResume(run, "telegram")}
              disabled={busy === run.id}
              style={{ ...styles.button, ...styles.telegramButton }}
            >
              Fake Telegram
            </button>
          </div>
          {busy === run.id && (
            <p style={styles.pendingNote}>
              Resuming this run and refreshing Browser/Workflow Log...
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: "#151522",
    borderRadius: 14,
    padding: "12px 14px",
    marginBottom: 8,
    border: "1px solid #4b2d12"
  },
  question: {
    color: "#fbbf24",
    fontSize: "0.9rem",
    margin: "8px 0"
  },
  form: {
    display: "flex",
    gap: 8,
    marginTop: 8
  },
  quickActions: {
    display: "flex",
    gap: 8,
    marginTop: 8
  },
  input: {
    flex: 1,
    background: "#1e1e2e",
    border: "1px solid #2a2a3e",
    borderRadius: 10,
    padding: "10px 12px",
    color: "#f5f5ff",
    fontSize: "0.9rem"
  },
  button: {
    background: "#7c3aed",
    color: "#fffdf9",
    border: "1px solid #8b5cf6",
    borderRadius: 10,
    padding: "8px 14px",
    cursor: "pointer",
    fontSize: "0.9rem"
  },
  telegramButton: {
    background: "#995f27"
  },
  approveButton: {
    background: "#15803d"
  },
  denyButton: {
    background: "#b91c1c"
  },
  pendingNote: {
    margin: "8px 0 0",
    color: "#9090a8",
    fontSize: "0.82rem"
  }
};
