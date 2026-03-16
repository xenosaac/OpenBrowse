import { useEffect, type RefObject } from "react";
import type { BrowserShellTabDescriptor } from "../../shared/runtime";
import type { MainPanel } from "../types/chat";

interface KeyboardShortcutsParams {
  activeBrowserTab: BrowserShellTabDescriptor | null;
  mainPanel: MainPanel;
  addressBarRef: RefObject<HTMLInputElement | null>;
  onNewTab: () => void;
  onCloseTab: () => void;
  onReload: () => void;
  onBack: () => void;
  onForward: () => void;
  onFocusAddressBar: () => void;
  onFindInPage: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}

export function useKeyboardShortcuts(params: KeyboardShortcutsParams) {
  const {
    activeBrowserTab, mainPanel, addressBarRef,
    onNewTab, onCloseTab, onReload, onBack, onForward, onFocusAddressBar, onFindInPage,
    onZoomIn, onZoomOut, onZoomReset
  } = params;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;

      if (e.key === "t") {
        e.preventDefault();
        onNewTab();
        return;
      }
      if (e.key === "w") {
        e.preventDefault();
        onCloseTab();
        return;
      }
      if (e.key === "l") {
        e.preventDefault();
        onFocusAddressBar();
        return;
      }

      if (e.key === "f") {
        e.preventDefault();
        onFindInPage();
        return;
      }

      if (mainPanel !== "browser" || !activeBrowserTab) return;

      if (e.key === "r") {
        e.preventDefault();
        onReload();
        return;
      }
      if (e.key === "[") {
        e.preventDefault();
        onBack();
        return;
      }
      if (e.key === "]") {
        e.preventDefault();
        onForward();
        return;
      }
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        onZoomIn();
        return;
      }
      if (e.key === "-") {
        e.preventDefault();
        onZoomOut();
        return;
      }
      if (e.key === "0") {
        e.preventDefault();
        onZoomReset();
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeBrowserTab, mainPanel, onNewTab, onCloseTab, onReload, onBack, onForward, onFocusAddressBar, onFindInPage, onZoomIn, onZoomOut, onZoomReset]);
}
