import { useCallback, useEffect, useState } from "react";
import type { BrowserShellTabDescriptor } from "../../shared/runtime";
import type { MainPanel } from "../types/chat";

export function useAddressBar(
  activeBrowserTab: BrowserShellTabDescriptor | null,
  mainPanel: MainPanel
) {
  const [addressInput, setAddressInput] = useState("");
  const [addressEditing, setAddressEditing] = useState(false);
  const [navState, setNavState] = useState<{ canGoBack: boolean; canGoForward: boolean }>({
    canGoBack: false,
    canGoForward: false
  });

  // Sync address bar with active tab URL
  useEffect(() => {
    if (!addressEditing && activeBrowserTab && mainPanel === "browser") {
      const displayUrl = activeBrowserTab.url === "about:blank" ? "" : (activeBrowserTab.url ?? "");
      setAddressInput(displayUrl);
    }
  }, [activeBrowserTab, addressEditing, mainPanel]);

  // Fetch nav state when active tab changes
  useEffect(() => {
    if (!activeBrowserTab || mainPanel !== "browser") return;
    window.openbrowse.browserNavState(activeBrowserTab.id).then((state) => {
      if (state) setNavState({ canGoBack: state.canGoBack, canGoForward: state.canGoForward });
    }).catch(() => {});
  }, [activeBrowserTab, mainPanel]);

  const startEditing = useCallback(() => setAddressEditing(true), []);
  const stopEditing = useCallback(() => setAddressEditing(false), []);

  return {
    addressInput, addressEditing, navState,
    setAddressInput, startEditing, stopEditing, setNavState
  };
}
