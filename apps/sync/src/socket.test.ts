import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { attachSyncSocket, createApp } from "./server.js";
import { PokeBroker } from "./poke.js";
import { startMemoryDb } from "./test-helpers.js";
import type { SlipstreamDb } from "./db.js";

let db: SlipstreamDb;
let stop: () => Promise<void>;

beforeAll(async () => {
  ({ db, stop } = await startMemoryDb());
}, 60_000);

afterAll(async () => {
  await stop();
});

// Each test gets a fresh server + broker so close events from prior tests
// can never bleed into the next assertion.
let broker: PokeBroker;
let baseUrl: string;
let closeServer: () => Promise<void>;

beforeEach(async () => {
  broker = new PokeBroker();
  const app = createApp({ db, broker });
  const httpServer = serve({ fetch: app.fetch, port: 0 });
  attachSyncSocket(httpServer, broker, db);

  await new Promise<void>((resolve) => {
    if ((httpServer as { listening?: boolean }).listening) resolve();
    else (httpServer as { once: (e: string, cb: () => void) => void }).once("listening", () => resolve());
  });
  const addr = (httpServer as { address: () => AddressInfo }).address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
  closeServer = () =>
    new Promise<void>((resolve, reject) => {
      (httpServer as { close: (cb: (err?: Error) => void) => void }).close((err) =>
        err ? reject(err) : resolve(),
      );
    });
});

afterEach(async () => {
  await closeServer();
});

/**
 * Open a WebSocket and queue incoming messages. The `ws` library does NOT
 * buffer messages received before a `'message'` listener is attached — they
 * are silently dropped. So we attach the listener synchronously with the
 * constructor and hand out a `next()` that pops the queue or waits for the
 * next arrival.
 */
async function connectWS(): Promise<WrappedWS> {
  const ws = new WebSocket(baseUrl.replace(/^http/, "ws") + "/api/sync");
  const messages: string[] = [];
  const waiters: Array<(s: string) => void> = [];
  ws.on("message", (data: WebSocket.RawData) => {
    const s = typeof data === "string" ? data : data.toString();
    if (waiters.length > 0) waiters.shift()!(s);
    else messages.push(s);
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", (err) => reject(err));
  });
  return {
    ws,
    next: () =>
      new Promise<string>((resolve) => {
        if (messages.length > 0) resolve(messages.shift()!);
        else waiters.push(resolve);
      }),
    close: () =>
      new Promise<void>((resolve) => {
        ws.once("close", () => resolve());
        ws.close();
      }),
  };
}

interface WrappedWS {
  ws: WebSocket;
  next(): Promise<string>;
  close(): Promise<void>;
}

describe("/api/sync WebSocket", () => {
  it("greets a new socket with a hello carrying the current cookie", async () => {
    const conn = await connectWS();
    const msg = JSON.parse(await conn.next());
    expect(msg.type).toBe("hello");
    expect(typeof msg.cookie).toBe("number");
    await conn.close();
  });

  it("registers and deregisters connections with the broker", async () => {
    expect(broker.size()).toBe(0);
    const conn = await connectWS();
    await conn.next(); // hello means the upgrade callback has run
    expect(broker.size()).toBe(1);

    await conn.close();
    for (let i = 0; i < 50 && broker.size() > 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(broker.size()).toBe(0);
  });

  it("pokes every connected socket when the broker fires", async () => {
    const a = await connectWS();
    const b = await connectWS();
    // Drain the hello on each so the next message is the poke.
    await a.next();
    await b.next();

    const sawA = a.next();
    const sawB = b.next();
    broker.pokeAll();
    const [msgA, msgB] = await Promise.all([sawA, sawB]);
    expect(JSON.parse(msgA).type).toBe("poke");
    expect(JSON.parse(msgB).type).toBe("poke");

    await Promise.all([a.close(), b.close()]);
  });

  it("rejects upgrades on the wrong path", async () => {
    const url = baseUrl.replace(/^http/, "ws") + "/not-the-sync-path";
    const ws = new WebSocket(url, { handshakeTimeout: 2000 });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("never closed")), 3000);
      ws.once("open", () => {
        clearTimeout(timer);
        reject(new Error("expected upgrade to fail"));
      });
      ws.once("error", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  });
});
