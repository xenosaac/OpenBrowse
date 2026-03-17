import { useEffect, useState } from "react";
import { colors, glass } from "../styles/tokens";
import { ipc } from "../lib/ipc";

interface TaskTemplate {
  id: string;
  name: string;
  goal: string;
  createdAt: string;
}

interface Props {
  onRunTemplate?: (goal: string) => void;
}

export function TemplatesPanel({ onRunTemplate }: Props) {
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    ipc.templates.list().then((result) => {
      setTemplates(result);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  const handleDelete = async (templateId: string) => {
    await ipc.templates.delete(templateId);
    refresh();
  };

  const handleRun = (goal: string) => {
    if (onRunTemplate) onRunTemplate(goal);
  };

  if (loading) {
    return <p style={{ color: colors.textSecondary }}>Loading templates...</p>;
  }

  return (
    <div style={styles.container}>
      {templates.length === 0 ? (
        <div style={styles.emptyState}>
          <p style={styles.emptyTitle}>No saved templates</p>
          <p style={styles.emptyHint}>
            Complete a task, then click "Save as Template" on the result to save it for quick re-use.
          </p>
        </div>
      ) : (
        <div style={styles.list}>
          <span style={styles.sectionTitle}>Saved Templates ({templates.length})</span>
          {templates.map((t) => (
            <div key={t.id} style={styles.card} className="ob-card">
              <div style={styles.row}>
                <span style={styles.name}>{t.name}</span>
                <div style={styles.actions}>
                  {onRunTemplate && (
                    <button
                      onClick={() => handleRun(t.goal)}
                      style={styles.runBtn}
                    >
                      Run
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(t.id)}
                    style={styles.deleteBtn}
                    title="Delete template"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {t.name !== t.goal && (
                <p style={styles.goal}>{t.goal}</p>
              )}
              <span style={styles.meta}>
                Saved {new Date(t.createdAt).toLocaleDateString(undefined, {
                  month: "short", day: "numeric", year: "numeric"
                })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  emptyState: {
    textAlign: "center",
    padding: "32px 16px",
  },
  emptyTitle: {
    fontSize: "0.92rem",
    color: colors.textPrimary,
    fontWeight: 600,
    margin: 0,
  },
  emptyHint: {
    fontSize: "0.82rem",
    color: colors.textSecondary,
    margin: "8px 0 0",
    lineHeight: 1.45,
  },
  sectionTitle: {
    fontSize: "0.82rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: colors.textSecondary,
    marginBottom: 4,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  card: {
    ...glass.card,
    borderRadius: 12,
    padding: "10px 14px",
    border: `1px solid ${colors.borderSubtle}`,
  } as React.CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  name: {
    fontSize: "0.88rem",
    fontWeight: 600,
    color: colors.textPrimary,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
    flex: 1,
  },
  actions: {
    display: "flex",
    gap: 6,
    flexShrink: 0,
  },
  runBtn: {
    ...glass.emerald,
    color: colors.textWhite,
    border: `1px solid ${colors.emeraldBorder}`,
    borderRadius: 6,
    padding: "3px 12px",
    cursor: "pointer",
    fontSize: "0.76rem",
    fontWeight: 600,
  } as React.CSSProperties,
  deleteBtn: {
    ...glass.control,
    border: `1px solid ${colors.borderControl}`,
    color: colors.statusFailed,
    borderRadius: 6,
    padding: "3px 10px",
    cursor: "pointer",
    fontSize: "0.76rem",
  } as React.CSSProperties,
  goal: {
    fontSize: "0.82rem",
    color: colors.textSecondary,
    margin: "4px 0 0",
    lineHeight: 1.4,
  },
  meta: {
    fontSize: "0.76rem",
    color: colors.textMuted,
    marginTop: 4,
    display: "block",
  },
};
