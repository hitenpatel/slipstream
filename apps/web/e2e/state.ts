// Shared handles between globalSetup and globalTeardown. Playwright runs
// both in the same node process, so a module-level ref is enough — no need
// for temp files or IPC.

import type { ChildProcess } from "node:child_process";
import type { MongoMemoryReplSet } from "mongodb-memory-server";

export interface E2EState {
  mongo?: MongoMemoryReplSet;
  sync?: ChildProcess;
  web?: ChildProcess;
}

declare global {
  // eslint-disable-next-line no-var
  var __slipstreamE2E: E2EState | undefined;
}

export function state(): E2EState {
  if (!globalThis.__slipstreamE2E) globalThis.__slipstreamE2E = {};
  return globalThis.__slipstreamE2E;
}
