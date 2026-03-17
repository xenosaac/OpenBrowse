import { useCallback, useEffect, useState } from "react";
import type { TaskRun } from "@openbrowse/contracts";
import { colors, glass, shadows } from "../styles/tokens";

interface Props {
  selectedRunId: string | null;
  runs: TaskRun[];
  onSelectRun: (runId: string) => void;
}

export function HandoffViewer({ selectedRunId, runs, onSelectRun }: Props) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!selectedRunId) {
      setMarkdown(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    window.openbrowse
      .getRunHandoff(selectedRunId)
      .then((result) => {
        if (!cancelled) setMarkdown(result?.markdown ?? null);
      })
      .catch(() => {
        if (!cancelled) setMarkdown(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedRunId]);

  const handleCopy = useCallback(() => {
    if (!markdown) return;
    void navigator.clipboard.writeText(markdown).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [markdown]);

  return (
    <div style={styles.root}>
      <div style={styles.toolbar}>
        <div style={styles.selector}>
          <label style={{ color: colors.textSecondary, fontSize: "0.85rem" }}>Run: </label>
          <select
            value={selectedRunId ?? ""}
            onChange={(e) => onSelectRun(e.target.value)}
            style={styles.select}
          >
            <option value="">Select a run...</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id} - {r.goal.slice(0, 40)}
              </option>
            ))}
          </select>
        </div>
        {markdown && (
          <button
            onClick={handleCopy}
            className="ob-btn"
            style={{
              ...styles.copyBtn,
              ...(copied ? styles.copyBtnCopied : {})
            }}
          >
            {copied ? "Copied!" : "Copy to Clipboard"}
          </button>
        )}
      </div>

      {loading && <p style={styles.hint}>Loading handoff…</p>}

      {!loading && !selectedRunId && (
        <p style={styles.hint}>Select a run from Live Tasks to view its handoff.</p>
      )}

      {!loading && selectedRunId && markdown === null && (
        <p style={styles.hint}>No handoff data available for this run.</p>
      )}

      {!loading && markdown && (
        <pre style={styles.pre}>{markdown}</pre>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    minHeight: 0
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  selector: {
    display: "flex",
    alignItems: "center",
    gap: 8
  },
  select: {
    ...glass.input,
    color: colors.textBright,
    border: "1px solid " + colors.borderDefault,
    borderRadius: 8,
    padding: "4px 8px",
    fontSize: "0.85rem"
  } as React.CSSProperties,
  copyBtn: {
    background: colors.bgElevated,
    border: "1px solid " + colors.borderDefault,
    color: colors.textSecondary,
    borderRadius: 8,
    padding: "6px 14px",
    cursor: "pointer",
    fontSize: "0.84rem",
    flexShrink: 0
  },
  copyBtnCopied: {
    background: "rgba(34,197,94,0.15)",
    borderColor: "rgba(34,197,94,0.4)",
    color: colors.emeraldHover
  },
  hint: {
    color: colors.textSecondary,
    margin: 0
  },
  pre: {
    ...glass.input,
    border: "1px solid " + colors.borderDefault,
    borderRadius: 14,
    padding: "14px 16px",
    fontFamily: "monospace",
    fontSize: "0.84rem",
    color: colors.textPrimary,
    whiteSpace: "pre-wrap",
    overflow: "auto",
    margin: 0
  } as React.CSSProperties
};
