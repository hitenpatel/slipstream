import Link from "next/link";
import { SYNC_ORIGIN } from "@/lib/config";
import { getMe } from "@/lib/session";
import styles from "../../login/page.module.css";

export const dynamic = "force-dynamic";

type InviteInfo = {
  workspaceId: string;
  workspaceName: string;
  inviterEmail: string;
  expiresAt: number;
};

async function fetchInvite(token: string): Promise<{ info: InviteInfo | null; error: string | null }> {
  try {
    const res = await fetch(`${SYNC_ORIGIN}/api/auth/invite/${token}`, { cache: "no-store" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { info: null, error: body.error ?? `lookup_failed_${res.status}` };
    }
    return { info: (await res.json()) as InviteInfo, error: null };
  } catch {
    return { info: null, error: "lookup_failed" };
  }
}

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const me = await getMe();

  // Block already-signed-in users so they don't accidentally invalidate
  // the invite by trying to redeem it on an existing session. M7b ships
  // signup-only invite acceptance; switching workspaces from an existing
  // session is a future PR.
  const meOnDifferentWorkspace = !!me;

  const { info, error } = await fetchInvite(token);

  return (
    <main className={styles.main}>
      <section className={styles.card} aria-labelledby="join-title">
        <h1 id="join-title" className={styles.title}>
          {info ? `Join ${info.workspaceName}` : "Invite"}
        </h1>

        {info ? (
          <>
            <p>
              <strong>{info.inviterEmail}</strong> invited you to join{" "}
              <strong>{info.workspaceName}</strong>.
            </p>
            {meOnDifferentWorkspace ? (
              <>
                <p className={styles.altRow}>
                  You&apos;re currently signed in as{" "}
                  <code>{me!.email}</code>. To accept this invite, sign out
                  first and create a fresh account.
                </p>
                <Link className={styles.altRow} href="/app">Open your current workspace</Link>
              </>
            ) : (
              <p className={styles.altRow}>
                <Link
                  href={`/signup?invite=${encodeURIComponent(token)}`}
                  className={styles.title}
                  style={{ fontSize: "1rem" }}
                >
                  Create an account to join →
                </Link>
              </p>
            )}
          </>
        ) : error === "invite_expired" ? (
          <>
            <p>This invite has expired.</p>
            <p className={styles.altRow}>
              Ask whoever invited you to generate a fresh link.
            </p>
          </>
        ) : error === "invite_already_used" ? (
          <>
            <p>This invite has already been used.</p>
            <p className={styles.altRow}>
              Each invite link works once. Ask for a new one.
            </p>
          </>
        ) : (
          <>
            <p>This invite link isn&apos;t valid.</p>
            <p className={styles.altRow}>
              Double-check the link, or ask the inviter to send a new one.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
