import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { WebSocketServer } from "ws";
import {
  PROTOCOL_VERSION,
  PullRequestSchema,
  PushRequestSchema,
} from "@slipstream/protocol";
import { createAuthRoutes } from "./auth.js";
import { connect, type SlipstreamDb } from "./db.js";
import { applyPush } from "./push.js";
import { pull } from "./pull.js";
import { PokeBroker } from "./poke.js";

export interface AppDeps {
  db: SlipstreamDb;
  broker: PokeBroker;
}

export function createApp(deps: AppDeps): Hono {
  const { db, broker } = deps;
  const app = new Hono();

  app.get("/api/sync/health", (c) =>
    c.json({
      ok: true,
      service: "slipstream-sync",
      protocolVersion: PROTOCOL_VERSION,
      milestone: "M4",
      connectedClients: broker.size(),
    }),
  );

  app.post("/api/push", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = PushRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "bad_request", issues: parsed.error.issues }, 400);
    }
    try {
      const res = await applyPush(db, parsed.data);
      // Notify other tabs/clients there's something new to pull. Cheap to
      // fan out to everyone for now (see PokeBroker for the M4 workspace scope).
      broker.pokeAll();
      return c.json(res);
    } catch (err) {
      return c.json({ error: "push_failed", message: (err as Error).message }, 500);
    }
  });

  app.post("/api/pull", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = PullRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "bad_request", issues: parsed.error.issues }, 400);
    }
    const res = await pull(db, parsed.data);
    return c.json(res);
  });

  app.route("/", createAuthRoutes(db));

  return app;
}

/**
 * Attach a WebSocketServer to a Node HTTP server, routing upgrades on
 * /api/sync to the PokeBroker. Each socket gets a tiny `hello` from the server
 * with the current cookie, so even a freshly connected client knows whether to
 * pull. Inbound messages are silently dropped (M3 doesn't accept anything yet).
 */
/** Anything that emits `upgrade` events the way Node's http.Server does. */
type UpgradableServer = {
  on(event: "upgrade", listener: (req: import("node:http").IncomingMessage, socket: import("node:net").Socket, head: Buffer) => void): unknown;
};

export function attachSyncSocket(
  httpServer: UpgradableServer,
  broker: PokeBroker,
  db: SlipstreamDb,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, rawSocket, head) => {
    const url = new URL(req.url ?? "/", "http://internal");
    if (url.pathname !== "/api/sync") {
      rawSocket.destroy();
      return;
    }
    wss.handleUpgrade(req, rawSocket, head, (ws) => {
      broker.add(ws);
      ws.on("close", () => broker.remove(ws));
      ws.on("error", () => broker.remove(ws));
      // greet with the current cookie so the client can pull if it's behind
      db.counters
        .findOne({ _id: "global" })
        .then((c) => {
          ws.send(JSON.stringify({ type: "hello", clientID: "server", cookie: c?.seq ?? 0 }));
        })
        .catch(() => {
          // best-effort; the client will sync anyway on first poke
        });
    });
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
  const broker = new PokeBroker();
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
