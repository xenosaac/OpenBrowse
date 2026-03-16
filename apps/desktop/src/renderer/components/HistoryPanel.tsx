import { useCallback, useEffect, useState } from "react";
import { colors, glass } from "../styles/tokens";

interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  visitedAt: string;
}

function groupByDate(entries: HistoryEntry[]): Map<string, HistoryEntry[]> {
  const groups = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const day = new Date(entry.visitedAt).toLocaleDateString(undefined, {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
    const list = groups.get(day) ?? [];
    list.push(entry);
    groups.set(day, list);
  }
  return groups;
}

export function HistoryPanel() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [confirming, setConfirming] = useState(false);

  const refresh = useCallback(async () => {
    const items = query
      ? await window.openbrowse.searchHistory(query)
      : await window.openbrowse.listHistory(200);
    setEntries(items as HistoryEntry[]);
  }, [query]);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleClearAll = async () => {
    if (!confirming) { setConfirming(true); return; }
    await window.openbrowse.clearHistory();
    setConfirming(false);
    void refresh();
  };

  const grouped = groupByDate(entries);

  return (
    <div style={styles.container}>
      <div style={styles.topBar}>
        <input
          type="text"
          placeholder="Search history..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={styles.search}
        />
        <button
          className="ob-btn"
          style={confirming ? styles.clearBtnConfirm : styles.clearBtn}
          onClick={() => void handleClearAll()}
        >
          {confirming ? "Confirm Clear" : "Clear All"}
        </button>
      </div>
      {entries.length === 0 && (
        <p style={styles.empty}>{query ? "No history matches your search." : "No browsing history yet."}</p>
      )}
      {[...grouped.entries()].map(([day, items]) => (
        <div key={day} style={styles.dayGroup}>
          <div style={styles.dayLabel}>{day}</div>
          {items.map((entry) => (
            <div key={entry.id} style={styles.row}>
              <span style={styles.time}>
                {new Date(entry.visitedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
              </span>
              <div style={styles.info}>
                <span style={styles.title}>{entry.title}</span>
                <span style={styles.url}>{entry.url}</span>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: "flex", flexDirection: "column", gap: 14 },
  topBar: { display: "flex", gap: 8, alignItems: "center" },
  search: {
    flex: 1,
    ...glass.input,
    border: `1px solid ${colors.borderGlass}`,
    borderRadius: 8,
    padding: "8px 12px",
    color: colors.textPrimary,
    fontSize: "0.86rem",
    outline: "none",
  } as React.CSSProperties,
  clearBtn: {
    background: colors.buttonBg,
    border: `1px solid ${colors.borderGlass}`,
    color: colors.textSecondary,
    borderRadius: 8,
    padding: "7px 14px",
    cursor: "pointer",
    fontSize: "0.82rem",
    flexShrink: 0,
  },
  clearBtnConfirm: {
    background: "rgba(239,68,68,0.15)",
    border: "1px solid rgba(239,68,68,0.3)",
    color: "#ef4444",
    borderRadius: 8,
    padding: "7px 14px",
    cursor: "pointer",
    fontSize: "0.82rem",
    fontWeight: 600,
    flexShrink: 0,
  },
  empty: { color: colors.textMuted, fontSize: "0.84rem", textAlign: "center", padding: "24px 0" },
  dayGroup: { display: "flex", flexDirection: "column", gap: 4 },
  dayLabel: {
    fontSize: "0.76rem",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    fontWeight: 600,
    padding: "4px 2px",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "7px 10px",
    borderRadius: 10,
    ...glass.card,
    border: `1px solid ${colors.borderSubtle}`,
  } as React.CSSProperties,
  time: { fontSize: "0.72rem", color: colors.textMuted, flexShrink: 0, width: 48 },
  info: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 },
  title: { fontSize: "0.84rem", color: colors.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const },
  url: { fontSize: "0.72rem", color: colors.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const },
};
