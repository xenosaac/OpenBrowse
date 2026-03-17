import { useEffect, useMemo, type RefObject } from "react";
import type { BrowserShellTabDescriptor } from "../../shared/runtime";
import type { MainPanel } from "../types/chat";
import {
  DEFAULT_KEYBINDINGS,
  matchesCombo,
  resolveBindings,
  type KeyBindingOverrides,
  type KeyCombo
} from "../lib/keybindings";

interface KeyboardShortcutsParams {
  activeBrowserTab: BrowserShellTabDescriptor | null;
  mainPanel: MainPanel;
  addressBarRef: RefObject<HTMLInputElement | null>;
  keybindingOverrides: KeyBindingOverrides;
  onNewTab: () => void;
  onCloseTab: () => void;
  onReopenClosedTab: () => void;
  onReload: () => void;
  onBack: () => void;
  onForward: () => void;
  onFocusAddressBar: () => void;
  onFindInPage: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}

const ACTION_HANDLERS: Record<string, keyof Omit<KeyboardShortcutsParams, "activeBrowserTab" | "mainPanel" | "addressBarRef" | "keybindingOverrides">> = {
  newTab: "onNewTab",
  closeTab: "onCloseTab",
  reopenClosedTab: "onReopenClosedTab",
  reload: "onReload",
  back: "onBack",
  forward: "onForward",
  focusAddressBar: "onFocusAddressBar",
  findInPage: "onFindInPage",
  zoomIn: "onZoomIn",
  zoomOut: "onZoomOut",
  zoomReset: "onZoomReset",
};

export function useKeyboardShortcuts(params: KeyboardShortcutsParams) {
  const {
    activeBrowserTab, mainPanel,
    keybindingOverrides,
    onNewTab, onCloseTab, onReopenClosedTab, onReload, onBack, onForward,
    onFocusAddressBar, onFindInPage,
    onZoomIn, onZoomOut, onZoomReset
  } = params;

  const bindings = useMemo(() => resolveBindings(keybindingOverrides), [keybindingOverrides]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;

      for (const def of DEFAULT_KEYBINDINGS) {
        const combo = bindings.get(def.id);
        if (!combo) continue;
        if (!matchesCombo(e, combo)) continue;

        // Check browser-tab requirement
        if (def.requiresBrowserTab && (mainPanel !== "browser" || !activeBrowserTab)) continue;

        e.preventDefault();
        const handlerKey = ACTION_HANDLERS[def.id];
        if (handlerKey) {
          const fn = params[handlerKey];
          if (typeof fn === "function") (fn as () => void)();
        }
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeBrowserTab, mainPanel, bindings, params,
    onNewTab, onCloseTab, onReopenClosedTab, onReload, onBack, onForward,
    onFocusAddressBar, onFindInPage, onZoomIn, onZoomOut, onZoomReset]);
}
