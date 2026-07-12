import type { NextRequest } from "next/server";
import { SYNC_ORIGIN } from "@/lib/config";

/**
 * Proxy /api/ai/* to the sync server, mirroring the /api/auth proxy. A
 * next.config rewrite won't do here: rewrite destinations are baked into the
 * build manifest, so the e2e harness (sync on a non-default port) would
 * proxy into the void. This handler reads SYNC_ORIGIN at request time and
 * passes the SSE body through as a stream rather than buffering it.
 */
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await params;
  const upstream = new URL(`/api/ai/${path.join("/")}`, SYNC_ORIGIN);
  const res = await fetch(upstream, {
    method: "POST",
    headers: {
      "content-type": req.headers.get("content-type") ?? "application/json",
      cookie: req.headers.get("cookie") ?? "",
    },
    body: await req.text(),
  });
  return new Response(res.body, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/json",
      "cache-control": "no-cache",
    },
  });
}
