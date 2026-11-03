import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getMe } from "@/lib/session";
import { AppShell } from "./app-shell";
import { EngineProvider } from "./engine-provider";

import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect("/login?next=/app");

  return (
    <EngineProvider me={me}>
      <AppShell>{children}</AppShell>
    </EngineProvider>
  );
}
