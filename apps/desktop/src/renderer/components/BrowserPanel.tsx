import { useEffect, useRef } from "react";
import type { BrowserShellTabDescriptor } from "../../shared/runtime";

interface Props {
  activeTab: BrowserShellTabDescriptor | null;
  /** When true the native browser view is retracted so DOM overlays (e.g. management
   *  panel) are not occluded by the OS-level compositor surface. */
  covered: boolean;
}

export function BrowserPanel({ activeTab, covered }: Props) {
  const viewportRef = useRef<HTMLDivElement | null>(null);

  // Show / hide the native browser view when the active session changes OR when a
  // DOM overlay opens/closes.  The native WebContentsView lives outside the renderer
  // compositor, so CSS z-index cannot push it behind a modal — we must retract it via
  // IPC whenever a covering overlay is visible.
  //
  // Viewport bounds are set BEFORE showBrowserSession so the view is never briefly
  // drawn at full-window size (which would cause a black-screen flash over the sidebar).
  useEffect(() => {
    if (covered || !activeTab) {
      void window.openbrowse.hideBrowserSession();
      // Only clear the stored bounds when there is genuinely no tab — keeps restore
      // seamless when the overlay closes while the same tab is still active.
      if (!activeTab) void window.openbrowse.clearBrowserViewport();
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
    // Re-run when the active session changes or overlay coverage changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab?.id, covered]);

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

  return <div ref={viewportRef} style={styles.viewport} />;
}

const styles: Record<string, React.CSSProperties> = {
  viewport: {
    position: "relative",
    width: "100%",
    height: "100%",
    minHeight: 0,
    background: "#1a1a1a"
  },
  emptyState: {
    display: "grid",
    placeItems: "center",
    height: "100%",
    color: "#9090a8"
  },
  emptyText: {
    margin: 0,
    fontSize: "0.9rem"
  }
};
