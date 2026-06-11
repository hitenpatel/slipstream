import { getMe } from "@/lib/session";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const me = await getMe();
  return (
    <main className={styles.main}>
      <section className={styles.hero} aria-labelledby="pitch-title">
        <p className={styles.eyebrow}>Slipstream</p>
        <h1 id="pitch-title" className={styles.headline}>
          Local-first sync, built from scratch.
        </h1>
        <p className={styles.lede}>
          Optimistic mutations on the client. A server-authoritative mutation log on the server.
          Deterministic rebasing on every pull, an offline queue that survives reload, and a single
          global counter inside a MongoDB transaction that serialises concurrent pushes into one
          total order.
        </p>
        <p className={styles.lede}>
          The tracker is the surface. The engine is the story.
        </p>
        <ul className={styles.milestones} aria-label="Build milestones">
          <li><strong>M0</strong> Scaffold, CI, hello-world over TLS <em aria-label="current">— you are here</em></li>
          <li><strong>M1</strong> Data model, mutators, server reconciliation</li>
          <li><strong>M2</strong> Client sync runtime: outbox, optimistic apply, rebase</li>
          <li><strong>M3</strong> WebSocket transport, poke-and-pull</li>
          <li><strong>M4</strong> Tracker UI MVP — board, list, palette</li>
          <li><strong>M5</strong> Accessibility: keyboard DnD, live regions, axe-clean</li>
          <li><strong>M6</strong> Presence, polish, the front-door README</li>
        </ul>
        <p className={styles.ctaRow}>
          {me ? (
            <a className={styles.cta} href="/app">Open your workspace →</a>
          ) : (
            <>
              <a className={styles.cta} href="/signup">Create an account</a>
              <a className={styles.ctaGhost} href="/login">Sign in</a>
            </>
          )}
        </p>
        <p className={styles.linkRow}>
          <a href="https://github.com/hitenpatel/slipstream" rel="noreferrer noopener">
            Repository on GitHub
          </a>
          {" · "}
          <a href="/api/sync/health">Sync healthcheck</a>
        </p>
      </section>
    </main>
  );
}
