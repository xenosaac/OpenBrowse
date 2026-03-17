import React from "react";
import type { BrowserShellTabDescriptor } from "../../../shared/runtime";
import type { ManagementTab } from "../ManagementPanel";
import type { AddressBarSuggestion } from "../../hooks/useAddressBar";
import { colors, radii, glass } from "../../styles/tokens";

interface Props {
  activeBrowserTab: BrowserShellTabDescriptor | null;
  mainPanel: string;
  addressInput: string;
  addressEditing: boolean;
  navState: { canGoBack: boolean; canGoForward: boolean };
  displayUrl: string;
  isSecure: boolean;
  waitingCount: number;
  isBookmarked: boolean;
  suggestions: AddressBarSuggestion[];
  selectedIndex: number;
  onToggleBookmark: () => void;
  onAddressChange: (val: string) => void;
  onAddressFocus: () => void;
  onAddressBlur: () => void;
  onNavigate: (input: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onHome: () => void;
  onOpenManagement: (tab: ManagementTab) => void;
  onToggleMenu: (e: React.MouseEvent) => void;
  onMoveSelection: (delta: number) => void;
  onSetSelectedIndex: (index: number) => void;
  onSelectSuggestion: (suggestion: AddressBarSuggestion) => void;
  addressBarRef: React.RefObject<HTMLInputElement | null>;
  menuButtonRef: React.RefObject<HTMLButtonElement | null>;
}

export function NavBar(props: Props) {
  const {
    activeBrowserTab, mainPanel, addressInput, addressEditing,
    navState, displayUrl, isSecure, waitingCount,
    isBookmarked, suggestions, selectedIndex,
    onToggleBookmark,
    onAddressChange, onAddressFocus, onAddressBlur, onNavigate,
    onBack, onForward, onReload, onHome, onOpenManagement,
    onToggleMenu, onMoveSelection, onSetSelectedIndex, onSelectSuggestion,
    addressBarRef, menuButtonRef
  } = props;

  const showDropdown = addressEditing && suggestions.length > 0;

  return (
    <div style={styles.navBar}>
      <div style={styles.navButtons}>
        <button
          className="ob-btn"
          style={{
            ...styles.iconButton, WebkitAppRegion: "no-drag",
            ...(navState.canGoBack ? {} : { opacity: 0.3, cursor: "default", pointerEvents: "none" as const })
          } as React.CSSProperties}
          onClick={onBack}
        >←</button>
        <button
          className="ob-btn"
          style={{
            ...styles.iconButton, WebkitAppRegion: "no-drag",
            ...(navState.canGoForward ? {} : { opacity: 0.3, cursor: "default", pointerEvents: "none" as const })
          } as React.CSSProperties}
          onClick={onForward}
        >→</button>
        <button
          className="ob-btn"
          style={{ ...styles.iconButton, WebkitAppRegion: "no-drag" } as React.CSSProperties}
          onClick={onReload}
        >↻</button>
        <button
          className="ob-btn"
          style={{ ...styles.iconButton, WebkitAppRegion: "no-drag" } as React.CSSProperties}
          onClick={onHome}
        >⌂</button>
      </div>
      <div className="ob-address" style={{ ...styles.addressBarWrap, position: "relative" as const }}>
        <span style={{ ...styles.addressLock, color: isSecure ? colors.emerald : colors.textSecondary }}>
          {isSecure ? "🔒" : "●"}
        </span>
        <input
          ref={addressBarRef}
          type="text"
          value={addressEditing ? addressInput : displayUrl}
          placeholder="Search or enter address"
          onChange={(e) => onAddressChange(e.target.value)}
          onFocus={(e) => { onAddressChange(displayUrl); onAddressFocus(); requestAnimationFrame(() => e.target.select()); }}
          onBlur={() => {
            // Delay blur to allow click on suggestions
            setTimeout(() => onAddressBlur(), 150);
          }}
          onKeyDown={(e) => {
            if (showDropdown && e.key === "ArrowDown") {
              e.preventDefault();
              onMoveSelection(1);
              return;
            }
            if (showDropdown && e.key === "ArrowUp") {
              e.preventDefault();
              onMoveSelection(-1);
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
                onSelectSuggestion(suggestions[selectedIndex]);
              } else {
                onNavigate(addressInput);
              }
              e.currentTarget.blur();
              return;
            }
            if (e.key === "Escape") {
              onAddressBlur();
              e.currentTarget.blur();
            }
          }}
          style={{ ...styles.addressInput, WebkitAppRegion: "no-drag" } as React.CSSProperties}
        />
        {displayUrl && displayUrl !== "about:blank" && (
          <button
            className="ob-btn"
            style={{
              ...styles.bookmarkStar,
              color: isBookmarked ? colors.emerald : colors.textMuted,
            }}
            onClick={onToggleBookmark}
            title={isBookmarked ? "Remove bookmark" : "Add bookmark"}
          >
            {isBookmarked ? "★" : "☆"}
          </button>
        )}
        {showDropdown && (
          <div style={styles.dropdown}>
            {suggestions.map((s, i) => (
              <div
                key={s.url + i}
                style={{
                  ...styles.dropdownItem,
                  ...(i === selectedIndex ? styles.dropdownItemActive : {}),
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelectSuggestion(s);
                }}
                onMouseEnter={() => onSetSelectedIndex(i)}
              >
                <span style={styles.suggestionTitle}>{s.title || s.url}</span>
                <span style={styles.suggestionUrl}>{s.url}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={styles.headerActions}>
        <button
          className="ob-btn"
          style={{ ...styles.headerPill, WebkitAppRegion: "no-drag" } as React.CSSProperties}
          onClick={() => onOpenManagement("demos")}
        >Demos</button>
        {waitingCount > 0 && (
          <div style={styles.waitingPip}>
            <span style={styles.waitingDot} />{waitingCount}
          </div>
        )}
        <button
          className="ob-btn"
          onClick={() => onOpenManagement("config")}
          style={{ ...styles.iconButton, WebkitAppRegion: "no-drag" } as React.CSSProperties}
          title="Settings & Management"
        >⚙</button>
        <button
          ref={menuButtonRef}
          className="ob-btn"
          onClick={onToggleMenu}
          style={{ ...styles.iconButton, WebkitAppRegion: "no-drag", fontSize: 18 } as React.CSSProperties}
          title="More actions"
        >☰</button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  navBar: {
    display: "flex", alignItems: "center", gap: 8,
    padding: "7px 10px",
    background: "transparent",
    WebkitAppRegion: "drag",
  } as React.CSSProperties,
  navButtons: {
    display: "flex", alignItems: "center", gap: 3, WebkitAppRegion: "no-drag"
  } as React.CSSProperties,
  iconButton: {
    ...glass.control, color: colors.textSecondary, border: `1px solid ${colors.borderControl}`,
    borderRadius: radii.md, minWidth: 30, height: 30,
    display: "grid", placeItems: "center", cursor: "pointer", fontSize: "0.88rem"
  } as React.CSSProperties,
  addressBarWrap: {
    flex: 1, display: "flex", alignItems: "center", gap: 7, minWidth: 0,
    ...glass.input,
    border: `1px solid ${colors.borderDefault}`, borderRadius: radii.md,
    padding: "0 10px", height: 30, WebkitAppRegion: "no-drag"
  } as React.CSSProperties,
  addressLock: { fontSize: "0.68rem", flexShrink: 0 },
  addressInput: {
    flex: 1, background: "transparent", border: "none", outline: "none",
    color: colors.textPrimary, fontSize: "0.86rem", minWidth: 0
  },
  bookmarkStar: {
    background: "transparent", border: "none", cursor: "pointer",
    fontSize: "0.92rem", padding: "2px 4px", flexShrink: 0, lineHeight: 1,
  },
  headerActions: {
    display: "flex", alignItems: "center", gap: 5, WebkitAppRegion: "no-drag"
  } as React.CSSProperties,
  headerPill: {
    ...glass.control, color: colors.textPrimary, border: `1px solid ${colors.borderControl}`,
    borderRadius: 999, padding: "5px 11px", cursor: "pointer", fontSize: "0.8rem"
  } as React.CSSProperties,
  waitingPip: {
    display: "flex", alignItems: "center", gap: 5,
    background: colors.statusWaitingTint, border: "1px solid " + colors.statusWaitingBorder,
    borderRadius: 999, padding: "4px 9px", fontSize: "0.78rem", color: colors.statusWaiting
  },
  waitingDot: {
    width: 6, height: 6, borderRadius: "50%", background: colors.statusWaiting, display: "inline-block"
  },
  dropdown: {
    position: "absolute" as const,
    top: "100%",
    left: 0,
    right: 0,
    marginTop: 4,
    ...glass.control,
    background: "rgba(30, 30, 30, 0.95)",
    border: `1px solid ${colors.borderControl}`,
    borderRadius: radii.md,
    overflow: "hidden",
    zIndex: 1000,
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
  },
  dropdownItem: {
    padding: "7px 12px",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column" as const,
    gap: 1,
    borderBottom: `1px solid ${colors.borderSubtle}`,
  },
  dropdownItemActive: {
    background: "rgba(255, 255, 255, 0.08)",
  },
  suggestionTitle: {
    color: colors.textPrimary,
    fontSize: "0.84rem",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  suggestionUrl: {
    color: colors.textMuted,
    fontSize: "0.74rem",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
};
