import { redirect } from "next/navigation";
import { getMe } from "@/lib/session";
import { LoginForm } from "./login-form";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const me = await getMe();
  const { next } = await searchParams;
  if (me) redirect(next && next.startsWith("/") ? next : "/app");

  return (
    <main className={styles.main}>
      <section className={styles.card} aria-labelledby="login-title">
        <h1 id="login-title" className={styles.title}>
          Sign in to Slipstream
        </h1>
        <LoginForm next={next} />
        <p className={styles.altRow}>
          New here? <a href="/signup">Create an account</a>
        </p>
      </section>
    </main>
  );
}
