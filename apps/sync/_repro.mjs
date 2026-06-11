import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { WebSocketServer } from "ws";
import WebSocket from "ws";

const sockets = new Set();
const app = new Hono();
const wss = new WebSocketServer({ noServer: true });
const httpServer = serve({ fetch: app.fetch, port: 0 });
httpServer.on("upgrade", (req, sock, head) => {
  if (req.url !== "/api/sync") { sock.destroy(); return; }
  wss.handleUpgrade(req, sock, head, (ws) => {
    sockets.add(ws);
    ws.send(JSON.stringify({ type: "hello" }));
  });
});

await new Promise((r) => httpServer.once("listening", r));
const port = httpServer.address().port;
console.log("listening", port);
const a = new WebSocket(`ws://127.0.0.1:${port}/api/sync`);
const b = new WebSocket(`ws://127.0.0.1:${port}/api/sync`);
await Promise.all([
  new Promise((r) => a.once("open", r)),
  new Promise((r) => b.once("open", r)),
]);
console.log("both opened, sockets=", sockets.size);
await Promise.all([
  new Promise((r) => a.once("message", () => { console.log("a hello"); r(); })),
  new Promise((r) => b.once("message", () => { console.log("b hello"); r(); })),
]);
const sawA = new Promise((r) => a.once("message", () => { console.log("a poke"); r(); }));
const sawB = new Promise((r) => b.once("message", () => { console.log("b poke"); r(); }));
for (const s of sockets) s.send(JSON.stringify({ type: "poke" }));
console.log("poke sent, sockets=", sockets.size);
await Promise.race([
  Promise.all([sawA, sawB]).then(() => console.log("BOTH SAW POKE")),
  new Promise((_, j) => setTimeout(() => j(new Error("timeout 3s")), 3000)),
]).catch((e) => console.log("FAILED:", e.message));
process.exit(0);
