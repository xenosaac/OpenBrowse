import { useState } from "react";
import type { TaskRun } from "@openbrowse/contracts";
import type { RuntimeDescriptor } from "../../shared/runtime";

interface Props {
  onStarted: (run: TaskRun) => void | Promise<void>;
  onOpenSettings: () => void;
  runtime: RuntimeDescriptor | null;
}

export function TaskStartForm({ onStarted, onOpenSettings, runtime }: Props) {
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plannerReady = runtime?.planner.mode === "live";
  const runtimeReady = runtime !== null;

  const handleStart = async () => {
    if (!goal.trim() || busy) return;
    if (!runtimeReady) {
      setError("Runtime is still loading. Wait a second and try again.");
      return;
    }
    if (!plannerReady) {
      setError("Configure your Anthropic API key in Settings to enable freeform browser tasks.");
      onOpenSettings();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const run = (await window.openbrowse.startTask({
        id: `task_${Date.now()}`,
        source: "desktop",
        goal: goal.trim(),
        constraints: [],
        metadata: {}
      })) as TaskRun;
      setGoal("");
      await onStarted(run);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={styles.form}>
        <input
          type="text"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Describe a browser task or use the Demos tab for scripted flows..."
          style={styles.input}
          onKeyDown={(e) => e.key === "Enter" && handleStart()}
        />
        <button onClick={handleStart} disabled={busy || !runtimeReady} style={styles.button}>
          {busy ? "Starting..." : plannerReady ? "Start" : "Configure AI"}
        </button>
      </div>
      <p style={styles.hint}>
        {plannerReady
          ? "Freeform tasks use the shared runtime; scripted demo flows live in the Demos tab."
          : "Add your Anthropic API key and planner model in Settings; scripted demo flows still live in the Demos tab."}
      </p>
      {error && <p style={styles.error}>{error}</p>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  form: {
    display: "flex",
    gap: 10,
    flexDirection: "column"
  },
  input: {
    width: "100%",
    background: "#1e1e2e",
    border: "1px solid #2a2a3e",
    borderRadius: 14,
    padding: "12px 14px",
    color: "#f5f5ff",
    fontSize: "0.92rem"
  },
  button: {
    background: "linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)",
    color: "#fffdf9",
    border: "1px solid #8b5cf6",
    borderRadius: 14,
    padding: "12px 16px",
    cursor: "pointer",
    fontSize: "0.9rem",
    fontWeight: 700
  },
  hint: {
    margin: "6px 0 0",
    fontSize: "0.78rem",
    color: "#8f90a6",
    lineHeight: 1.45
  },
  error: {
    margin: "6px 0 0",
    fontSize: "0.8rem",
    color: "#fca5a5"
  }
};
