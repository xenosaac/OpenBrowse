import React, { useEffect, useRef, useState } from "react";
import type { BrowserShellTabDescriptor } from "../../shared/runtime";
import { colors, glass, radii, transitions } from "../styles/tokens";

interface LoadError {
  errorCode: number;
  errorDescription: string;
  url: string;
}

interface Props {
  activeTab: BrowserShellTabDescriptor | null;
  /** When true the native browser view is retracted so DOM overlays (e.g. management
   *  panel) are not occluded by the OS-level compositor surface. */
  covered: boolean;
  loadError?: LoadError | null;
  onReload?: () => void;
}

function errorCodeToMessage(code: number): string {
  switch (code) {
    case -105: return "DNS address could not be found";
    case -106: return "The Internet connection has been lost";
    case -109: return "The server address is unreachable";
    case -118: return "The connection timed out";
    case -137: return "The server's certificate is not valid";
    case -200: return "The server's certificate has been revoked";
    case -201: return "The server's certificate is invalid";
    case -202: return "The server's certificate is not yet valid";
    case -501: return "The server responded with an error";
    default: return code < 0 ? `Network error (${code})` : "Unknown error";
  }
}

export function BrowserPanel({ activeTab, covered, loadError, onReload }: Props) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [reloadHover, setReloadHover] = useState(false);

  useEffect(() => {
    if (covered || !activeTab) {
      void window.openbrowse.hideBrowserSession();
      if (!activeTab) void window.openbrowse.clearBrowserViewport();
      return;
    }

    // Hide the native view when showing an error page so the error overlay is visible
    if (loadError) {
      void window.openbrowse.hideBrowserSession();
      return;
    }

    const showAndBindViewport = async () => {
      const element = viewportRef.current;
      if (element) {
        const rect = element.getBoundingClientRect();
        await window.openbrowse.setBrowserViewport({
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height
        });
      }
      await window.openbrowse.showBrowserSession(activeTab.id);
    };

    void showAndBindViewport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab?.id, covered, loadError]);

  // Keep viewport bounds in sync with element size changes.
  useEffect(() => {
    const updateViewport = async () => {
      const element = viewportRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      await window.openbrowse.setBrowserViewport({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
      });
    };

    const observer = new ResizeObserver(() => void updateViewport());
    if (viewportRef.current) {
      observer.observe(viewportRef.current);
    }
    window.addEventListener("resize", updateViewport);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateViewport);
    };
  }, []);

  if (!activeTab) {
    return (
      <div style={styles.emptyState}>
        <p style={styles.emptyText}>No active browser tab.</p>
      </div>
    );
  }

  if (loadError) {
    const friendlyMessage = loadError.errorDescription || errorCodeToMessage(loadError.errorCode);
    return (
      <div ref={viewportRef} style={styles.viewport}>
        <div style={styles.errorContainer}>
          {/* Error icon */}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" stroke={colors.textMuted} strokeWidth="1.5" />
            <path d="M12 8v5" stroke={colors.textMuted} strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="12" cy="16" r="1" fill={colors.textMuted} />
          </svg>
          <h2 style={styles.errorHeading}>This page can&apos;t be reached</h2>
          <p style={styles.errorUrl}>{loadError.url}</p>
          <p style={styles.errorDescription}>{friendlyMessage}</p>
          <button
            style={{
              ...styles.reloadButton,
              ...(reloadHover ? styles.reloadButtonHover : {}),
            }}
            onClick={onReload}
            onMouseEnter={() => setReloadHover(true)}
            onMouseLeave={() => setReloadHover(false)}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }

  return <div ref={viewportRef} style={styles.viewport} />;
}

const styles: Record<string, React.CSSProperties> = {
  viewport: {
    position: "relative",
    width: "100%",
    height: "100%",
    minHeight: 0,
    background: colors.bgBase
  },
  emptyState: {
    display: "grid",
    placeItems: "center",
    height: "100%",
    color: colors.textSecondary
  },
  emptyText: {
    margin: 0,
    fontSize: "0.9rem"
  },
  errorContainer: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: "10%",
    gap: 16,
    maxWidth: 420,
    margin: "0 auto",
    background: "transparent",
  },
  errorHeading: {
    margin: 0,
    marginTop: 16,
    fontSize: "0.95rem",
    fontWeight: 600,
    color: colors.textPrimary,
  },
  errorUrl: {
    margin: 0,
    fontSize: "0.82rem",
    color: colors.textSecondary,
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    wordBreak: "break-all" as const,
  },
  errorDescription: {
    margin: 0,
    fontSize: "0.78rem",
    color: colors.textMuted,
    textAlign: "center" as const,
  },
  reloadButton: {
    marginTop: 8,
    padding: "6px 20px",
    fontSize: "0.82rem",
    fontWeight: 500,
    color: colors.textPrimary,
    background: glass.control.background,
    backdropFilter: glass.control.backdropFilter,
    WebkitBackdropFilter: glass.control.WebkitBackdropFilter,
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.md,
    cursor: "pointer",
    transition: `all ${transitions.fast}`,
    outline: "none",
  },
  reloadButtonHover: {
    background: "rgba(255,255,255,0.08)",
    borderColor: colors.borderHover,
  },
};
