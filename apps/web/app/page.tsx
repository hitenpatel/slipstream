import Link from "next/link";
import { getMe } from "@/lib/session";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const me = await getMe();
  return (
    <main className={styles.main}>
      <section className={styles.hero} aria-labelledby="pitch-title">
        <p className={styles.badge}>
          <span className={styles.badgeDot} aria-hidden="true" />
          LOCAL-FIRST · NO SAAS SHORTCUTS
        </p>
        <h1 id="pitch-title" className={styles.headline}>
          Your issues, on your machine first.
        </h1>
        <p className={styles.lede}>
          A collaborative tracker on a bespoke sync engine. It runs at the speed of local,
          then reconciles when the network catches up.
        </p>
        <div className={styles.ctaRow}>
          {me ? (
            <Link className={styles.cta} href="/app">
              Open your workspace
              <Arrow />
            </Link>
          ) : (
            <>
              <Link className={styles.cta} href="/signup">
                Start tracking
                <Arrow />
              </Link>
              <Link className={styles.ctaGhost} href="/login">
                Sign in
              </Link>
            </>
          )}
          <span className={styles.terminal} aria-hidden="true">
            tracker.hiten.dev<span className={styles.caret} />
          </span>
        </div>
      </section>

      <section className={styles.explainer} aria-labelledby="explainer-title">
        <div className={styles.explainerText}>
          <p className={styles.overline}>HOW THE SYNC ENGINE WORKS</p>
          <h2 id="explainer-title" className={styles.subHeadline}>
            Write locally. Reconcile in the slipstream.
          </h2>
          <p className={styles.explainerBody}>
            Every edit lands in a local log the instant you make it, no spinner, no round trip.
            A conflict-free replicated type folds concurrent edits together, so two people
            working offline still converge on one truth.
          </p>
          <ul className={styles.bullets}>
            <li>Edit hits the local write-ahead log immediately.</li>
            <li>Deltas stream to peers as bandwidth allows.</li>
            <li>CRDT merge guarantees every replica converges.</li>
          </ul>
        </div>
        <div className={styles.diagram}>
          <SyncDiagram />
        </div>
      </section>

      <footer className={styles.footer}>
        <a href="https://github.com/hitenpatel/slipstream" rel="noreferrer noopener">
          Repository on GitHub
        </a>
        <span aria-hidden="true">·</span>
        <a href="/api/sync/health">Sync healthcheck</a>
      </footer>
    </main>
  );
}

function Arrow(): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function SyncDiagram(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 340 200"
      role="img"
      aria-label="Local edits streaming to a peer through the sync engine, merging via CRDT into one converged truth"
    >
      <defs>
        <path id="pt" d="M70 50 C 140 50, 180 100, 250 100" />
        <path id="pb" d="M70 150 C 140 150, 180 100, 250 100" />
      </defs>
      <use href="#pt" fill="none" stroke="var(--border-strong)" strokeWidth="1.5" />
      <use href="#pb" fill="none" stroke="var(--border-strong)" strokeWidth="1.5" />
      <use
        href="#pt"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.5"
        strokeDasharray="4 10"
        className="fluxDash"
      />
      <use
        href="#pb"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.5"
        strokeDasharray="4 10"
        className="fluxDash"
      />
      <g>
        <rect x="24" y="34" width="46" height="32" rx="5" fill="var(--surface)" stroke="var(--border-strong)" />
        <text x="47" y="54" textAnchor="middle" fill="var(--text-2)" fontSize="10">you</text>
      </g>
      <g>
        <rect x="24" y="134" width="46" height="32" rx="5" fill="var(--surface)" stroke="var(--border-strong)" />
        <text x="47" y="154" textAnchor="middle" fill="var(--text-2)" fontSize="10">peer</text>
      </g>
      <circle cx="250" cy="100" r="26" fill="var(--accent-chip)" stroke="var(--accent)" strokeWidth="1.5" className="breathe" />
      <text x="250" y="97" textAnchor="middle" fill="var(--accent-hi)" fontSize="9">CRDT</text>
      <text x="250" y="108" textAnchor="middle" fill="var(--accent-hi)" fontSize="9">merge</text>
      <line x1="276" y1="100" x2="300" y2="100" stroke="var(--border-strong)" strokeWidth="1.5" />
      <rect x="300" y="86" width="32" height="28" rx="5" fill="var(--surface)" stroke="var(--st-done-fg)" />
      <text x="316" y="103" textAnchor="middle" fill="var(--st-done-fg)" fontSize="9">✓</text>
    </svg>
  );
}
