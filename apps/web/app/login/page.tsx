import { redirect } from "next/navigation";
import { getMe } from "@/lib/session";
import { LoginForm } from "./login-form";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

// Kept in sync with apps/sync/src/seed.ts. Publicly known; the demo
// workspace is shared by design.
const DEMO_EMAIL = "demo@slipstream.dev";
const DEMO_PASSWORD = "try-slipstream-2026";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; demo?: string }>;
}) {
  const me = await getMe();
  const { next, demo } = await searchParams;
  if (me) redirect(next && next.startsWith("/") ? next : "/app");
  const isDemo = demo === "1";

  return (
    <main className={styles.main}>
      <section className={styles.card} aria-labelledby="login-title">
        <h1 id="login-title" className={styles.title}>
          {isDemo ? "Try the demo" : "Sign in to Slipstream"}
        </h1>
        {isDemo ? (
          <p className={styles.demoBlurb}>
            The demo workspace is shared — two tabs, two people, both editing at once will
            converge live. That is the whole point of the sync engine.
          </p>
        ) : null}
        <LoginForm
          next={next}
          initialEmail={isDemo ? DEMO_EMAIL : undefined}
          initialPassword={isDemo ? DEMO_PASSWORD : undefined}
        />
        <p className={styles.altRow}>
          {isDemo ? (
            <>
              Prefer your own workspace? <a href="/signup">Create an account</a>
            </>
          ) : (
            <>
              New here? <a href="/signup">Create an account</a>
              {" · "}
              <a href="/login?demo=1">Try the demo</a>
            </>
          )}
        </p>
      </section>
    </main>
  );
}
