import { cookies } from "next/headers";
import { SYNC_ORIGIN } from "./config";

export interface Me {
  userId: string;
  email: string;
  workspaceId: string;
}

/**
 * Server-side session lookup. Forwards the slipstream_session cookie to the
 * sync server's /api/auth/me. Returns null when no cookie is present or the
 * sync server says we're anonymous.
 */
export async function getMe(): Promise<Me | null> {
  const jar = await cookies();
  const token = jar.get("slipstream_session")?.value;
  if (!token) return null;

  try {
    const res = await fetch(`${SYNC_ORIGIN}/api/auth/me`, {
      headers: { Cookie: `slipstream_session=${token}` },
      // Always re-check; the session is auth, not content.
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { user: Me | null };
    return body.user ?? null;
  } catch {
    return null;
  }
}
