import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  PROTOCOL_VERSION,
  PullRequestSchema,
  PushRequestSchema,
} from "@slipstream/protocol";
import { connect, type SlipstreamDb } from "./db.js";
import { applyPush } from "./push.js";
import { pull } from "./pull.js";

export function createApp(db: SlipstreamDb): Hono {
  const app = new Hono();

  app.get("/api/sync/health", (c) =>
    c.json({
      ok: true,
      service: "slipstream-sync",
      protocolVersion: PROTOCOL_VERSION,
      milestone: "M1",
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

  return app;
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
  const app = createApp(db);

  const port = Number(process.env.PORT ?? 8787);
  serve({ fetch: app.fetch, port }, (info) => {
    // eslint-disable-next-line no-console
    console.log(`slipstream-sync listening on :${info.port}`);
  });
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
