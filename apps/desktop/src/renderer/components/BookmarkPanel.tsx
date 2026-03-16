import { useCallback, useEffect, useState } from "react";
import { colors, glass } from "../styles/tokens";

interface Bookmark {
  id: string;
  url: string;
  title: string;
  faviconUrl?: string;
  createdAt: string;
}

export function BookmarkPanel() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [query, setQuery] = useState("");

  const refresh = useCallback(async () => {
    const items = query
      ? await window.openbrowse.searchBookmarks(query)
      : await window.openbrowse.listBookmarks();
    setBookmarks(items as Bookmark[]);
  }, [query]);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleDelete = async (id: string) => {
    await window.openbrowse.deleteBookmark(id);
    void refresh();
  };

  return (
    <div style={styles.container}>
      <input
        type="text"
        placeholder="Search bookmarks..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={styles.search}
      />
      {bookmarks.length === 0 && (
        <p style={styles.empty}>{query ? "No bookmarks match your search." : "No bookmarks yet."}</p>
      )}
      <div style={styles.list}>
        {bookmarks.map((b) => (
          <div key={b.id} style={styles.row}>
            <span style={styles.favicon}>
              {b.faviconUrl ? <img src={b.faviconUrl} width={14} height={14} alt="" /> : "●"}
            </span>
            <div style={styles.info}>
              <span style={styles.title}>{b.title}</span>
              <span style={styles.url}>{b.url}</span>
            </div>
            <button style={styles.deleteBtn} className="ob-btn" onClick={() => void handleDelete(b.id)}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: "flex", flexDirection: "column", gap: 12 },
  search: {
    ...glass.input,
    border: `1px solid ${colors.borderGlass}`,
    borderRadius: 8,
    padding: "8px 12px",
    color: colors.textPrimary,
    fontSize: "0.86rem",
    outline: "none",
  } as React.CSSProperties,
  empty: { color: colors.textMuted, fontSize: "0.84rem", textAlign: "center", padding: "24px 0" },
  list: { display: "flex", flexDirection: "column", gap: 4 },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 10px",
    borderRadius: 10,
    ...glass.card,
    border: `1px solid ${colors.borderGlass}`,
  } as React.CSSProperties,
  favicon: { fontSize: "0.7rem", color: colors.textMuted, flexShrink: 0, width: 16, textAlign: "center" },
  info: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 },
  title: { fontSize: "0.84rem", color: colors.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const },
  url: { fontSize: "0.72rem", color: colors.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const },
  deleteBtn: {
    background: "transparent",
    border: "none",
    color: colors.textMuted,
    cursor: "pointer",
    fontSize: "0.76rem",
    padding: "4px 6px",
    borderRadius: 6,
    flexShrink: 0,
  },
};
