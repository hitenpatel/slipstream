import { redirect } from "next/navigation";
import { getMe } from "@/lib/session";
import { SignupForm } from "./signup-form";
import styles from "../login/page.module.css";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const me = await getMe();
  if (me) redirect("/app");

  return (
    <main className={styles.main}>
      <section className={styles.card} aria-labelledby="signup-title">
        <h1 id="signup-title" className={styles.title}>
          Create your Slipstream
        </h1>
        <SignupForm />
        <p className={styles.altRow}>
          Already have an account? <a href="/login">Sign in</a>
        </p>
      </section>
    </main>
  );
}
