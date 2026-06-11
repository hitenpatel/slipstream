// M0 sync server. A real /api/push and /api/pull land in M1; the WebSocket lands in M3.
// For now it answers a healthcheck so the Traefik router has something to hit.

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { PROTOCOL_VERSION } from "@slipstream/protocol";

const app = new Hono();

app.get("/api/sync/health", (c) =>
  c.json({
    ok: true,
    service: "slipstream-sync",
    protocolVersion: PROTOCOL_VERSION,
    milestone: "M0",
  }),
);

// Push and pull stubs return 501 until M1 ships the real handlers.
app.post("/api/push", (c) =>
  c.json({ error: "not_implemented", milestone: "M1" }, 501),
);
app.post("/api/pull", (c) =>
  c.json({ error: "not_implemented", milestone: "M1" }, 501),
);

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`slipstream-sync listening on :${info.port}`);
});
