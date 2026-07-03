import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Space_Grotesk, Space_Mono, JetBrains_Mono } from "next/font/google";
import "@slipstream/ui/tokens.css";
import "./globals.css";

// Space Grotesk carries the display voice — mechanical edge for headings.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display-loaded",
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
  title: "Slipstream — local-first sync engine, demonstrated as a tracker",
  description:
    "A hand-built local-first sync engine: optimistic mutations, server-authoritative reconciliation, offline queue. The tracker is the surface; the engine is the story.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${spaceMono.variable} ${jetbrainsMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
