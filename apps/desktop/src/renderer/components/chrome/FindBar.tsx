import React, { useEffect, useRef, useState } from "react";
import { colors, radii, glass, transitions } from "../../styles/tokens";

interface FindBarProps {
  onFind: (text: string, options?: { forward?: boolean; findNext?: boolean }) => void;
  onStopFind: () => void;
  onClose: () => void;
  activeMatchOrdinal: number;
  totalMatches: number;
}

export function FindBar({ onFind, onStopFind, onClose, activeMatchOrdinal, totalMatches }: FindBarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const textRef = useRef("");
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    textRef.current = text;
    if (text) {
      onFind(text);
    } else {
      onStopFind();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (textRef.current) {
        const forward = !e.shiftKey;
        onFind(textRef.current, { forward, findNext: true });
      }
      return;
    }
  };

  const handlePrev = () => {
    if (textRef.current) {
      onFind(textRef.current, { forward: false, findNext: true });
    }
  };

  const handleNext = () => {
    if (textRef.current) {
      onFind(textRef.current, { forward: true, findNext: true });
    }
  };

  const hasText = textRef.current.length > 0 || activeMatchOrdinal > 0 || totalMatches > 0;

  return (
    <div style={styles.container}>
      <div style={styles.inner}>
        <input
          ref={inputRef}
          type="text"
          placeholder="Find in page"
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          style={styles.input}
        />
        {hasText && (
          <span style={styles.matchCount}>
            {totalMatches > 0 ? `${activeMatchOrdinal} / ${totalMatches}` : "0 matches"}
          </span>
        )}
        <button
          className="ob-btn"
          style={hoveredBtn === "prev" ? { ...styles.navButton, ...styles.btnHover } : styles.navButton}
          onClick={handlePrev}
          onMouseEnter={() => setHoveredBtn("prev")}
          onMouseLeave={() => setHoveredBtn(null)}
          title="Previous match (Shift+Enter)"
        >
          ▲
        </button>
        <button
          className="ob-btn"
          style={hoveredBtn === "next" ? { ...styles.navButton, ...styles.btnHover } : styles.navButton}
          onClick={handleNext}
          onMouseEnter={() => setHoveredBtn("next")}
          onMouseLeave={() => setHoveredBtn(null)}
          title="Next match (Enter)"
        >
          ▼
        </button>
        <button
          className="ob-btn"
          style={hoveredBtn === "close" ? { ...styles.closeButton, ...styles.btnHover } : styles.closeButton}
          onClick={onClose}
          onMouseEnter={() => setHoveredBtn("close")}
          onMouseLeave={() => setHoveredBtn(null)}
          title="Close (Esc)"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    justifyContent: "flex-end",
    padding: "4px 10px",
    background: "transparent",
    borderBottom: `1px solid ${colors.borderSubtle}`,
  },
  inner: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    ...glass.control,
    border: `1px solid ${colors.borderDefault}`,
    borderRadius: radii.md,
    padding: "3px 6px",
  },
  input: {
    background: "transparent",
    border: "none",
    outline: "none",
    color: colors.textPrimary,
    fontSize: "0.82rem",
    width: 180,
    padding: "2px 4px",
  },
  matchCount: {
    fontSize: "0.72rem",
    color: colors.textMuted,
    whiteSpace: "nowrap" as const,
    padding: "0 4px",
  },
  navButton: {
    background: "transparent",
    border: "none",
    color: colors.textSecondary,
    cursor: "pointer",
    fontSize: "0.68rem",
    padding: "2px 4px",
    borderRadius: radii.md,
    minWidth: 20,
    height: 20,
    display: "grid",
    placeItems: "center",
    transition: `background ${transitions.fast}, color ${transitions.fast}`,
  },
  closeButton: {
    background: "transparent",
    border: "none",
    color: colors.textSecondary,
    cursor: "pointer",
    fontSize: "0.72rem",
    padding: "2px 4px",
    borderRadius: radii.md,
    minWidth: 20,
    height: 20,
    display: "grid",
    placeItems: "center",
    transition: `background ${transitions.fast}, color ${transitions.fast}`,
  },
  btnHover: {
    background: colors.controlHoverBg,
    color: colors.textPrimary,
  },
};
