import { useState } from "react";
import type { TaskRun } from "@openbrowse/contracts";
import { colors, glass, shadows } from "../styles/tokens";

interface Props {
  runs: TaskRun[];
  onResume: (run: TaskRun | null) => void | Promise<void>;
  onDismiss: (runId: string) => void | Promise<void>;
}

const RISK_CLASS_LABELS: Record<string, string> = {
  financial: "Financial Transaction",
  credential: "Credential / Sensitive Data",
  destructive: "Destructive Action",
  submission: "Form Submission",
  navigation: "Navigation",
  general: "General"
};

const RISK_CLASS_COLORS: Record<string, string> = {
  financial: "#ef4444",
  credential: "#f59e0b",
  destructive: "#dc2626",
  submission: colors.emerald,
  navigation: "#06b6d4",
  general: "#6b7280"
};

export function RemoteQuestions({ runs, onResume, onDismiss }: Props) {
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
      {runs.map((run) => {
        const riskClass = run.suspension?.riskClass;
        const borderColor = riskClass
          ? RISK_CLASS_COLORS[riskClass] + "40"
          : "rgba(245,158,11,0.25)";

        return (
          <div key={run.id} style={{ ...styles.card, borderColor, position: "relative" as const }}>
            <button onClick={() => void onDismiss(run.id)} disabled={busy === run.id}
              style={styles.dismissButton} title="Dismiss and cancel this task">✕</button>
            <strong>{run.goal}</strong>
            {run.suspension?.type === "approval" && riskClass && (
              <span style={{
                display: "inline-block",
                background: RISK_CLASS_COLORS[riskClass] + "22",
                border: `1px solid ${RISK_CLASS_COLORS[riskClass]}55`,
                color: RISK_CLASS_COLORS[riskClass],
                borderRadius: 8,
                padding: "2px 10px",
                fontSize: "0.78rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                marginLeft: 8
              }}>
                {RISK_CLASS_LABELS[riskClass] ?? riskClass}
              </span>
            )}
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
              <div style={styles.formButtons}>
                <button
                  onClick={() => handleResume(run, "desktop")}
                  disabled={busy === run.id}
                  style={styles.button}
                  className="ob-btn-primary"
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
            </div>
            {busy === run.id && (
              <p style={styles.pendingNote}>
                Resuming this run and refreshing Browser/Workflow Log...
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    ...glass.card,
    borderRadius: 14,
    padding: "12px 14px",
    marginBottom: 8,
    border: "1px solid " + colors.borderGlass
  } as React.CSSProperties,
  question: {
    color: "#fbbf24",
    fontSize: "0.9rem",
    margin: "8px 0"
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginTop: 8
  },
  formButtons: {
    display: "flex",
    gap: 8
  },
  quickActions: {
    display: "flex",
    gap: 8,
    marginTop: 8
  },
  input: {
    ...glass.input,
    flex: 1,
    border: "1px solid " + colors.borderGlass,
    borderRadius: 10,
    padding: "10px 12px",
    color: "#f5f5ff",
    fontSize: "0.9rem"
  } as React.CSSProperties,
  button: {
    background: colors.emerald,
    color: "#fffdf9",
    border: "1px solid " + colors.emeraldBorderHover,
    borderRadius: 10,
    padding: "8px 10px",
    cursor: "pointer",
    fontSize: "0.9rem",
    whiteSpace: "nowrap" as const,
    flexShrink: 0
  },
  telegramButton: {
    background: "#0e7490",
    borderColor: "#06b6d4"
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
  },
  dismissButton: {
    position: "absolute" as const,
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 6,
    background: "rgba(239,68,68,0.12)",
    border: "1px solid rgba(239,68,68,0.25)",
    color: "#ef4444",
    cursor: "pointer",
    fontSize: "0.72rem",
    display: "grid",
    placeItems: "center"
  }
};
