import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@slipstream/ui/tokens.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Slipstream — local-first sync engine, demonstrated as a tracker",
  description:
    "A hand-built local-first sync engine: optimistic mutations, server-authoritative reconciliation, offline queue. The tracker is the surface; the engine is the story.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
