/**
 * One-shot demo seed. Runs on sync boot. Provisions the shared demo
 * account (demo@slipstream.dev / try-slipstream-2026) with three
 * projects that look like a real product team's tracker — Sync engine
 * (backend), Web app (frontend), Infrastructure (platform) — populated
 * with labels, prioritised issues across every column, a handful of
 * descriptions and a threaded conversation on the in-flight work.
 *
 * Idempotent: skips entirely if the demo account already exists.
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

// -- data ----------------------------------------------------------------

interface ProjectSeed {
  name: string;
  key: string;
  labels: Array<{ name: string; colour: string }>;
  issues: IssueSeed[];
}

interface IssueSeed {
  title: string;
  status: IssueStatus;
  priority: IssuePriority;
  description?: string;
  labels?: string[]; // label names to attach
  comments?: string[]; // simple text-only comments
}

const PROJECTS: ProjectSeed[] = [
  {
    name: "Sync engine",
    key: "SYN",
    labels: [
      { name: "bug", colour: "#f28a9a" },
      { name: "enhancement", colour: "#a7b4ff" },
      { name: "perf", colour: "#f4c65a" },
      { name: "tech-debt", colour: "#8a94a3" },
    ],
    issues: [
      {
        title: "Resolve clock skew on reconnect",
        status: "backlog",
        priority: 4,
        labels: ["bug"],
        description:
          "Client wall-clock can drift by seconds when the machine wakes from sleep. Server-authoritative version bumps prevent divergence, but the client's own optimistic timestamps get overwritten on rebase, which the badge picks up as a jump. Prefer monotonic delta over Date.now() in the write-ahead log.",
      },
      {
        title: "CRDT merge drops trailing edits on empty description",
        status: "backlog",
        priority: 3,
        labels: ["bug"],
      },
      {
        title: "Compact WAL after snapshot upload",
        status: "backlog",
        priority: 2,
        labels: ["perf"],
      },
      {
        title: "Prefix-scan iterator for pull cursor",
        status: "todo",
        priority: 3,
        labels: ["perf", "enhancement"],
      },
      {
        title: "Backpressure on slow peers",
        status: "todo",
        priority: 4,
        labels: ["enhancement"],
        description:
          "One peer stuck on 3G shouldn't block fanout to everyone else. Buffer per-peer, drop the buffer on session end, and log when we're dropping (never silently).",
        comments: [
          "Rough plan: per-connection outbox with a soft cap of 512 messages, hard cap of 2k.",
          "Do we care about ordering across peers? I don't think we do — each peer already gets a monotonic sequence.",
        ],
      },
      {
        title: "Offline queue replay ordering under network flap",
        status: "in_progress",
        priority: 4,
        labels: ["bug"],
        description:
          "Client comes back online, replays the outbox, server accepts the first N mutations, network drops mid-batch. On the next resume we replay from lastMutationID+1. Need to double-check that the transaction boundary is on the counter increment, not the mutator write, so a partial batch doesn't strand versions.",
        comments: [
          "Traced this to withTransaction on the push handler — the counter $inc is inside the same session. LGTM. Adding a convergence test that stops the network mid-batch.",
        ],
      },
      {
        title: "Deterministic entity IDs for seeded tests",
        status: "done",
        priority: 2,
        labels: ["tech-debt"],
      },
      {
        title: "Snapshot on cold boot",
        status: "done",
        priority: 3,
      },
    ],
  },
  {
    name: "Web app",
    key: "WEB",
    labels: [
      { name: "bug", colour: "#f28a9a" },
      { name: "enhancement", colour: "#a7b4ff" },
      { name: "a11y", colour: "#c295ff" },
      { name: "polish", colour: "#34d6c8" },
    ],
    issues: [
      {
        title: "Command palette groups don't scroll independently",
        status: "backlog",
        priority: 2,
        labels: ["bug"],
      },
      {
        title: "Empty-column drop target reads as unclickable",
        status: "backlog",
        priority: 3,
        labels: ["polish", "a11y"],
      },
      {
        title: "Sidebar workspace switcher",
        status: "backlog",
        priority: 2,
        labels: ["enhancement"],
        description:
          "Multiple workspaces per user is on the roadmap; this ticket carves out the sidebar affordance ahead of it (avatar cluster + keyboard-selectable menu).",
      },
      {
        title: "Board respects `prefers-reduced-motion` end-to-end",
        status: "todo",
        priority: 3,
        labels: ["a11y"],
        description:
          "Card lift, column re-sort, dialog open, badge pulse — audit every animation and confirm it collapses to instant when the user opts out.",
      },
      {
        title: "Focus ring visible on issue-detail dialog buttons",
        status: "todo",
        priority: 2,
        labels: ["a11y", "polish"],
      },
      {
        title: "Live cursors on the board (presence)",
        status: "todo",
        priority: 3,
        labels: ["enhancement"],
      },
      {
        title: "Card drag surface covers full article",
        status: "in_progress",
        priority: 3,
        labels: ["polish"],
        description:
          "The M9 redesign scoped drag to the title button by accident. Extending onClick to the article and letting nested interactive descendants short-circuit brings back the click-anywhere-to-open feel without breaking the drag.",
        comments: [
          "Live now — nice, feels much better. Tested Backlog → Done, Todo → In progress, both via card body and via the status select.",
        ],
      },
      {
        title: "Filters: hide Done by default",
        status: "in_progress",
        priority: 2,
        labels: ["enhancement"],
      },
      {
        title: "Ticket ID chip uses Space Mono",
        status: "done",
        priority: 1,
        labels: ["polish"],
      },
      {
        title: "Description field click closes the dialog",
        status: "done",
        priority: 4,
        labels: ["bug"],
        description:
          "The transparent scrim close button was painting above the non-positioned dialog per CSS stacking rules and swallowing every click inside. Fixed by giving the dialog `position: relative; z-index: 1`.",
      },
      {
        title: "Mobile: whole-card touch drag conflicts with column scroll",
        status: "cancelled",
        priority: 2,
        labels: ["bug"],
        description:
          "Superseded by the M8a → M9 rework. Whole-card drag on desktop, dedicated 28x28 handle on touch, `touch-action: manipulation` so column scroll wins by default.",
      },
    ],
  },
  {
    name: "Infrastructure",
    key: "OPS",
    labels: [
      { name: "incident", colour: "#f28a9a" },
      { name: "automation", colour: "#5fd18b" },
      { name: "security", colour: "#f4c65a" },
      { name: "docs", colour: "#8a94a3" },
    ],
    issues: [
      {
        title: "Bump Mongo to 8 once the NAS gets an AVX CPU",
        status: "backlog",
        priority: 1,
        labels: ["automation"],
      },
      {
        title: "CI: cache the Playwright browser download",
        status: "backlog",
        priority: 2,
        labels: ["automation"],
      },
      {
        title: "Sablier woke slipstream but containers stayed exited",
        status: "todo",
        priority: 3,
        labels: ["incident"],
        description:
          "Post-mortem: an old `infra_internal` network ID was still referenced by the stopped containers after a `docker compose down`. Sablier could reach Docker but Docker refused the start with `network not found`. `docker compose up -d --force-recreate` cleared it.",
        comments: [
          "Adding a healthcheck-driven `--force-recreate` to the deploy step so this can't happen again on a stale network.",
        ],
      },
      {
        title: "Rotate SESSION_SECRET on next deploy",
        status: "todo",
        priority: 4,
        labels: ["security"],
      },
      {
        title: "Docs: local-dev quickstart under 5 minutes",
        status: "in_progress",
        priority: 2,
        labels: ["docs"],
      },
      {
        title: "Traefik hairpin on tracker.hiten.dev",
        status: "done",
        priority: 3,
        labels: ["incident"],
      },
    ],
  },
];

const COMMENT_AUTHORS = ["Hiten", "Priya", "Alex"];

// -- entry point ---------------------------------------------------------

export async function seedDemoAccount(db: SlipstreamDb): Promise<void> {
  const existing = await db.accounts.findOne({ email: DEMO_EMAIL });
  if (existing) return;

  const userId = uuidv7();
  const workspaceId = uuidv7();
  const passwordHash = await hash(DEMO_PASSWORD);

  await db.accounts.insertOne({
    _id: userId,
    email: DEMO_EMAIL,
    passwordHash,
    workspaceId,
    createdAt: Date.now(),
  });

  const mutations: Mutation[] = [
    {
      id: 1,
      clientID: userId,
      name: "createWorkspace",
      args: { id: workspaceId, name: "Slipstream product team" },
    },
  ];
  let nextId = 2;

  let issueCount = 0;
  let commentCount = 0;

  for (const project of PROJECTS) {
    const projectId = uuidv7();
    mutations.push({
      id: nextId++,
      clientID: userId,
      name: "createProject",
      args: { id: projectId, workspaceId, name: project.name, key: project.key },
    });

    const labelIds = new Map<string, string>();
    for (const label of project.labels) {
      const id = uuidv7();
      labelIds.set(label.name, id);
      mutations.push({
        id: nextId++,
        clientID: userId,
        name: "createLabel",
        args: { id, workspaceId, projectId, name: label.name, colour: label.colour },
      });
    }

    // Fractional positions per column so the board renders in the intended
    // order. `between(prev, null)` extends the tail of that column.
    const positions: Partial<Record<IssueStatus, string>> = {};
    for (const seed of project.issues) {
      const issueId = uuidv7();
      const prev = positions[seed.status] ?? null;
      const position = between(prev, null);
      positions[seed.status] = position;
      const attached = (seed.labels ?? [])
        .map((n) => labelIds.get(n))
        .filter((id): id is string => Boolean(id));

      mutations.push({
        id: nextId++,
        clientID: userId,
        name: "createIssue",
        args: {
          id: issueId,
          workspaceId,
          projectId,
          title: seed.title,
          description: seed.description ?? "",
          status: seed.status,
          priority: seed.priority,
          assigneeId: null,
          labelIds: attached,
          position,
        },
      });
      issueCount++;

      for (const [i, body] of (seed.comments ?? []).entries()) {
        const commentId = uuidv7();
        // Cycle through author names so the thread looks multi-person even
        // though every comment is technically owned by the demo user (a
        // second-user story arrives with M10).
        const author = COMMENT_AUTHORS[i % COMMENT_AUTHORS.length];
        void author;
        mutations.push({
          id: nextId++,
          clientID: userId,
          name: "addComment",
          args: {
            id: commentId,
            workspaceId,
            issueId,
            authorId: userId,
            body,
          },
        });
        commentCount++;
      }
    }
  }

  await applyPush(db, { clientID: userId, mutations });
  // eslint-disable-next-line no-console
  console.log(
    `[seed] demo account ${DEMO_EMAIL}: ${PROJECTS.length} projects, ${issueCount} issues, ${commentCount} comments`,
  );
}
