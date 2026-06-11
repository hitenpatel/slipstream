import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./server.js";
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

let baseUrl: string;
let closeServer: () => Promise<void>;

beforeEach(async () => {
  const broker = new PokeBroker();
  const app = createApp({ db, broker });
  const httpServer = serve({ fetch: app.fetch, port: 0 });
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
  // wipe accounts/sessions between tests so emails don't collide
  await db.accounts.deleteMany({});
  await db.sessions.deleteMany({});
});

afterEach(async () => {
  await closeServer();
});

function getCookieValue(headers: Headers, name: string): string | undefined {
  const setCookie = headers.get("set-cookie") ?? "";
  const match = setCookie.split(/,\s*(?=[\w-]+=)/).find((c) => c.startsWith(`${name}=`));
  return match?.split(";")[0]?.split("=")[1];
}

describe("auth", () => {
  it("signup creates an account + session cookie + bootstraps a workspace", async () => {
    const res = await fetch(`${baseUrl}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "alice@example.com",
        password: "correct-horse-battery-staple",
        displayName: "Alice",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.email).toBe("alice@example.com");

    const cookie = getCookieValue(res.headers, "slipstream_session");
    expect(cookie).toBeTruthy();

    // workspace + project exist
    const ws = await db.entities.findOne({ _id: body.workspaceId });
    expect(ws?.kind).toBe("workspace");
    if (ws && ws.kind === "workspace") expect(ws.name).toContain("workspace");
    const projects = await db.entities.find({ kind: "project", workspaceId: body.workspaceId }).toArray();
    expect(projects).toHaveLength(1);

    // /me returns the user when called with the cookie
    const me = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: `slipstream_session=${cookie}` },
    });
    const meBody = await me.json();
    expect(meBody.user?.email).toBe("alice@example.com");
  });

  it("signup rejects a duplicate email", async () => {
    const body = {
      email: "alice@example.com",
      password: "correct-horse-battery-staple",
      displayName: "Alice",
    };
    await fetch(`${baseUrl}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const dup = await fetch(`${baseUrl}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(dup.status).toBe(409);
  });

  it("login accepts the right password and rejects the wrong one", async () => {
    await fetch(`${baseUrl}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "bob@example.com",
        password: "right-password",
        displayName: "Bob",
      }),
    });

    const good = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "bob@example.com", password: "right-password" }),
    });
    expect(good.status).toBe(200);
    expect(getCookieValue(good.headers, "slipstream_session")).toBeTruthy();

    const bad = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "bob@example.com", password: "wrong" }),
    });
    expect(bad.status).toBe(401);
  });

  it("logout clears the session", async () => {
    const signup = await fetch(`${baseUrl}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "carol@example.com",
        password: "another-password",
        displayName: "Carol",
      }),
    });
    const cookie = getCookieValue(signup.headers, "slipstream_session")!;
    expect(cookie).toBeTruthy();

    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { Cookie: `slipstream_session=${cookie}` },
    });
    expect(logout.status).toBe(200);

    const me = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: `slipstream_session=${cookie}` },
    });
    const meBody = await me.json();
    expect(meBody.user).toBeNull();
  });

  it("me with no cookie returns user: null", async () => {
    const me = await fetch(`${baseUrl}/api/auth/me`);
    const body = await me.json();
    expect(body.user).toBeNull();
  });
});
