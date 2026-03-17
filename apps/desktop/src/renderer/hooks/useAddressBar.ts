import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserShellTabDescriptor } from "../../shared/runtime";
import type { MainPanel } from "../types/chat";

export interface AddressBarSuggestion {
  url: string;
  title: string;
}

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
  const [suggestions, setSuggestions] = useState<AddressBarSuggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Debounced search when input changes during editing
  useEffect(() => {
    if (!addressEditing || !addressInput || addressInput.length < 2) {
      setSuggestions([]);
      setSelectedIndex(-1);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      window.openbrowse.searchHistory(addressInput).then((results) => {
        const typed = (results as Array<{ url: string; title: string }>).slice(0, 8);
        setSuggestions(typed);
        setSelectedIndex(-1);
      }).catch(() => {
        setSuggestions([]);
      });
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [addressInput, addressEditing]);

  const startEditing = useCallback(() => setAddressEditing(true), []);

  const stopEditing = useCallback(() => {
    setAddressEditing(false);
    setSuggestions([]);
    setSelectedIndex(-1);
  }, []);

  const clearSuggestions = useCallback(() => {
    setSuggestions([]);
    setSelectedIndex(-1);
  }, []);

  const moveSelection = useCallback((delta: number) => {
    setSuggestions((prev) => {
      if (prev.length === 0) return prev;
      setSelectedIndex((idx) => {
        const next = idx + delta;
        if (next < 0) return prev.length - 1;
        if (next >= prev.length) return 0;
        return next;
      });
      return prev;
    });
  }, []);

  const getSelectedSuggestion = useCallback((): AddressBarSuggestion | null => {
    if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
      return suggestions[selectedIndex];
    }
    return null;
  }, [selectedIndex, suggestions]);

  return {
    addressInput, addressEditing, navState, suggestions, selectedIndex,
    setAddressInput, startEditing, stopEditing, setNavState,
    clearSuggestions, moveSelection, setSelectedIndex, getSelectedSuggestion
  };
}
