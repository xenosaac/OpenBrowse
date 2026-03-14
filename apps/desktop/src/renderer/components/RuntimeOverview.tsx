import type { BrowserShellTabDescriptor, RuntimeDescriptor } from "../../shared/runtime";

interface Props {
  runtime: RuntimeDescriptor | null;
  tabs: BrowserShellTabDescriptor[];
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: "0.78rem",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#7a7468",
  marginBottom: 8
};

export function RuntimeOverview({ runtime, tabs }: Props) {
  if (!runtime) {
    return (
      <section style={styles.card}>
        <h2 style={styles.title}>Runtime Overview</h2>
        <p style={styles.empty}>Loading desktop runtime status...</p>
      </section>
    );
  }

  const adapters = [
    { label: "Planner", value: runtime.planner.mode, detail: runtime.planner.detail },
    { label: "Browser", value: runtime.browser.mode, detail: runtime.browser.detail },
    { label: "Chat", value: runtime.chatBridge.mode, detail: runtime.chatBridge.detail },
    { label: "Storage", value: runtime.storage.mode, detail: runtime.storage.detail }
  ];
  const phaseTitle: Record<string, string> = {
    phase1: "Phase 1 Desktop Skeleton",
    phase2: "Phase 2 Browser Runtime",
    phase3: "Phase 3 Remote Clarification",
    phase4: "Phase 4 Demo Flows",
    phase5: "Phase 5 Safety And Recovery",
    phase6: "Phase 6 Integrated Demo Runtime",
    phase7: "Phase 7 Unified Shell And Live Tasks"
  };
  const verificationStepsByPhase: Record<string, string[]> = {
    phase1: [
      "Start any task from the top input bar.",
      "Answer the generated clarification or click the fake Telegram reply path.",
      "Watch the run complete and inspect its workflow log."
    ],
    phase2: [
      "Start a task and confirm a managed browser profile/session is created.",
      "Verify the shell preview begins tracking real browser session tabs.",
      "Inspect the workflow log for page capture and browser action events."
    ],
    phase3: [
      "Start a task that suspends for clarification.",
      "Reply from the authorized Telegram chat or the fake Telegram path.",
      "Confirm the same run resumes from its checkpoint and continues."
    ],
    phase4: [
      "Open the demo list and run the travel-search demo end-to-end.",
      "Run the appointment-booking demo and verify the approval flow.",
      "Register a price-monitor watch and confirm the scheduler triggers periodic runs."
    ],
    phase5: [
      "Suspend a run on an approval step and verify approve / deny updates the same run.",
      "Open the workflow log and replay panel to inspect the recorded run timeline.",
      "Restart the app with unfinished runs and confirm recovery state is surfaced in the desktop shell."
    ],
    phase6: [
      "Run the travel-search and appointment demos and verify they resume coherently after clarification.",
      "Register a price-monitor watch and confirm scheduled runs follow the same scripted demo path.",
      "Inspect the shell preview and workflow log to confirm session metadata, replay, and recovery stay aligned."
    ],
    phase7: [
      "Open the Browser tab and confirm embedded browser views are visible inside the main window.",
      "Close and reopen the app window (Cmd+W then click dock icon) — confirm the browser tab still works.",
      "Open the Demos tab — live task packs should show 'unavailable' if no API key is set, or 'live' if configured.",
      "Verify the Runtime Overview reports phase7 with honest planner/browser/chat status."
    ]
  };
  const verificationSteps = verificationStepsByPhase[runtime.phase] ?? verificationStepsByPhase.phase1;

  return (
    <section style={styles.card}>
      <div style={styles.header}>
        <div>
          <div style={sectionTitleStyle}>Current Milestone</div>
          <h2 style={styles.title}>{phaseTitle[runtime.phase] ?? runtime.phase}</h2>
        </div>
        <span style={styles.badge}>{runtime.mode.replace(/_/g, " ")}</span>
      </div>

      <div style={styles.grid}>
        {adapters.map((adapter) => (
          <div key={adapter.label} style={styles.adapterCard}>
            <div style={styles.adapterRow}>
              <strong>{adapter.label}</strong>
              <span style={styles.modeTag}>{adapter.value}</span>
            </div>
            <p style={styles.detail}>{adapter.detail}</p>
          </div>
        ))}
      </div>

      <div style={styles.columns}>
        <div>
          <div style={sectionTitleStyle}>How To Verify</div>
          <ol style={styles.list}>
            {verificationSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>

        <div>
          <div style={sectionTitleStyle}>Browser Shell Preview</div>
          {tabs.length === 0 ? (
            <p style={styles.empty}>No tabs have been registered yet.</p>
          ) : (
            <div style={styles.tabList}>
              {tabs.map((tab) => (
                <div key={tab.id} style={styles.tabCard}>
                  <strong>{tab.title}</strong>
                  <div style={styles.tabMeta}>{tab.url}</div>
                  <div style={styles.tabMeta}>profile: {tab.profileId}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={styles.columns}>
        <div>
          <div style={sectionTitleStyle}>Current Notes</div>
          <ul style={styles.list}>
            {runtime.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>

        <div>
          <div style={sectionTitleStyle}>Deferred To Later Phases</div>
          <ul style={styles.list}>
            {runtime.deferredCapabilities.map((capability) => (
              <li key={capability}>{capability}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: "linear-gradient(135deg, #f8f3e9 0%, #efe5d3 100%)",
    color: "#231f1a",
    borderRadius: 16,
    padding: 20,
    border: "1px solid #d7cab4",
    marginBottom: 16,
    boxShadow: "0 14px 40px rgba(60, 44, 20, 0.08)"
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 16
  },
  title: {
    fontSize: "1.35rem",
    margin: 0
  },
  badge: {
    background: "#1f4d3f",
    color: "#f6f0e7",
    borderRadius: 999,
    padding: "6px 12px",
    fontSize: "0.78rem",
    textTransform: "uppercase"
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
    marginBottom: 18
  },
  adapterCard: {
    background: "rgba(255, 251, 244, 0.78)",
    borderRadius: 12,
    padding: 14,
    border: "1px solid #dbcbb4"
  },
  adapterRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center"
  },
  modeTag: {
    color: "#8b5e34",
    fontSize: "0.78rem",
    textTransform: "uppercase"
  },
  detail: {
    margin: "8px 0 0",
    fontSize: "0.9rem",
    color: "#4b4338",
    lineHeight: 1.5
  },
  columns: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 18,
    marginTop: 16
  },
  list: {
    margin: 0,
    paddingLeft: 18,
    color: "#3e372f",
    lineHeight: 1.6
  },
  empty: {
    margin: 0,
    color: "#6b6257"
  },
  tabList: {
    display: "grid",
    gap: 8
  },
  tabCard: {
    background: "rgba(255, 251, 244, 0.78)",
    borderRadius: 12,
    padding: 12,
    border: "1px solid #dbcbb4"
  },
  tabMeta: {
    marginTop: 4,
    fontSize: "0.82rem",
    color: "#6b6257"
  }
};
