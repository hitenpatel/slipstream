"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useEngine, useEngineState } from "./engine-provider";
import styles from "./page.module.css";

export default function AppHome(): React.JSX.Element {
  const { me } = useEngine();
  const router = useRouter();
  const view = useEngineState((s) => s.view);

  const projects = Array.from(view.entities.values())
    .filter((e) => e.kind === "project" && e.workspaceId === me.workspaceId && !e.deleted)
    .map((e) => e as { kind: "project"; id: string; name: string; key: string });

  // Auto-jump to the first project so the URL always reflects what you're seeing.
  // Stays on this page (an empty state with onboarding) if there are zero projects.
  const firstId = projects[0]?.id;
  useEffect(() => {
    if (firstId) router.replace(`/app/${firstId}`);
  }, [firstId, router]);

  return (
    <main className={styles.main}>
      <section className={styles.panel}>
        <h1 className={styles.title}>Welcome to your workspace.</h1>
        <p>
          {projects.length === 0
            ? "Create a project from the sidebar to get started — issues live inside projects."
            : "Pick a project from the sidebar."}
        </p>
        <p className={styles.muted}>
          The sidebar lists every project in your workspace. Everything you see is rendered straight
          from the materialised view (serverBase + your unconfirmed outbox), so changes appear before
          the server has even ack&apos;d them.
        </p>
      </section>
    </main>
  );
}
