"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./invite-dialog.module.css";

/**
 * Small modal that POSTs /api/auth/invite to mint a fresh invite, then shows
 * the resulting /join/<token> URL with a Copy button. URL composition lives
 * client-side so the server doesn't need to know the public origin.
 *
 * Accessibility: role=dialog, aria-modal, focus moves to the URL field on
 * open, Escape closes, click-outside on the scrim closes (via a sibling
 * close button so the scrim itself stays a presentational backdrop).
 */
export function InviteDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.JSX.Element | null {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setUrl(null);
      setError(null);
      setCopied(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/invite", {
          method: "POST",
          credentials: "include",
        });
        if (cancelled) return;
        if (!res.ok) {
          setError("Could not create invite. Try again.");
          return;
        }
        const body = (await res.json()) as { token: string };
        setUrl(`${window.location.origin}/join/${body.token}`);
        // Move focus to the URL field once it renders so the user can press
        // Cmd/Ctrl-C immediately. We avoid autoFocus per the M5 a11y pass.
        requestAnimationFrame(() => {
          urlRef.current?.focus();
          urlRef.current?.select();
        });
      } catch {
        if (!cancelled) setError("Could not create invite. Try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function copy(): Promise<void> {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (!open) return null;

  return (
    <div className={styles.scrim}>
      <button
        type="button"
        className={styles.scrimButton}
        aria-label="Close invite dialog"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-title"
        className={styles.dialog}
      >
        <header className={styles.header}>
          <h2 id="invite-title" className={styles.title}>
            Invite a teammate
          </h2>
          <button
            type="button"
            onClick={onClose}
            className={styles.close}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <p className={styles.muted}>
          Share this link. It expires in 7 days and works once.
        </p>

        {error ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : url ? (
          <div className={styles.row}>
            <label className={styles.srOnly} htmlFor="invite-url">
              Invite URL
            </label>
            <input
              ref={urlRef}
              id="invite-url"
              type="text"
              readOnly
              value={url}
              className={styles.input}
              onFocus={(e) => e.target.select()}
            />
            <button type="button" onClick={copy} className={styles.copyBtn}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        ) : (
          <p className={styles.muted}>Generating…</p>
        )}
      </div>
    </div>
  );
}
