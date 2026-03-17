import React, { useEffect, useRef, useState } from "react";
import type { BrowserShellTabDescriptor } from "../../shared/runtime";
import { colors, glass, radii, transitions } from "../styles/tokens";

interface LoadError {
  errorCode: number;
  errorDescription: string;
  url: string;
}

interface DownloadEntry {
  id: string;
  filename: string;
  savePath: string;
  totalBytes: number;
  receivedBytes: number;
  state: "progressing" | "completed" | "cancelled" | "interrupted";
}

interface Props {
  activeTab: BrowserShellTabDescriptor | null;
  /** When true the native browser view is retracted so DOM overlays (e.g. management
   *  panel) are not occluded by the OS-level compositor surface. */
  covered: boolean;
  loadError?: LoadError | null;
  onReload?: () => void;
  downloads?: DownloadEntry[];
  onDismissDownload?: (id: string) => void;
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

export function BrowserPanel({ activeTab, covered, loadError, onReload, downloads = [], onDismissDownload }: Props) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [reloadHover, setReloadHover] = useState(false);
  const [dismissHoverId, setDismissHoverId] = useState<string | null>(null);

  // Auto-dismiss completed/cancelled downloads after 5 seconds
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const dl of downloads) {
      if (dl.state === "completed" || dl.state === "cancelled") {
        const timer = setTimeout(() => onDismissDownload?.(dl.id), 5000);
        timers.push(timer);
      }
    }
    return () => timers.forEach(clearTimeout);
  }, [downloads, onDismissDownload]);

  // Only show downloads that are active or recently finished
  const visibleDownloads = downloads.filter(d => d.state === "progressing" || d.state === "completed" || d.state === "interrupted");

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

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", minHeight: 0 }}>
      <div ref={viewportRef} style={{ ...styles.viewport, flex: 1 }} />
      {visibleDownloads.length > 0 && (
        <div style={styles.downloadBar}>
          {visibleDownloads.map(dl => {
            const progress = dl.totalBytes > 0 ? dl.receivedBytes / dl.totalBytes : 0;
            const progressPct = Math.round(progress * 100);
            const sizeText = dl.totalBytes > 0
              ? `${formatBytes(dl.receivedBytes)} / ${formatBytes(dl.totalBytes)}`
              : formatBytes(dl.receivedBytes);
            return (
              <div key={dl.id} style={styles.downloadItem}>
                {/* Download icon */}
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
                  <path d="M7 1v8m0 0L4 6.5M7 9l3-2.5M2 11.5h10" stroke={dl.state === "completed" ? colors.emerald : colors.textSecondary} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span style={styles.downloadFilename}>{dl.filename}</span>
                {dl.state === "progressing" && (
                  <>
                    <div style={styles.downloadProgressTrack}>
                      <div style={{ ...styles.downloadProgressFill, width: `${progressPct}%` }} />
                    </div>
                    <span style={styles.downloadSize}>{sizeText}</span>
                  </>
                )}
                {dl.state === "completed" && (
                  <span style={{ ...styles.downloadSize, color: colors.emerald }}>Done</span>
                )}
                {dl.state === "interrupted" && (
                  <span style={{ ...styles.downloadSize, color: colors.statusFailed }}>Failed</span>
                )}
                <button
                  style={dismissHoverId === dl.id ? { ...styles.downloadDismiss, background: colors.controlHoverBg, color: colors.textPrimary } : styles.downloadDismiss}
                  onClick={() => onDismissDownload?.(dl.id)}
                  onMouseEnter={() => setDismissHoverId(dl.id)}
                  onMouseLeave={() => setDismissHoverId(null)}
                  title="Dismiss"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
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
    background: colors.controlHoverBg,
    borderColor: colors.borderHover,
  },
  // Download bar — Compact Chrome Widget pattern (like FindBar)
  downloadBar: {
    background: "transparent",
    borderTop: `1px solid ${colors.borderSubtle}`,
    padding: "4px 10px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
    flexShrink: 0,
  },
  downloadItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    ...glass.control,
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.md,
    padding: "3px 8px",
  },
  downloadFilename: {
    fontSize: "0.78rem",
    fontWeight: 500,
    color: colors.textPrimary,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    maxWidth: 200,
    flexShrink: 1,
  },
  downloadProgressTrack: {
    flex: 1,
    minWidth: 60,
    maxWidth: 120,
    height: 4,
    borderRadius: 2,
    background: colors.borderSubtle,
    overflow: "hidden",
  },
  downloadProgressFill: {
    height: "100%",
    background: colors.emerald,
    borderRadius: 2,
    transition: `width ${transitions.fast}`,
  },
  downloadSize: {
    fontSize: "0.72rem",
    color: colors.textMuted,
    whiteSpace: "nowrap" as const,
    flexShrink: 0,
  },
  downloadDismiss: {
    background: "transparent",
    border: "none",
    color: colors.textMuted,
    cursor: "pointer",
    fontSize: "0.72rem",
    padding: "2px 4px",
    borderRadius: radii.md,
    lineHeight: 1,
    flexShrink: 0,
  },
};
