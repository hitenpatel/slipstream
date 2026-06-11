"use client";

import { useEffect, useRef, useState } from "react";
import { useEngineState } from "./engine-provider";
import styles from "./sync-announcer.module.css";

/**
 * Polite live region that announces the sync lifecycle in plain language for
 * assistive tech. Posts a fresh message only on a true state transition (not on
 * every render), so screen readers don't drone every store update.
 *
 * Examples:
 *   "Syncing changes…"
 *   "All changes synced. Version 42."
 *   "You are offline. Changes will be saved locally and synced when you reconnect."
 *
 * The component renders an sr-only paragraph rather than reusing the badge,
 * because (a) the badge is decorative (an aria-hidden dot + a short label),
 * and (b) we want one announcement per transition, not every re-render.
 */
export function SyncAnnouncer(): React.JSX.Element {
  const online = useEngineState((s) => s.online);
  const syncing = useEngineState((s) => s.syncing);
  const cookie = useEngineState((s) => s.cookie);

  const [message, setMessage] = useState("");
  const last = useRef<{ online: boolean; syncing: boolean; cookie: number } | null>(null);

  useEffect(() => {
    const prev = last.current;
    const next = { online, syncing, cookie };
    last.current = next;

    if (!prev) return; // skip initial mount — first state isn't a transition

    if (prev.online && !next.online) {
      setMessage(
        "You are offline. Changes will be saved locally and synced when you reconnect.",
      );
      return;
    }
    if (!prev.online && next.online) {
      setMessage("Reconnected. Catching up with the server.");
      return;
    }
    if (!prev.syncing && next.syncing) {
      setMessage("Syncing changes…");
      return;
    }
    if (prev.syncing && !next.syncing && next.online) {
      setMessage(`All changes synced. Version ${next.cookie}.`);
      return;
    }
  }, [online, syncing, cookie]);

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className={styles.srOnly}>
      {message}
    </div>
  );
}
