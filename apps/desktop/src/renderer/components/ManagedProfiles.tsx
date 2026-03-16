import type { BrowserProfile } from "@openbrowse/contracts";
import { colors, glass, shadows } from "../styles/tokens";

interface Props {
  profiles: BrowserProfile[];
}

export function ManagedProfiles({ profiles }: Props) {
  if (profiles.length === 0) {
    return <p style={{ color: "#9090a8" }}>No managed profiles yet.</p>;
  }

  return (
    <div>
      {profiles.map((profile) => (
        <div key={profile.id} style={styles.card}>
          <div style={styles.row}>
            <span style={styles.badge}>{profile.isManaged ? "managed" : "external"}</span>
            <strong>{profile.label}</strong>
          </div>
          <div style={styles.meta}>
            <span>{profile.id}</span>
            <span>{profile.storagePath}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    ...glass.card,
    borderRadius: 14,
    padding: "12px 14px",
    marginBottom: 8,
    border: "1px solid " + colors.borderSubtle
  } as React.CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8
  },
  badge: {
    background: colors.emeraldTintStrong,
    color: colors.emeraldHover,
    fontSize: "0.7rem",
    padding: "2px 6px",
    borderRadius: 4,
    textTransform: "uppercase" as const
  },
  meta: {
    display: "flex",
    gap: 16,
    fontSize: "0.8rem",
    color: "#8f90a6",
    marginTop: 4
  }
};
