import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Fraunces, Inter, Space_Mono, JetBrains_Mono } from "next/font/google";
import "@slipstream/ui/tokens.css";
import "./globals.css";

// Fraunces carries the display voice — a variable serif with real warmth,
// swapped in from the flatter Space Grotesk so the headings feel written
// rather than generated. Axes: weight + optical sizing.
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: "variable",
  style: ["normal", "italic"],
  variable: "--font-display-loaded",
  display: "swap",
  axes: ["opsz", "SOFT"],
});

// Inter runs body copy. Chosen for readability at the small-body scale
// after the system stack read as too shape-agnostic against the serif.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body-loaded",
  display: "swap",
});

// Space Mono fingerprints ticket IDs and priority chips.
const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-id-loaded",
  display: "swap",
});

// JetBrains Mono handles inline code, sync badges, keyboard hints.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono-loaded",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://tracker.hiten.dev"),
  title: "Slipstream — local-first sync engine, demonstrated as a tracker",
  description:
    "A hand-built local-first sync engine: optimistic mutations, server-authoritative reconciliation, offline queue. The tracker is the surface; the engine is the story.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "https://tracker.hiten.dev",
    siteName: "Slipstream",
    title: "Slipstream — local-first sync engine, demonstrated as a tracker",
    description:
      "A hand-built local-first sync engine: optimistic mutations, server-authoritative reconciliation, offline queue. The tracker is the surface; the engine is the story.",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Slipstream — local-first sync engine, demonstrated as a tracker",
    description:
      "A hand-built local-first sync engine: optimistic mutations, server-authoritative reconciliation, offline queue.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0c0f" },
    { media: "(prefers-color-scheme: light)", color: "#f6f8fa" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${inter.variable} ${spaceMono.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
