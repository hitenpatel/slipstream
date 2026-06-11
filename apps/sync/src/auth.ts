import { randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import {
  between,
  isUuidv7,
  runMutator,
  uuidv7,
  type Mutation,
} from "@slipstream/protocol";
import type { SlipstreamDb } from "./db.js";
import { applyPush } from "./push.js";

const SESSION_COOKIE = "slipstream_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const SignupSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(80),
  workspaceName: z.string().min(1).max(80).optional(),
});

const LoginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1).max(200),
});

export interface AuthedSession {
  token: string;
  userId: string;
  workspaceId: string;
}

function newToken(): string {
  return randomBytes(32).toString("hex");
}

export async function readSession(db: SlipstreamDb, token: string | undefined): Promise<AuthedSession | undefined> {
  if (!token) return undefined;
  const row = await db.sessions.findOne({ _id: token });
  if (!row) return undefined;
  if (row.expiresAt <= Date.now()) {
    await db.sessions.deleteOne({ _id: token });
    return undefined;
  }
  return { token: row._id, userId: row.userId, workspaceId: row.workspaceId };
}

/**
 * Cookie attributes: httpOnly so JS can't read the session token; SameSite=Lax
 * so the WebSocket upgrade (same origin) still carries it; Secure off in tests
 * (the dev server uses http) — production always uses TLS so the cookie is
 * effectively secure-only when the request comes in over https.
 */
function setSessionCookie(c: Parameters<Hono["request"]>[0] extends never ? never : Parameters<NonNullable<Hono["on"]>>[0], token: string): void {
  void c;
  // unused — see writeCookie below
}

function writeCookie(c: import("hono").Context, token: string): void {
  const isHttps = new URL(c.req.url).protocol === "https:";
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: isHttps,
    maxAge: SESSION_TTL_MS / 1000,
  });
}

function clearCookie(c: import("hono").Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/**
 * Bootstrap mutations a freshly signed-up user gets: User + Workspace +
 * Membership + a default Project. The mutations go through the same push path
 * as any other client, with the new userId as the clientID. This means the
 * user's first /api/pull returns everything they own.
 */
async function bootstrapWorkspace(
  db: SlipstreamDb,
  args: { userId: string; workspaceId: string; email: string; displayName: string; workspaceName: string },
): Promise<void> {
  const mutations: Mutation[] = [
    {
      id: 1,
      clientID: args.userId,
      name: "createWorkspace",
      args: { id: args.workspaceId, name: args.workspaceName },
    },
    {
      id: 2,
      clientID: args.userId,
      name: "createProject",
      args: {
        id: uuidv7(),
        workspaceId: args.workspaceId,
        name: "Welcome",
        key: "W",
      },
    },
  ];
  // We don't push createUser / createMembership through mutators yet — those
  // entities are added directly so the bootstrap stays a single transaction
  // (M4 wires up createUser + createMembership mutators alongside the UI).
  await applyPush(db, { clientID: args.userId, mutations });
}

export function createAuthRoutes(db: SlipstreamDb): Hono {
  const app = new Hono();

  app.post("/api/auth/signup", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = SignupSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "bad_request", issues: parsed.error.issues }, 400);
    }
    const { email, password, displayName, workspaceName } = parsed.data;

    const existing = await db.accounts.findOne({ email });
    if (existing) {
      return c.json({ error: "email_taken" }, 409);
    }

    const passwordHash = await hash(password);
    const userId = uuidv7();
    const workspaceId = uuidv7();
    const account = {
      _id: userId,
      email,
      passwordHash,
      workspaceId,
      createdAt: Date.now(),
    };
    await db.accounts.insertOne(account);
    void displayName; // reserved for the User entity once createUser lands as a mutator
    void between; // reserved for first-project default position once createIssue is wired

    await bootstrapWorkspace(db, {
      userId,
      workspaceId,
      email,
      displayName,
      workspaceName: workspaceName ?? `${displayName}'s workspace`,
    });

    const token = newToken();
    await db.sessions.insertOne({
      _id: token,
      userId,
      workspaceId,
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    writeCookie(c, token);

    return c.json({ ok: true, userId, workspaceId, email });
  });

  app.post("/api/auth/login", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "bad_request" }, 400);
    }
    const { email, password } = parsed.data;
    const account = await db.accounts.findOne({ email });
    if (!account) {
      return c.json({ error: "invalid_credentials" }, 401);
    }
    const ok = await verify(account.passwordHash, password);
    if (!ok) {
      return c.json({ error: "invalid_credentials" }, 401);
    }
    if (!isUuidv7(account._id)) {
      // existing accounts created before uuidv7 enforcement; safe to keep
    }
    const token = newToken();
    await db.sessions.insertOne({
      _id: token,
      userId: account._id,
      workspaceId: account.workspaceId,
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    writeCookie(c, token);
    return c.json({ ok: true, userId: account._id, workspaceId: account.workspaceId, email });
  });

  app.post("/api/auth/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await db.sessions.deleteOne({ _id: token });
    clearCookie(c);
    return c.json({ ok: true });
  });

  app.get("/api/auth/me", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    const session = await readSession(db, token);
    if (!session) return c.json({ user: null }, 200);
    const account = await db.accounts.findOne({ _id: session.userId });
    return c.json({
      user: account
        ? { userId: account._id, email: account.email, workspaceId: account.workspaceId }
        : null,
    });
  });

  return app;
}

export { SESSION_COOKIE, SESSION_TTL_MS };
// quiet unused-import warning for the never-called placeholder above
void setSessionCookie;
