import type { BrowserProfile } from "@openbrowse/contracts";

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
    background: "#151522",
    borderRadius: 14,
    padding: "12px 14px",
    marginBottom: 8,
    border: "1px solid #2a2a3e"
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8
  },
  badge: {
    background: "#312e81",
    color: "#fffdf9",
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
