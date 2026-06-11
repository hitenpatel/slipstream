import { NextResponse, type NextRequest } from "next/server";
import { SYNC_ORIGIN } from "@/lib/config";

/**
 * Proxy /api/auth/* to the sync server. In production Traefik routes these
 * straight to the sync container by path; this handler exists so `next dev`
 * (or any deploy where the web app and sync don't share a host) still works.
 *
 * Cookies are forwarded both ways so the session works end-to-end.
 */
export const dynamic = "force-dynamic";

async function proxy(req: NextRequest, pathParts: string[]): Promise<NextResponse> {
  const upstream = new URL(`/api/auth/${pathParts.join("/")}`, SYNC_ORIGIN);
  const init: RequestInit = {
    method: req.method,
    headers: filterRequestHeaders(req.headers),
    redirect: "manual",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }
  const res = await fetch(upstream, init);

  const out = new NextResponse(await res.arrayBuffer(), { status: res.status });
  copyResponseHeaders(res.headers, out.headers);
  return out;
}

function filterRequestHeaders(input: Headers): Headers {
  const h = new Headers();
  for (const [k, v] of input) {
    if (["host", "content-length", "connection", "transfer-encoding"].includes(k)) continue;
    h.set(k, v);
  }
  return h;
}

function copyResponseHeaders(from: Headers, to: Headers): void {
  // Set-Cookie can repeat; copy each one verbatim. NextResponse Headers stores
  // them as a single comma-separated string, which is OK for our usage (we
  // only set one cookie at a time).
  from.forEach((value, key) => {
    if (key === "content-length") return;
    to.append(key, value);
  });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxy(req, (await params).path);
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxy(req, (await params).path);
}
