import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { WebSocketServer } from "ws";
import {
  ClientMessageSchema,
  PROTOCOL_VERSION,
  PullRequestSchema,
  PushRequestSchema,
} from "@slipstream/protocol";
import { SESSION_COOKIE, createAuthRoutes, readSession } from "./auth.js";
import { getCookie } from "hono/cookie";
import { connect, type SlipstreamDb } from "./db.js";
import { applyPush } from "./push.js";
import { pull } from "./pull.js";
import { InProcessPresenceBroker, type PresenceBroker } from "./presence.js";

export interface AppDeps {
  db: SlipstreamDb;
  broker: PresenceBroker;
}

export function createApp(deps: AppDeps): Hono {
  const { db, broker } = deps;
  const app = new Hono();

  app.get("/api/sync/health", (c) =>
    c.json({
      ok: true,
      service: "slipstream-sync",
      protocolVersion: PROTOCOL_VERSION,
      milestone: "M6",
      connectedClients: broker.size(),
    }),
  );

  app.post("/api/push", async (c) => {
    const session = await readSession(db, getCookie(c, SESSION_COOKIE));
    if (!session) return c.json({ error: "unauthorized" }, 401);

    const body = await c.req.json().catch(() => ({}));
    const parsed = PushRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "bad_request", issues: parsed.error.issues }, 400);
    }
    // Defence in depth: every mutation that names a workspaceId in its args
    // must match the session's workspaceId. createWorkspace + createProject
    // declare a workspaceId; mutators that mutate an existing entity (e.g.
    // updateIssueStatus) don't — those are scoped implicitly because the
    // entity itself can only have been pulled by a member of the workspace
    // (per the pull scope above).
    for (const m of parsed.data.mutations) {
      const args = (m.args ?? {}) as { workspaceId?: string };
      if (args.workspaceId && args.workspaceId !== session.workspaceId) {
        return c.json({ error: "workspace_mismatch" }, 403);
      }
    }
    try {
      const res = await applyPush(db, parsed.data);
      // Fire-and-forget — a poke is advisory, callers don't wait for it.
      void broker.pokeAll();
      return c.json(res);
    } catch (err) {
      return c.json({ error: "push_failed", message: (err as Error).message }, 500);
    }
  });

  app.post("/api/pull", async (c) => {
    const session = await readSession(db, getCookie(c, SESSION_COOKIE));
    if (!session) return c.json({ error: "unauthorized" }, 401);

    const body = await c.req.json().catch(() => ({}));
    const parsed = PullRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "bad_request", issues: parsed.error.issues }, 400);
    }
    const res = await pull(db, parsed.data, { workspaceId: session.workspaceId });
    return c.json(res);
  });

  app.route("/", createAuthRoutes(db));

  return app;
}

/** Anything that emits `upgrade` events the way Node's http.Server does. */
type UpgradableServer = {
  on(
    event: "upgrade",
    listener: (
      req: import("node:http").IncomingMessage,
      socket: import("node:net").Socket,
      head: Buffer,
    ) => void,
  ): unknown;
};

/**
 * Authenticate a WebSocket upgrade against the session cookie. Returns the
 * authenticated session + email, or null when the request should be rejected.
 */
async function authenticateUpgrade(
  db: SlipstreamDb,
  req: import("node:http").IncomingMessage,
): Promise<{ session: import("./auth.js").AuthedSession; email: string } | null> {
  const cookies = parseCookies(req.headers.cookie ?? "");
  const token = cookies.get(SESSION_COOKIE);
  const session = await readSession(db, token);
  if (!session) return null;
  const account = await db.accounts.findOne({ _id: session.userId });
  if (!account) return null;
  return { session, email: account.email };
}

function parseCookies(header: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out.set(k, decodeURIComponent(rest.join("=") || ""));
  }
  return out;
}

export function attachSyncSocket(
  httpServer: UpgradableServer,
  broker: PresenceBroker,
  db: SlipstreamDb,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, rawSocket, head) => {
    const url = new URL(req.url ?? "/", "http://internal");
    if (url.pathname !== "/api/sync") {
      rawSocket.destroy();
      return;
    }

    void (async () => {
      const auth = await authenticateUpgrade(db, req);
      if (!auth) {
        rawSocket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        rawSocket.destroy();
        return;
      }

      wss.handleUpgrade(req, rawSocket, head, (ws) => {
        // broker.add is async (Redis writes a hash + publishes); but we
        // don't block accepting the socket on that completing. Stale
        // ordering between hello/presence vs add is fine because each
        // presence broadcast snapshots the current state from the source.
        void broker.add(ws, auth.session, auth.email);
        ws.on("close", () => void broker.remove(ws));
        ws.on("error", () => void broker.remove(ws));

        ws.on("message", (raw) => {
          let parsed;
          try {
            parsed = ClientMessageSchema.safeParse(JSON.parse(String(raw)));
          } catch {
            return;
          }
          if (!parsed.success) return;
          if (parsed.data.type === "focus") {
            void broker.setFocus(ws, parsed.data.focus);
          }
          // M3-style hello messages are dropped — the upgrade itself is the
          // authentication step now.
        });

        // Greet with the current cookie so the client can pull if it's behind.
        db.counters
          .findOne({ _id: "global" })
          .then((c) => {
            ws.send(
              JSON.stringify({
                type: "hello",
                clientID: "server",
                cookie: c?.seq ?? 0,
              }),
            );
          })
          .catch(() => {
            // best-effort; the client will sync anyway on first poke
          });
      });
    })();
  });

  return wss;
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    // eslint-disable-next-line no-console
    console.error("MONGODB_URI is not set");
    process.exit(1);
  }
  const db = await connect(uri);
  await db.ensureIndexes();

  // REDIS_URL switches the broker from in-process to Redis-backed pub/sub
  // so multiple sync instances behind a load balancer share workspace
  // presence + poke fan-out. Absent → single-instance behaviour.
  let broker: PresenceBroker;
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    const ioredis = await import("ioredis");
    // ioredis 5 ships both a CJS-style default and an ESM named export.
    // Use named — it's stable across both versions.
    const Redis = ioredis.Redis;
    const pub = new Redis(redisUrl);
    const sub = new Redis(redisUrl);
    const { RedisPresenceBroker } = await import("./presence-redis.js");
    broker = new RedisPresenceBroker(pub, sub);
    // eslint-disable-next-line no-console
    console.log(`slipstream-sync presence: Redis (${new URL(redisUrl).host})`);
  } else {
    broker = new InProcessPresenceBroker();
    // eslint-disable-next-line no-console
    console.log("slipstream-sync presence: in-process");
  }

  const app = createApp({ db, broker });

  const port = Number(process.env.PORT ?? 8787);
  const httpServer = serve({ fetch: app.fetch, port }, (info) => {
    // eslint-disable-next-line no-console
    console.log(`slipstream-sync listening on :${info.port}`);
  });
  attachSyncSocket(httpServer, broker, db);
}

// Only start the server when run as the entrypoint (not when imported by tests).
const entry = process.argv[1] ?? "";
if (entry.endsWith("server.js") || entry.endsWith("server.ts")) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("fatal:", err);
    process.exit(1);
  });
}
