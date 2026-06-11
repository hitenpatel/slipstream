"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Project } from "@slipstream/protocol";
import { uuidv7 } from "@slipstream/protocol";
import { useEngine, useEngineState } from "./engine-provider";
import { CommandPalette } from "./palette/command-palette";
import { SyncAnnouncer } from "./sync-announcer";
import styles from "./app-shell.module.css";

export function AppShell({ children }: { children: ReactNode }): React.JSX.Element {
  const { engine, me } = useEngine();
  const view = useEngineState((s) => s.view);
  const online = useEngineState((s) => s.online);
  const syncing = useEngineState((s) => s.syncing);
  const cookie = useEngineState((s) => s.cookie);
  const pathname = usePathname();

  const workspace = view.get("workspace", me.workspaceId);

  const projects = useMemo(() => {
    const all: Project[] = [];
    for (const e of view.entities.values()) {
      if (e.kind === "project" && e.workspaceId === me.workspaceId && !e.deleted) {
        all.push(e);
      }
    }
    all.sort((a, b) => a.name.localeCompare(b.name));
    return all;
  }, [view, me.workspaceId]);

  const [creating, setCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectKey, setNewProjectKey] = useState("");
  const projectInputRef = useRef<HTMLInputElement>(null);

  // Move focus to the new-project name field once the form opens.
  // This is the accessible alternative to autoFocus, which fires on mount
  // and can surprise screen readers.
  useEffect(() => {
    if (creating) projectInputRef.current?.focus();
  }, [creating]);

  async function onCreateProject(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const name = newProjectName.trim();
    const key = newProjectKey.trim().toUpperCase();
    if (!name || !key) return;
    const id = uuidv7();
    await engine.mutate("createProject", {
      id,
      workspaceId: me.workspaceId,
      name,
      key,
    });
    setNewProjectName("");
    setNewProjectKey("");
    setCreating(false);
    void engine.sync();
  }

  async function onLogout(): Promise<void> {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    window.location.href = "/login";
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar} aria-label="Workspace navigation">
        <div className={styles.brand}>
          <p className={styles.eyebrow}>Slipstream</p>
          <h2 className={styles.workspaceName}>{workspace?.name ?? "Workspace"}</h2>
        </div>

        <nav className={styles.nav} aria-label="Projects">
          <div className={styles.navHeader}>
            <span>Projects</span>
            <button
              type="button"
              className={styles.smallBtn}
              onClick={() => setCreating((v) => !v)}
              aria-expanded={creating}
              aria-controls="new-project-form"
            >
              {creating ? "Cancel" : "+ New"}
            </button>
          </div>

          {creating ? (
            <form id="new-project-form" onSubmit={onCreateProject} className={styles.newProject}>
              <label>
                <span className={styles.srOnly}>Project name</span>
                <input
                  ref={projectInputRef}
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="Project name"
                  required
                />
              </label>
              <label>
                <span className={styles.srOnly}>Key (e.g. SL)</span>
                <input
                  value={newProjectKey}
                  onChange={(e) => setNewProjectKey(e.target.value)}
                  placeholder="KEY"
                  maxLength={6}
                  required
                  pattern="[A-Za-z0-9]+"
                />
              </label>
              <button type="submit" className={styles.smallPrimary}>
                Create
              </button>
            </form>
          ) : null}

          <ul className={styles.projectList}>
            {projects.length === 0 ? (
              <li className={styles.empty}>No projects yet.</li>
            ) : (
              projects.map((p) => {
                const href = `/app/${p.id}`;
                const active = pathname === href;
                return (
                  <li key={p.id}>
                    <Link
                      href={href}
                      className={styles.projectLink}
                      data-active={active ? "true" : "false"}
                    >
                      <span className={styles.projectKey}>{p.key}</span>
                      <span className={styles.projectName}>{p.name}</span>
                    </Link>
                  </li>
                );
              })
            )}
          </ul>
        </nav>

        <div className={styles.sidebarFoot}>
          <SyncBadge online={online} syncing={syncing} cookie={cookie} />
          <button onClick={onLogout} className={styles.ghost} type="button">
            Sign out
          </button>
        </div>
      </aside>

      <section className={styles.content}>{children}</section>

      <CommandPalette contextProjectId={projectIdFromPathname(pathname)} />
      <SyncAnnouncer />
    </div>
  );
}

function projectIdFromPathname(pathname: string): string | undefined {
  // /app/{projectId}, /app/{projectId}/board, /app/{projectId}/...
  const m = pathname.match(/^\/app\/([^/]+)/);
  return m?.[1];
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
  const label = syncing ? "Syncing…" : online ? `Synced (v${cookie})` : "Offline";
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
