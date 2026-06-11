"use client";

import { useEngine, useEngineState } from "./engine-provider";
import styles from "./page.module.css";

export default function AppHome(): React.JSX.Element {
  const { me } = useEngine();
  const view = useEngineState((s) => s.view);
  const online = useEngineState((s) => s.online);
  const syncing = useEngineState((s) => s.syncing);
  const cookie = useEngineState((s) => s.cookie);

  const workspace = view.get("workspace", me.workspaceId);
  const projects = Array.from(view.entities.values())
    .filter((e) => e.kind === "project" && e.workspaceId === me.workspaceId && !e.deleted)
    .map((e) => e as { kind: "project"; id: string; name: string; key: string });

  async function onLogout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    window.location.href = "/login";
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Slipstream</p>
          <h1 className={styles.title}>{workspace?.name ?? "Loading…"}</h1>
        </div>
        <div className={styles.headerRight}>
          <SyncBadge online={online} syncing={syncing} cookie={cookie} />
          <button onClick={onLogout} className={styles.ghost}>
            Sign out
          </button>
        </div>
      </header>

      <section className={styles.panel} aria-labelledby="projects-h">
        <h2 id="projects-h" className={styles.sectionTitle}>
          Projects
        </h2>
        {projects.length === 0 ? (
          <p className={styles.muted}>No projects yet.</p>
        ) : (
          <ul className={styles.projectList}>
            {projects.map((p) => (
              <li key={p.id}>
                <span className={styles.projectKey}>{p.key}</span>
                <span>{p.name}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="welcome-h">
        <h2 id="welcome-h" className={styles.sectionTitle}>
          You&apos;re in.
        </h2>
        <p>
          The page you&apos;re looking at is rendered from the materialised view of the local-first
          sync engine. The view is <code>serverBase + unconfirmedOutbox</code>; the sync runtime is
          alive in this tab and reconciling with the server over WebSocket. Boards, lists,
          comments and the command palette land in the next milestones.
        </p>
        <p className={styles.muted}>
          Signed in as <strong>{me.email}</strong>. Workspace id: <code>{me.workspaceId}</code>.
        </p>
      </section>
    </main>
  );
}

function SyncBadge({
  online,
  syncing,
  cookie,
}: {
  online: boolean;
  syncing: boolean;
  cookie: number;
}): React.JSX.Element {
  const label = syncing
    ? "Syncing…"
    : online
      ? `Synced (v${cookie})`
      : "Offline";
  return (
    <span
      className={styles.badge}
      data-online={online ? "true" : "false"}
      data-syncing={syncing ? "true" : "false"}
      aria-live="polite"
    >
      <span className={styles.dot} aria-hidden />
      {label}
    </span>
  );
}
