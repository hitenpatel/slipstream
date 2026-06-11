import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getMe } from "@/lib/session";
import { EngineProvider } from "./engine-provider";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect("/login?next=/app");

  return (
    <EngineProvider me={me}>
      {children}
    </EngineProvider>
  );
}
