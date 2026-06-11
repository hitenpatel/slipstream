"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../login/page.module.css";

export function SignupForm(): React.JSX.Element {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password, displayName }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (body.error === "email_taken") {
          setError("An account with that email already exists.");
        } else if (res.status === 400) {
          setError("Check your email and password (at least 8 characters).");
        } else {
          setError("Something went wrong.");
        }
        return;
      }
      router.push("/app");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className={styles.form} noValidate>
      <label className={styles.field}>
        <span className={styles.label}>Display name</span>
        <input
          autoComplete="name"
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Email</span>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Password (8+ characters)</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      <button type="submit" className={styles.primary} disabled={busy}>
        {busy ? "Creating…" : "Create account"}
      </button>
    </form>
  );
}
