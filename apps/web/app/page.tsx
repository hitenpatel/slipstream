import Link from "next/link";
import { getMe } from "@/lib/session";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Slipstream",
  url: "https://tracker.hiten.dev",
  description:
    "A collaborative issue tracker built on a hand-written local-first sync engine: optimistic mutations, server-authoritative reconciliation, conflict-free merges, and an offline queue that survives reload.",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Web",
  browserRequirements: "Requires JavaScript",
  offers: { "@type": "Offer", price: "0", priceCurrency: "GBP" },
  author: {
    "@type": "Person",
    name: "Hiten Patel",
    url: "https://hiten.dev",
    jobTitle: "Senior Frontend Engineer",
  },
};

export default async function HomePage() {
  const me = await getMe();
  return (
    <main className={styles.main}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <section className={styles.hero} aria-labelledby="pitch-title">
        <p className={styles.badge}>
          <span className={styles.badgeDot} aria-hidden="true" />
          LOCAL-FIRST · NO SAAS SHORTCUTS
        </p>
        <h1 id="pitch-title" className={styles.headline}>
          A tracker I built to prove
          <em> a point.</em>
        </h1>
        <p className={styles.lede}>
          Every mainstream tracker leans on a hosted sync provider I don&rsquo;t control.
          So I wrote my own from scratch: optimistic mutations, a server-authoritative log,
          conflict-free merges, an offline queue that survives reload. Then I put a Linear-shaped
          tracker on top so you can actually feel it work.
        </p>
        <div className={styles.ctaRow}>
          {me ? (
            <Link className={styles.cta} href="/app">
              Open your workspace
              <Arrow />
            </Link>
          ) : (
            <>
              <Link className={styles.cta} href="/login?demo=1">
                Try the demo
                <Arrow />
              </Link>
              <Link className={styles.ctaGhost} href="/signup">
                Or sign up
              </Link>
            </>
          )}
          <span className={styles.terminal} aria-hidden="true">
            tracker.hiten.dev<span className={styles.caret} />
          </span>
        </div>
        {me ? null : (
          <p className={styles.demoNote}>
            The demo workspace is shared on purpose. Open it in two tabs, edit both, watch them
            converge live. That&rsquo;s the sync engine, doing the thing.
          </p>
        )}
      </section>

      <section className={styles.explainer} aria-labelledby="explainer-title">
        <div className={styles.explainerText}>
          <p className={styles.overline}>HOW THE SYNC ENGINE WORKS</p>
          <h2 id="explainer-title" className={styles.subHeadline}>
            Write locally. Reconcile <em>in the slipstream.</em>
          </h2>
          <p className={styles.explainerBody}>
            Every edit lands in a local log the instant you make it. No spinner, no round trip.
            When the network shows up, a CRDT folds concurrent edits together, so two people
            working offline still end up on one truth. You don&rsquo;t notice it. That&rsquo;s the compliment.
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

      <section className={styles.byline} aria-labelledby="byline-title">
        <p className={styles.overline}>WHO BUILT THIS</p>
        <h2 id="byline-title" className={styles.bylineTitle}>
          I&rsquo;m Hiten.
        </h2>
        <p className={styles.bylineBody}>
          I&rsquo;m a full-stack engineer. I built Slipstream partly because I wanted to
          go deep on the mechanics of a sync engine (mutators, optimistic apply,
          deterministic rebase, transactional counters, CRDTs, a WebSocket poke channel)
          and partly because I got tired of every demo project reaching for the same three
          SaaS logos. If you&rsquo;re curious about the engine, everything is open-source, the
          commit history reads as a build log, and the architecture doc lives in the repo.
        </p>
        <p className={styles.bylineLinks}>
          <a href="https://github.com/hitenpatel/slipstream" rel="noreferrer noopener">
            source on GitHub
          </a>
          <span aria-hidden="true">·</span>
          <a href="https://github.com/hitenpatel/slipstream/blob/main/docs/ARCHITECTURE.md" rel="noreferrer noopener">
            architecture doc
          </a>
          <span aria-hidden="true">·</span>
          <a href="https://hiten.dev" rel="noreferrer noopener">
            hiten.dev
          </a>
        </p>
      </section>

      <footer className={styles.footer}>
        <span>
          Built by Hiten Patel, {new Date().getFullYear()}. Hosted on a Synology NAS behind Traefik,
          hibernated by Sablier.
        </span>
        <a href="/api/sync/health">sync healthcheck</a>
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
