import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { state } from "./state";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SYNC_DIR = path.join(REPO_ROOT, "apps", "sync");
const WEB_DIR = path.join(REPO_ROOT, "apps", "web");

const SYNC_PORT = 8788;
const WEB_PORT = 3100;
const SESSION_SECRET = "e2e-secret-thirty-two-chars-min-aaaaaaaa";

async function waitForHttp(url: string, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch (err) {
      lastErr = err;
    }
    await sleep(500);
  }
  throw new Error(`${label} did not become ready at ${url}: ${String(lastErr)}`);
}

export default async function globalSetup(): Promise<void> {
  // Transactions need a replica set even for a single node — that's how the
  // sync push path gets its atomicity guarantees. Storage engine has to be
  // wiredTiger for transactions.
  const mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const mongoUri = mongo.getUri();
  state().mongo = mongo;

  // eslint-disable-next-line no-console
  console.log(`[e2e] mongo: ${mongoUri}`);

  // Sync server runs from its built dist/ output so we're testing the exact
  // artifact prod uses. `turbo build` already ran (declared in turbo.json).
  const sync = spawn(process.execPath, [path.join(SYNC_DIR, "dist", "server.js")], {
    cwd: SYNC_DIR,
    env: {
      ...process.env,
      MONGODB_URI: mongoUri,
      SESSION_SECRET,
      PORT: String(SYNC_PORT),
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  state().sync = sync;
  await waitForHttp(`http://127.0.0.1:${SYNC_PORT}/api/sync/health`, 30_000, "sync");
  // eslint-disable-next-line no-console
  console.log(`[e2e] sync ready on :${SYNC_PORT}`);

  // Web runs `next start` against the standalone build.
  const web = spawn("pnpm", ["exec", "next", "start", "-p", String(WEB_PORT)], {
    cwd: WEB_DIR,
    env: {
      ...process.env,
      PORT: String(WEB_PORT),
      HOSTNAME: "127.0.0.1",
      NEXT_PUBLIC_SYNC_URL: `http://127.0.0.1:${SYNC_PORT}`,
      SESSION_SECRET,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  state().web = web;
  await waitForHttp(`http://127.0.0.1:${WEB_PORT}/`, 60_000, "web");
  // eslint-disable-next-line no-console
  console.log(`[e2e] web ready on :${WEB_PORT}`);
}
