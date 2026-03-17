import { useCallback, useEffect, useState } from "react";
import { colors, glass } from "../styles/tokens";

interface CookieEntry {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate?: number;
}

interface Props {
  activeSessionId: string | null;
}

export function CookiePanel({ activeSessionId }: Props) {
  const [cookies, setCookies] = useState<CookieEntry[]>([]);
  const [query, setQuery] = useState("");
  const [confirming, setConfirming] = useState(false);

  const refresh = useCallback(async () => {
    if (!activeSessionId) {
      setCookies([]);
      return;
    }
    const items = await window.openbrowse.listCookies(activeSessionId);
    setCookies(items as CookieEntry[]);
  }, [activeSessionId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const filtered = query
    ? cookies.filter(
        (c) =>
          c.name.toLowerCase().includes(query.toLowerCase()) ||
          c.domain.toLowerCase().includes(query.toLowerCase())
      )
    : cookies;

  const handleDelete = async (cookie: CookieEntry) => {
    if (!activeSessionId) return;
    const protocol = cookie.secure ? "https" : "http";
    const url = `${protocol}://${cookie.domain.replace(/^\./, "")}${cookie.path}`;
    await window.openbrowse.removeCookie(activeSessionId, url, cookie.name);
    void refresh();
  };

  const handleClearAll = async () => {
    if (!activeSessionId) return;
    if (!confirming) { setConfirming(true); return; }
    await window.openbrowse.removeAllCookies(activeSessionId);
    setConfirming(false);
    void refresh();
  };

  if (!activeSessionId) {
    return (
      <div style={styles.container}>
        <p style={styles.empty}>Open a browser tab to view its cookies.</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.topBar}>
        <input
          type="text"
          placeholder="Filter by name or domain..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={styles.search}
        />
        <button
          className="ob-btn"
          style={styles.refreshBtn}
          onClick={() => void refresh()}
        >
          Refresh
        </button>
        <button
          className="ob-btn"
          style={confirming ? styles.clearBtnConfirm : styles.clearBtn}
          onClick={() => void handleClearAll()}
        >
          {confirming ? "Confirm Clear" : "Clear All"}
        </button>
      </div>
      <div style={styles.countLabel}>{filtered.length} cookie{filtered.length !== 1 ? "s" : ""}</div>
      {filtered.length === 0 && (
        <p style={styles.empty}>{query ? "No cookies match your filter." : "No cookies stored for this tab."}</p>
      )}
      {filtered.map((cookie, i) => (
        <div key={`${cookie.domain}:${cookie.name}:${i}`} style={styles.row}>
          <div style={styles.info}>
            <div style={styles.nameRow}>
              <span style={styles.name}>{cookie.name}</span>
              {cookie.secure && <span style={styles.badge}>Secure</span>}
              {cookie.httpOnly && <span style={styles.badge}>HttpOnly</span>}
            </div>
            <span style={styles.value}>{cookie.value.length > 80 ? cookie.value.slice(0, 80) + "…" : cookie.value}</span>
            <span style={styles.domain}>{cookie.domain}{cookie.path}</span>
          </div>
          <button
            className="ob-btn"
            style={styles.deleteBtn}
            onClick={() => void handleDelete(cookie)}
            title="Delete cookie"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: "flex", flexDirection: "column", gap: 10 },
  topBar: { display: "flex", gap: 8, alignItems: "center" },
  search: {
    flex: 1,
    ...glass.input,
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: 8,
    padding: "8px 12px",
    color: colors.textPrimary,
    fontSize: "0.86rem",
    outline: "none",
  } as React.CSSProperties,
  refreshBtn: {
    ...glass.control,
    border: `1px solid ${colors.borderControl}`,
    color: colors.textSecondary,
    borderRadius: 8,
    padding: "7px 14px",
    cursor: "pointer",
    fontSize: "0.82rem",
    flexShrink: 0,
  },
  clearBtn: {
    ...glass.control,
    border: `1px solid ${colors.borderControl}`,
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
    color: colors.statusFailed,
    borderRadius: 8,
    padding: "7px 14px",
    cursor: "pointer",
    fontSize: "0.82rem",
    fontWeight: 600,
    flexShrink: 0,
  },
  countLabel: {
    fontSize: "0.76rem",
    color: colors.textMuted,
    letterSpacing: "0.04em",
  },
  empty: { color: colors.textMuted, fontSize: "0.84rem", textAlign: "center", padding: "24px 0" },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 10px",
    borderRadius: 10,
    ...glass.card,
    border: `1px solid ${colors.borderSubtle}`,
  } as React.CSSProperties,
  info: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 },
  nameRow: { display: "flex", alignItems: "center", gap: 6 },
  name: { fontSize: "0.84rem", color: colors.textPrimary, fontWeight: 600 },
  badge: {
    fontSize: "0.64rem",
    color: colors.emerald,
    border: `1px solid ${colors.emerald}`,
    borderRadius: 4,
    padding: "1px 4px",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
  },
  value: {
    fontSize: "0.72rem",
    color: colors.textMuted,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    fontFamily: "monospace",
  },
  domain: {
    fontSize: "0.72rem",
    color: colors.textMuted,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  deleteBtn: {
    background: "transparent",
    border: "none",
    color: colors.textMuted,
    cursor: "pointer",
    fontSize: "0.8rem",
    padding: "4px 8px",
    borderRadius: 6,
    flexShrink: 0,
  },
};
