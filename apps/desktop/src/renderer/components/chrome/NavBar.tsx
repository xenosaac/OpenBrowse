import React, { useRef, forwardRef } from "react";
import type { BrowserShellTabDescriptor } from "../../../shared/runtime";
import type { ManagementTab } from "../ManagementPanel";

interface Props {
  activeBrowserTab: BrowserShellTabDescriptor | null;
  mainPanel: string;
  addressInput: string;
  addressEditing: boolean;
  navState: { canGoBack: boolean; canGoForward: boolean };
  displayUrl: string;
  isSecure: boolean;
  waitingCount: number;
  menuOpen: boolean;
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
  addressBarRef: React.RefObject<HTMLInputElement | null>;
  menuContent: React.ReactNode;
}

export function NavBar(props: Props) {
  const {
    activeBrowserTab, mainPanel, addressInput, addressEditing,
    navState, displayUrl, isSecure, waitingCount, menuOpen,
    onAddressChange, onAddressFocus, onAddressBlur, onNavigate,
    onBack, onForward, onReload, onHome, onOpenManagement,
    onToggleMenu, addressBarRef, menuContent
  } = props;

  return (
    <div style={styles.navBar}>
      <div style={styles.navButtons}>
        <button
          style={{
            ...styles.iconButton, WebkitAppRegion: "no-drag",
            ...(navState.canGoBack ? {} : { opacity: 0.3, cursor: "default", pointerEvents: "none" as const })
          } as React.CSSProperties}
          onClick={onBack}
        >←</button>
        <button
          style={{
            ...styles.iconButton, WebkitAppRegion: "no-drag",
            ...(navState.canGoForward ? {} : { opacity: 0.3, cursor: "default", pointerEvents: "none" as const })
          } as React.CSSProperties}
          onClick={onForward}
        >→</button>
        <button
          style={{ ...styles.iconButton, WebkitAppRegion: "no-drag" } as React.CSSProperties}
          onClick={onReload}
        >↻</button>
        <button
          style={{ ...styles.iconButton, WebkitAppRegion: "no-drag" } as React.CSSProperties}
          onClick={onHome}
        >⌂</button>
      </div>
      <div style={styles.addressBarWrap}>
        <span style={{ ...styles.addressLock, color: isSecure ? "#22c55e" : "#9090a8" }}>
          {isSecure ? "🔒" : "●"}
        </span>
        <input
          ref={addressBarRef}
          type="text"
          value={addressEditing ? addressInput : displayUrl}
          placeholder="Search or enter address"
          onChange={(e) => onAddressChange(e.target.value)}
          onFocus={() => { onAddressChange(displayUrl); onAddressFocus(); }}
          onBlur={onAddressBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onNavigate(addressInput);
              e.currentTarget.blur();
            }
            if (e.key === "Escape") {
              onAddressBlur();
              e.currentTarget.blur();
            }
          }}
          style={{ ...styles.addressInput, WebkitAppRegion: "no-drag" } as React.CSSProperties}
        />
      </div>
      <div style={styles.headerActions}>
        <button
          style={{ ...styles.headerPill, WebkitAppRegion: "no-drag" } as React.CSSProperties}
          onClick={() => onOpenManagement("demos")}
        >Demos</button>
        {waitingCount > 0 && (
          <div style={styles.waitingPip}>
            <span style={styles.waitingDot} />{waitingCount}
          </div>
        )}
        <button
          onClick={() => onOpenManagement("config")}
          style={{ ...styles.iconButton, WebkitAppRegion: "no-drag" } as React.CSSProperties}
          title="Settings & Management"
        >⚙</button>
        <div style={{ position: "relative" }}>
          <button
            onClick={onToggleMenu}
            style={{ ...styles.iconButton, WebkitAppRegion: "no-drag", fontSize: 18 } as React.CSSProperties}
            title="More actions"
          >☰</button>
          {menuOpen && menuContent}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  navBar: {
    display: "flex", alignItems: "center", gap: 8,
    padding: "7px 10px", background: "#12121a",
    borderBottom: "1px solid #2a2a3e", WebkitAppRegion: "drag"
  } as React.CSSProperties,
  navButtons: {
    display: "flex", alignItems: "center", gap: 3, WebkitAppRegion: "no-drag"
  } as React.CSSProperties,
  iconButton: {
    background: "#1a1a26", color: "#cbd5e1", border: "1px solid #2a2a3e",
    borderRadius: 9, minWidth: 30, height: 30,
    display: "grid", placeItems: "center", cursor: "pointer", fontSize: "0.88rem"
  },
  addressBarWrap: {
    flex: 1, display: "flex", alignItems: "center", gap: 7, minWidth: 0,
    background: "#1e1e2e", border: "1px solid #2a2a3e", borderRadius: 9,
    padding: "0 10px", height: 30, WebkitAppRegion: "no-drag"
  } as React.CSSProperties,
  addressLock: { fontSize: "0.68rem", flexShrink: 0 },
  addressInput: {
    flex: 1, background: "transparent", border: "none", outline: "none",
    color: "#e5e7eb", fontSize: "0.86rem", minWidth: 0
  },
  headerActions: {
    display: "flex", alignItems: "center", gap: 5, WebkitAppRegion: "no-drag"
  } as React.CSSProperties,
  headerPill: {
    background: "#1a1a26", color: "#e5e7eb", border: "1px solid #2a2a3e",
    borderRadius: 999, padding: "5px 11px", cursor: "pointer", fontSize: "0.8rem"
  },
  waitingPip: {
    display: "flex", alignItems: "center", gap: 5,
    background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)",
    borderRadius: 999, padding: "4px 9px", fontSize: "0.78rem", color: "#fbbf24"
  },
  waitingDot: {
    width: 6, height: 6, borderRadius: "50%", background: "#f59e0b", display: "inline-block"
  }
};
