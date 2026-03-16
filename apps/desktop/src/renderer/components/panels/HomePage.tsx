import React from "react";
import type { BrowserShellTabDescriptor } from "../../../shared/runtime";
import { colors, radii, glass, shadows } from "../../styles/tokens";

interface Props {
  shellTabs: BrowserShellTabDescriptor[];
  tabFavicons: Record<string, string>;
  onOpenTab: (tab: BrowserShellTabDescriptor) => void;
}

export function HomePage({ shellTabs, tabFavicons, onOpenTab }: Props) {
  const recentTabs = shellTabs
    .filter((tab) => tab.url && tab.url !== "about:blank")
    .filter((tab, i, arr) => arr.findIndex((t) => t.url === tab.url) === i);

  return (
    <div style={styles.page}>
      <div style={styles.recentSection}>
        <div style={styles.eyebrow}>Recent</div>
        {recentTabs.length === 0 ? (
          <div style={styles.emptyHint}>
            No browser tabs yet. Press <kbd style={styles.kbd}>+</kbd> or type an address above.
          </div>
        ) : (
          <div style={styles.recentGrid}>
            {recentTabs.map((tab) => (
              <button key={tab.groupId} onClick={() => onOpenTab(tab)} style={styles.recentCard} className="ob-card ob-glass-panel">
                <div style={styles.recentFavicon}>
                  {tabFavicons[tab.id] ? (
                    <img
                      src={tabFavicons[tab.id]}
                      alt=""
                      width={18}
                      height={18}
                      style={{ borderRadius: 3 }}
                      onError={(e) => { (e.target as HTMLImageElement).replaceWith(document.createTextNode("\u2299")); }}
                    />
                  ) : "\u2299"}
                </div>
                <div style={styles.recentInfo}>
                  <div style={styles.recentTitle}>{tab.title || "Untitled"}</div>
                  <div style={styles.recentUrl}>{tab.url}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    height: "100%", overflow: "auto", padding: "40px 32px 32px",
    background: colors.bgBase
  },
  recentSection: { maxWidth: 860, margin: "0 auto" },
  eyebrow: {
    fontSize: "0.78rem", color: colors.textSecondary,
    textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14
  },
  emptyHint: {
    ...glass.card, border: "1px solid " + colors.borderSubtle,
    borderRadius: 14, padding: "18px 20px", color: colors.textSecondary, fontSize: "0.9rem"
  } as React.CSSProperties,
  recentGrid: {
    display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10
  },
  recentCard: {
    ...glass.card, display: "flex", alignItems: "center", gap: 12,
    border: "1px solid " + colors.borderSubtle, boxShadow: shadows.glassSubtle,
    borderRadius: 14, padding: "12px 16px", cursor: "pointer",
    textAlign: "left", color: colors.textPrimary
  } as React.CSSProperties,
  recentFavicon: { fontSize: "1.1rem", color: colors.emerald, flexShrink: 0 },
  recentInfo: { minWidth: 0 },
  recentTitle: {
    fontSize: "0.9rem", fontWeight: 600, color: colors.textWhite,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
  },
  recentUrl: {
    fontSize: "0.78rem", color: colors.textSecondary, marginTop: 3,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
  },
  kbd: {
    ...glass.input, border: "1px solid " + colors.borderGlass,
    borderRadius: 4, padding: "1px 5px", fontSize: "0.82rem", color: colors.textPrimary
  } as React.CSSProperties
};
