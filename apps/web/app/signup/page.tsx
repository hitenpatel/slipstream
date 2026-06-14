import { redirect } from "next/navigation";
import { SYNC_ORIGIN } from "@/lib/config";
import { getMe } from "@/lib/session";
import { SignupForm } from "./signup-form";
import styles from "../login/page.module.css";

export const dynamic = "force-dynamic";

async function lookupInvite(token: string): Promise<{ workspaceName: string; inviterEmail: string } | null> {
  try {
    const res = await fetch(`${SYNC_ORIGIN}/api/auth/invite/${token}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as { workspaceName: string; inviterEmail: string };
  } catch {
    return null;
  }
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const me = await getMe();
  if (me) redirect("/app");

  const { invite } = await searchParams;
  const inviteInfo = invite ? await lookupInvite(invite) : null;

  return (
    <main className={styles.main}>
      <section className={styles.card} aria-labelledby="signup-title">
        <h1 id="signup-title" className={styles.title}>
          {inviteInfo ? `Join ${inviteInfo.workspaceName}` : "Create your Slipstream"}
        </h1>
        {inviteInfo ? (
          <p>
            Joining as a teammate of <strong>{inviteInfo.inviterEmail}</strong>.
            No new workspace will be created.
          </p>
        ) : null}
        <SignupForm inviteToken={invite ?? null} />
        <p className={styles.altRow}>
          Already have an account? <a href="/login">Sign in</a>
        </p>
      </section>
    </main>
  );
}
