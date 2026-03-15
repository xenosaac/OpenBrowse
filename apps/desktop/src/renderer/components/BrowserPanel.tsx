import { useEffect, useRef } from "react";
import type { BrowserShellTabDescriptor } from "../../shared/runtime";

interface Props {
  activeTab: BrowserShellTabDescriptor | null;
}

export function BrowserPanel({ activeTab }: Props) {
  const viewportRef = useRef<HTMLDivElement | null>(null);

  // Show / hide the native browser view when the active session changes.
  // Viewport bounds are set BEFORE showBrowserSession so the view is never briefly
  // drawn at full-window size (which would cause a black-screen flash over the sidebar).
  useEffect(() => {
    if (!activeTab) {
      void window.openbrowse.hideBrowserSession();
      void window.openbrowse.clearBrowserViewport();
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
    // Only re-run when the active session itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab?.id]);

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
