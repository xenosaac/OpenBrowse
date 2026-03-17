import { useCallback, useEffect, useRef, useState } from "react";
import type { ManagementTab } from "../components/ManagementPanel";

export function useUILayout() {
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const [managementOpen, setManagementOpen] = useState(false);
  const [managementTab, setManagementTab] = useState<ManagementTab>("config");
  const [menuOpen, setMenuOpen] = useState(false);
  const [tabScroll, setTabScroll] = useState<{ canScrollLeft: boolean; canScrollRight: boolean }>({
    canScrollLeft: false,
    canScrollRight: false
  });

  const toggleSidebar = useCallback(() => setSidebarVisible(v => !v), []);

  const startSidebarDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    setIsDragging(true);

    const handleMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const newWidth = Math.max(240, Math.min(480, moveEvent.clientX));
      setSidebarWidth(newWidth);
    };

    const handleUp = () => {
      isDraggingRef.current = false;
      setIsDragging(false);
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }, []);

  const openManagement = useCallback((tab: ManagementTab) => {
    setManagementTab(tab);
    setManagementOpen(true);
    setMenuOpen(false);
  }, []);

  const closeManagement = useCallback(() => setManagementOpen(false), []);
  const toggleMenu = useCallback(() => setMenuOpen(v => !v), []);

  return {
    sidebarWidth, sidebarVisible, isDragging, managementOpen, managementTab,
    menuOpen, tabScroll,
    setSidebarWidth, toggleSidebar, startSidebarDrag,
    openManagement, closeManagement, toggleMenu, setMenuOpen, setTabScroll
  };
}
