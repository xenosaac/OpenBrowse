import React from "react";
import { colors, radii, transitions } from "../styles/tokens";

interface UpdateBannerProps {
  latestVersion: string;
  releaseUrl: string;
  releaseName: string;
  onDismiss: () => void;
}

export function UpdateBanner({ latestVersion, releaseUrl, releaseName, onDismiss }: UpdateBannerProps) {
  const handleOpen = () => {
    if (releaseUrl) {
      window.open(releaseUrl, "_blank");
    }
  };

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      padding: "6px 16px",
      background: colors.emeraldTint,
      borderBottom: `1px solid ${colors.emeraldBorder}`,
      fontSize: 13,
      color: colors.textPrimary,
      flexShrink: 0,
    }}>
      <span>
        <strong style={{ color: colors.emeraldHover }}>Update available:</strong>{" "}
        {releaseName || `v${latestVersion}`}
      </span>
      {releaseUrl && (
        <button
          onClick={handleOpen}
          style={{
            padding: "2px 10px",
            borderRadius: radii.sm,
            border: `1px solid ${colors.emeraldBorder}`,
            background: colors.emeraldTintStrong,
            color: colors.emeraldHover,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 500,
            transition: `background ${transitions.fast}`,
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(16,185,129,0.2)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = colors.emeraldTintStrong; }}
        >
          Download
        </button>
      )}
      <button
        onClick={onDismiss}
        style={{
          padding: "2px 6px",
          borderRadius: radii.xs,
          border: "none",
          background: "transparent",
          color: colors.textMuted,
          cursor: "pointer",
          fontSize: 14,
          lineHeight: 1,
          transition: `color ${transitions.fast}`,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = colors.textPrimary; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = colors.textMuted; }}
        title="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
