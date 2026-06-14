import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { attachSyncSocket, createApp } from "./server.js";
import { InProcessPresenceBroker } from "./presence.js";
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
let broker: InProcessPresenceBroker;
let baseUrl: string;
let closeServer: () => Promise<void>;

beforeEach(async () => {
  await db.accounts.deleteMany({});
  await db.sessions.deleteMany({});
  broker = new InProcessPresenceBroker();
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
 * Sign up via the auth route and return the session cookie value. Tests use
 * this to obtain a valid cookie for the WS upgrade (which is now auth-gated).
 */
async function signupCookie(emailPrefix: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `${emailPrefix}@example.com`,
      password: "correct-horse-battery-staple",
      displayName: emailPrefix,
    }),
  });
  if (!res.ok) throw new Error(`signup failed: ${res.status}`);
  const setCookie = res.headers.get("set-cookie") ?? "";
  const m = setCookie.match(/slipstream_session=([^;]+)/);
  if (!m) throw new Error("no session cookie in signup response");
  return m[1]!;
}

/**
 * Open an authenticated WebSocket. The `ws` library does NOT buffer messages
 * received before a `'message'` listener is attached — they are silently
 * dropped. So we attach the listener synchronously with the constructor and
 * hand out a `next()` that pops the queue or waits for the next arrival.
 */
async function connectWS(cookie: string): Promise<WrappedWS> {
  const ws = new WebSocket(baseUrl.replace(/^http/, "ws") + "/api/sync", {
    headers: { Cookie: `slipstream_session=${cookie}` },
  });
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
    nextOfType: (type: string) =>
      new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no message of type ${type}`)), 3000);

        // First look at messages already queued; the rest stays in the queue.
        for (let i = 0; i < messages.length; i++) {
          const parsed = JSON.parse(messages[i]!);
          if (parsed.type === type) {
            messages.splice(i, 1);
            clearTimeout(timer);
            resolve(parsed);
            return;
          }
        }
        // Otherwise wait for the next message; if it isn't ours, push it back
        // and keep waiting.
        const skipped: string[] = [];
        const drain = async (): Promise<void> => {
          while (true) {
            const raw = await new Promise<string>((r) => {
              if (messages.length > 0) r(messages.shift()!);
              else waiters.push(r);
            });
            const parsed = JSON.parse(raw);
            if (parsed.type === type) {
              messages.unshift(...skipped);
              clearTimeout(timer);
              resolve(parsed);
              return;
            }
            skipped.push(raw);
          }
        };
        void drain();
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
  nextOfType(type: string): Promise<unknown>;
  close(): Promise<void>;
}

describe("/api/sync WebSocket", () => {
  it("greets a new socket with a hello carrying the current cookie", async () => {
    const cookie = await signupCookie("alice");
    const conn = await connectWS(cookie);
    const hello = (await conn.nextOfType("hello")) as { type: string; cookie: number };
    expect(hello.type).toBe("hello");
    expect(typeof hello.cookie).toBe("number");
    await conn.close();
  });

  it("registers and deregisters connections with the broker", async () => {
    const cookie = await signupCookie("bob");
    expect(broker.size()).toBe(0);
    const conn = await connectWS(cookie);
    await conn.nextOfType("hello");
    expect(broker.size()).toBe(1);

    await conn.close();
    for (let i = 0; i < 50 && broker.size() > 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(broker.size()).toBe(0);
  });

  it("pokes every connected socket when the broker fires", async () => {
    const aCookie = await signupCookie("carol");
    const bCookie = await signupCookie("dave");
    const a = await connectWS(aCookie);
    const b = await connectWS(bCookie);
    await a.nextOfType("hello");
    await b.nextOfType("hello");

    const sawA = a.nextOfType("poke");
    const sawB = b.nextOfType("poke");
    broker.pokeAll();
    await Promise.all([sawA, sawB]);

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

  it("rejects upgrades without a session cookie", async () => {
    const url = baseUrl.replace(/^http/, "ws") + "/api/sync";
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

  it("broadcasts presence to workspace peers when a client publishes a focus", async () => {
    const aCookie = await signupCookie("eve");
    const a = await connectWS(aCookie);
    await a.nextOfType("hello");
    await a.nextOfType("presence"); // initial empty-ish snapshot on join

    // Eve focuses an issue. Her own socket should see itself in the presence list.
    a.ws.send(JSON.stringify({ type: "focus", focus: { kind: "issue", id: "abc" } }));
    const update = (await a.nextOfType("presence")) as {
      users: Array<{ userId: string; email: string; focus: { kind: string; id: string } | null }>;
    };
    expect(update.users.find((u) => u.email === "eve@example.com")?.focus).toEqual({
      kind: "issue",
      id: "abc",
    });
    await a.close();
  });
});
