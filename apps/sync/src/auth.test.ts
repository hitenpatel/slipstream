import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./server.js";
import { PresenceBroker } from "./presence.js";
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
  const broker = new PresenceBroker();
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
  // wipe accounts/sessions/invites/entities between tests so state is clean
  await db.accounts.deleteMany({});
  await db.sessions.deleteMany({});
  await db.invites.deleteMany({});
  await db.entities.deleteMany({});
  await db.clients.deleteMany({});
  await db.counters.deleteMany({});
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

async function signup(baseUrl: string, email: string): Promise<{ cookie: string; body: { workspaceId: string; userId: string } }> {
  const res = await fetch(`${baseUrl}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "correct-horse-battery-staple", displayName: email.split("@")[0] }),
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  const m = setCookie.match(/slipstream_session=([^;]+)/);
  if (!m) throw new Error(`no session cookie: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { workspaceId: string; userId: string };
  return { cookie: m[1]!, body };
}

describe("invites", () => {
  it("authed user can create an invite for their workspace", async () => {
    const alice = await signup(baseUrl, "alice@example.com");

    const res = await fetch(`${baseUrl}/api/auth/invite`, {
      method: "POST",
      headers: { Cookie: `slipstream_session=${alice.cookie}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toMatch(/^[a-f0-9]{64}$/);
    expect(body.expiresAt).toBeGreaterThan(Date.now());
  });

  it("public lookup returns workspace name + inviter email", async () => {
    const alice = await signup(baseUrl, "alice@example.com");
    const created = await fetch(`${baseUrl}/api/auth/invite`, {
      method: "POST",
      headers: { Cookie: `slipstream_session=${alice.cookie}` },
    }).then((r) => r.json());

    const lookup = await fetch(`${baseUrl}/api/auth/invite/${created.token}`);
    expect(lookup.status).toBe(200);
    const body = await lookup.json();
    expect(body.inviterEmail).toBe("alice@example.com");
    expect(body.workspaceName).toMatch(/workspace/);
    expect(body.workspaceId).toBe(alice.body.workspaceId);
  });

  it("signup with valid invite joins the existing workspace (no bootstrap)", async () => {
    const alice = await signup(baseUrl, "alice@example.com");
    const created = await fetch(`${baseUrl}/api/auth/invite`, {
      method: "POST",
      headers: { Cookie: `slipstream_session=${alice.cookie}` },
    }).then((r) => r.json());

    // Alice's workspace has a project already (the Welcome bootstrap).
    const projectsBefore = await db.entities.countDocuments({
      kind: "project",
      workspaceId: alice.body.workspaceId,
    });
    expect(projectsBefore).toBe(1);

    const bobRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "bob@example.com",
        password: "correct-horse-battery-staple",
        displayName: "Bob",
        inviteToken: created.token,
      }),
    });
    expect(bobRes.status).toBe(200);
    const bob = await bobRes.json();
    expect(bob.workspaceId).toBe(alice.body.workspaceId);
    expect(bob.joinedViaInvite).toBe(true);

    // Joining didn't create a second workspace or a duplicate project.
    const workspaces = await db.entities.countDocuments({ kind: "workspace" });
    expect(workspaces).toBe(1);
    const projectsAfter = await db.entities.countDocuments({
      kind: "project",
      workspaceId: alice.body.workspaceId,
    });
    expect(projectsAfter).toBe(1);
  });

  it("signup with already-used invite is rejected with 409", async () => {
    const alice = await signup(baseUrl, "alice@example.com");
    const created = await fetch(`${baseUrl}/api/auth/invite`, {
      method: "POST",
      headers: { Cookie: `slipstream_session=${alice.cookie}` },
    }).then((r) => r.json());

    // First Bob redeems it.
    await fetch(`${baseUrl}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "bob@example.com",
        password: "correct-horse-battery-staple",
        displayName: "Bob",
        inviteToken: created.token,
      }),
    });
    // Second Bob tries to use the same token.
    const second = await fetch(`${baseUrl}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "bob2@example.com",
        password: "correct-horse-battery-staple",
        displayName: "Bob 2",
        inviteToken: created.token,
      }),
    });
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.error).toBe("invite_already_used");
  });

  it("signup with unknown token returns 404", async () => {
    const res = await fetch(`${baseUrl}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "bob@example.com",
        password: "correct-horse-battery-staple",
        displayName: "Bob",
        inviteToken: "deadbeef".repeat(8),
      }),
    });
    expect(res.status).toBe(404);
  });

  it("lookup of expired invite returns 410", async () => {
    const alice = await signup(baseUrl, "alice@example.com");
    const created = await fetch(`${baseUrl}/api/auth/invite`, {
      method: "POST",
      headers: { Cookie: `slipstream_session=${alice.cookie}` },
    }).then((r) => r.json());

    await db.invites.updateOne(
      { _id: created.token },
      { $set: { expiresAt: Date.now() - 1 } },
    );

    const res = await fetch(`${baseUrl}/api/auth/invite/${created.token}`);
    expect(res.status).toBe(410);
  });
});

describe("pull workspace isolation", () => {
  it("a member of workspace A cannot pull entities from workspace B", async () => {
    const alice = await signup(baseUrl, "alice@example.com");
    const carol = await signup(baseUrl, "carol@example.com");
    expect(alice.body.workspaceId).not.toBe(carol.body.workspaceId);

    // Alice pulls — should see entities from her workspace only.
    const alicePull = await fetch(`${baseUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `slipstream_session=${alice.cookie}` },
      body: JSON.stringify({ clientID: alice.body.userId, cookie: 0 }),
    });
    expect(alicePull.status).toBe(200);
    const aliceBody = await alicePull.json();
    for (const op of aliceBody.patch) {
      if (op.op === "put") expect(op.entity.workspaceId).toBe(alice.body.workspaceId);
    }
    expect(aliceBody.patch.length).toBeGreaterThan(0); // her bootstrap exists
  });

  it("pull without a session cookie is rejected with 401", async () => {
    const res = await fetch(`${baseUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientID: "x", cookie: 0 }),
    });
    expect(res.status).toBe(401);
  });

  it("push that names a foreign workspaceId is rejected with 403", async () => {
    const alice = await signup(baseUrl, "alice@example.com");
    const foreignWorkspaceId = "019eb800-0000-7000-8000-000000000fff";

    const res = await fetch(`${baseUrl}/api/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `slipstream_session=${alice.cookie}` },
      body: JSON.stringify({
        clientID: alice.body.userId,
        mutations: [
          {
            id: 1,
            clientID: alice.body.userId,
            name: "createProject",
            args: {
              id: "019eb800-0000-7000-8000-000000000001",
              workspaceId: foreignWorkspaceId,
              name: "Stolen",
              key: "X",
            },
          },
        ],
      }),
    });
    expect(res.status).toBe(403);
  });
});
