/**
 * One-shot demo seed. Runs on sync boot. If the demo account doesn't exist
 * yet it creates:
 *   demo@slipstream.dev / try-slipstream-2026
 * plus a workspace, a "Sync engine" project, and six seed issues distributed
 * across the board columns. The credentials are shown on the landing page
 * so visitors can jump straight in without signing up. Multiple visitors
 * share the workspace, which is intentional — watching two browser tabs
 * converge is the point of a local-first tracker.
 */

import { hash } from "@node-rs/argon2";
import { applyPush } from "./push.js";
import type { SlipstreamDb } from "./db.js";
import {
  between,
  type IssuePriority,
  type IssueStatus,
  type Mutation,
  uuidv7,
} from "@slipstream/protocol";

export const DEMO_EMAIL = "demo@slipstream.dev";
export const DEMO_PASSWORD = "try-slipstream-2026";

interface Seed {
  title: string;
  status: IssueStatus;
  priority: IssuePriority;
}

const SEED_ISSUES: Seed[] = [
  { title: "Resolve clock skew on reconnect", status: "backlog", priority: 4 },
  { title: "CRDT merge drops trailing edits", status: "backlog", priority: 2 },
  { title: "Compact WAL after snapshot", status: "backlog", priority: 1 },
  { title: "Backpressure on slow peers", status: "todo", priority: 4 },
  { title: "Touch reorder handle", status: "todo", priority: 2 },
  { title: "Offline queue replay ordering", status: "in_progress", priority: 4 },
  { title: "Snapshot on cold boot", status: "done", priority: 2 },
];

export async function seedDemoAccount(db: SlipstreamDb): Promise<void> {
  const existing = await db.accounts.findOne({ email: DEMO_EMAIL });
  if (existing) return;

  const userId = uuidv7();
  const workspaceId = uuidv7();
  const projectId = uuidv7();
  const passwordHash = await hash(DEMO_PASSWORD);

  await db.accounts.insertOne({
    _id: userId,
    email: DEMO_EMAIL,
    passwordHash,
    workspaceId,
    createdAt: Date.now(),
  });

  // Fractional positions per column so the board renders in the intended
  // order. `between(prev, null)` extends the tail of that column.
  const positions: Partial<Record<IssueStatus, string>> = {};
  const mutations: Mutation[] = [
    {
      id: 1,
      clientID: userId,
      name: "createWorkspace",
      args: { id: workspaceId, name: "Demo workspace" },
    },
    {
      id: 2,
      clientID: userId,
      name: "createProject",
      args: { id: projectId, workspaceId, name: "Sync engine", key: "SYN" },
    },
  ];
  let nextId = 3;
  for (const seed of SEED_ISSUES) {
    const prev = positions[seed.status] ?? null;
    const position = between(prev, null);
    positions[seed.status] = position;
    mutations.push({
      id: nextId++,
      clientID: userId,
      name: "createIssue",
      args: {
        id: uuidv7(),
        workspaceId,
        projectId,
        title: seed.title,
        description: "",
        status: seed.status,
        priority: seed.priority,
        assigneeId: null,
        labelIds: [],
        position,
      },
    });
  }

  await applyPush(db, { clientID: userId, mutations });
  // eslint-disable-next-line no-console
  console.log(`[seed] demo account ${DEMO_EMAIL} created (${SEED_ISSUES.length} issues)`);
}
