import { z } from "zod";
import {
  type Comment,
  type Issue,
  IdSchema,
  IssuePriority,
  IssueStatus,
  type Label,
  type Project,
  type Workspace,
} from "./entities.js";
import type { Mutator, Tx } from "./tx.js";
import {
  applyUpdateB64,
  decodeDocOrFromText,
  encodeDoc,
} from "./ydoc.js";

/**
 * Every mutator is defined here once. It runs identically on the client (against
 * an in-memory view) and on the server (against a MongoDB session). The args of
 * each mutator are validated with a Zod schema below so a malformed push can
 * never corrupt server state.
 *
 * NB: mutators must be deterministic — they take args + a tx and nothing else.
 *     IDs, timestamps and the global version are passed in as args or hints, not
 *     read from the wall clock.
 */

export const CreateWorkspaceArgs = z.object({
  id: IdSchema,
  name: z.string().min(1),
});
export type CreateWorkspaceArgs = z.infer<typeof CreateWorkspaceArgs>;

export const CreateProjectArgs = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  name: z.string().min(1),
  key: z.string().min(1),
});
export type CreateProjectArgs = z.infer<typeof CreateProjectArgs>;

export const CreateIssueArgs = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  projectId: IdSchema,
  title: z.string().min(1),
  description: z.string().default(""),
  status: IssueStatus.default("backlog"),
  priority: IssuePriority.default(0),
  assigneeId: IdSchema.nullable().default(null),
  labelIds: z.array(IdSchema).default([]),
  position: z.string().min(1),
});
export type CreateIssueArgs = z.infer<typeof CreateIssueArgs>;

export const UpdateIssueStatusArgs = z.object({
  id: IdSchema,
  status: IssueStatus,
});
export type UpdateIssueStatusArgs = z.infer<typeof UpdateIssueStatusArgs>;

export const MoveIssueArgs = z.object({
  id: IdSchema,
  status: IssueStatus,
  position: z.string().min(1),
});
export type MoveIssueArgs = z.infer<typeof MoveIssueArgs>;

export const UpdateIssueArgs = z.object({
  id: IdSchema,
  patch: z
    .object({
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      priority: IssuePriority.optional(),
      assigneeId: IdSchema.nullable().optional(),
      labelIds: z.array(IdSchema).optional(),
    })
    .refine((p) => Object.keys(p).length > 0, "patch is empty"),
});
export type UpdateIssueArgs = z.infer<typeof UpdateIssueArgs>;

/**
 * Edit an issue's `description` field via a Yjs CRDT update. The update is a
 * base64-encoded `Y.applyUpdate` payload generated client-side from the
 * current Y.Doc. The mutator runs on both client and server: it decodes the
 * existing description as a Y.Doc, applies the update, re-encodes, and writes
 * the new entity.
 *
 * Because Y.Doc CRDTs are commutative, applying updates in any order
 * produces the same merged state — so concurrent edits across clients
 * converge even though the server's transaction processes mutations
 * sequentially.
 */
export const EditIssueDescriptionArgs = z.object({
  id: IdSchema,
  updateB64: z.string().min(1).max(64 * 1024), // 64 KiB ceiling on a single update
});
export type EditIssueDescriptionArgs = z.infer<typeof EditIssueDescriptionArgs>;

export const AddCommentArgs = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  issueId: IdSchema,
  authorId: IdSchema,
  body: z.string().min(1),
});
export type AddCommentArgs = z.infer<typeof AddCommentArgs>;

export const DeleteIssueArgs = z.object({ id: IdSchema });
export type DeleteIssueArgs = z.infer<typeof DeleteIssueArgs>;

export const CreateLabelArgs = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  projectId: IdSchema,
  name: z.string().min(1),
  colour: z.string().min(1),
});
export type CreateLabelArgs = z.infer<typeof CreateLabelArgs>;

function createWorkspace(tx: Tx, args: CreateWorkspaceArgs): void {
  if (tx.get("workspace", args.id)) return; // idempotent: re-running is a no-op
  const w: Workspace = {
    kind: "workspace",
    id: args.id,
    workspaceId: args.id,
    name: args.name,
    deleted: false,
    version: tx.hints.version,
    createdAt: tx.hints.now,
    updatedAt: tx.hints.now,
  };
  tx.put(w);
}

function createProject(tx: Tx, args: CreateProjectArgs): void {
  if (tx.get("project", args.id)) return;
  const p: Project = {
    kind: "project",
    id: args.id,
    workspaceId: args.workspaceId,
    name: args.name,
    key: args.key,
    deleted: false,
    version: tx.hints.version,
    createdAt: tx.hints.now,
    updatedAt: tx.hints.now,
  };
  tx.put(p);
}

function createIssue(tx: Tx, args: CreateIssueArgs): void {
  if (tx.get("issue", args.id)) return;
  const i: Issue = {
    kind: "issue",
    id: args.id,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    title: args.title,
    description: args.description,
    status: args.status,
    priority: args.priority,
    assigneeId: args.assigneeId,
    labelIds: args.labelIds,
    position: args.position,
    deleted: false,
    version: tx.hints.version,
    createdAt: tx.hints.now,
    updatedAt: tx.hints.now,
  };
  tx.put(i);
}

function updateIssueStatus(tx: Tx, args: UpdateIssueStatusArgs): void {
  const issue = tx.get("issue", args.id);
  if (!issue || issue.deleted) return;
  tx.put({
    ...issue,
    status: args.status,
    updatedAt: tx.hints.now,
    version: tx.hints.version,
  });
}

function moveIssue(tx: Tx, args: MoveIssueArgs): void {
  const issue = tx.get("issue", args.id);
  if (!issue || issue.deleted) return;
  tx.put({
    ...issue,
    status: args.status,
    position: args.position,
    updatedAt: tx.hints.now,
    version: tx.hints.version,
  });
}

function updateIssue(tx: Tx, args: UpdateIssueArgs): void {
  const issue = tx.get("issue", args.id);
  if (!issue || issue.deleted) return;
  tx.put({
    ...issue,
    ...args.patch,
    updatedAt: tx.hints.now,
    version: tx.hints.version,
  });
}

function editIssueDescription(tx: Tx, args: EditIssueDescriptionArgs): void {
  const issue = tx.get("issue", args.id);
  if (!issue || issue.deleted) return;
  // Decode the existing description (transparently handles legacy plain text
  // and absent values), apply the Y.Doc update, encode the new state back
  // into the description string field. Because Y.Doc CRDTs are commutative,
  // the order in which the server applies updates doesn't affect the final
  // merged value.
  const doc = decodeDocOrFromText(issue.description ?? "");
  applyUpdateB64(doc, args.updateB64);
  tx.put({
    ...issue,
    description: encodeDoc(doc),
    updatedAt: tx.hints.now,
    version: tx.hints.version,
  });
}

function deleteIssue(tx: Tx, args: DeleteIssueArgs): void {
  const issue = tx.get("issue", args.id);
  if (!issue || issue.deleted) return;
  tx.put({
    ...issue,
    deleted: true,
    updatedAt: tx.hints.now,
    version: tx.hints.version,
  });
}

function addComment(tx: Tx, args: AddCommentArgs): void {
  if (tx.get("comment", args.id)) return;
  const c: Comment = {
    kind: "comment",
    id: args.id,
    workspaceId: args.workspaceId,
    issueId: args.issueId,
    authorId: args.authorId,
    body: args.body,
    deleted: false,
    version: tx.hints.version,
    createdAt: tx.hints.now,
    updatedAt: tx.hints.now,
  };
  tx.put(c);
}

function createLabel(tx: Tx, args: CreateLabelArgs): void {
  if (tx.get("label", args.id)) return;
  const l: Label = {
    kind: "label",
    id: args.id,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    name: args.name,
    colour: args.colour,
    deleted: false,
    version: tx.hints.version,
    createdAt: tx.hints.now,
    updatedAt: tx.hints.now,
  };
  tx.put(l);
}

/**
 * The single source of truth for mutator names and signatures. Adding a new
 * mutator means: write the function, the Zod args schema, and an entry here.
 * The client and server both import this map; there is no second registration.
 */
type MutatorEntry<A> = { args: z.ZodType<A, z.ZodTypeDef, unknown>; fn: Mutator<A> };

function entry<A>(args: z.ZodType<A, z.ZodTypeDef, unknown>, fn: Mutator<A>): MutatorEntry<A> {
  return { args, fn };
}

export const mutators = {
  createWorkspace: entry(CreateWorkspaceArgs, createWorkspace),
  createProject: entry(CreateProjectArgs, createProject),
  createIssue: entry(CreateIssueArgs, createIssue),
  updateIssueStatus: entry(UpdateIssueStatusArgs, updateIssueStatus),
  moveIssue: entry(MoveIssueArgs, moveIssue),
  updateIssue: entry(UpdateIssueArgs, updateIssue),
  editIssueDescription: entry(EditIssueDescriptionArgs, editIssueDescription),
  deleteIssue: entry(DeleteIssueArgs, deleteIssue),
  addComment: entry(AddCommentArgs, addComment),
  createLabel: entry(CreateLabelArgs, createLabel),
} as const;

export type MutatorName = keyof typeof mutators;

export function isMutatorName(name: string): name is MutatorName {
  return Object.prototype.hasOwnProperty.call(mutators, name);
}

/**
 * Run a mutator by name, validating its args. Returns the parsed args (useful
 * for logging). Throws if the name is unknown or args fail validation.
 */
export function runMutator(tx: Tx, name: string, args: unknown): unknown {
  if (!isMutatorName(name)) {
    throw new Error(`unknown mutator: ${name}`);
  }
  const m = mutators[name] as { args: z.ZodTypeAny; fn: Mutator<unknown> };
  const parsed = m.args.parse(args);
  m.fn(tx, parsed);
  return parsed;
}
