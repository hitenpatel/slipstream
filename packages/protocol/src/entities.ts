import { z } from "zod";

/**
 * IDs are uuidv7, minted client-side. We accept any UUID string at the schema
 * boundary (the runtime guarantees v7 by minting them itself) so that legacy
 * fixtures don't break round-trip tests.
 */
export const IdSchema = z.string().min(1);
export type Id = z.infer<typeof IdSchema>;

export const EntityKind = z.enum(["workspace", "membership", "user", "project", "issue", "comment", "label"]);
export type EntityKind = z.infer<typeof EntityKind>;

export const IssueStatus = z.enum(["backlog", "todo", "in_progress", "done", "cancelled"]);
export type IssueStatus = z.infer<typeof IssueStatus>;

export const IssuePriority = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export type IssuePriority = z.infer<typeof IssuePriority>;

const BaseEntity = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  version: z.number().int().nonnegative(),
  deleted: z.boolean(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export const WorkspaceSchema = BaseEntity.extend({
  kind: z.literal("workspace"),
  name: z.string().min(1),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const MembershipSchema = BaseEntity.extend({
  kind: z.literal("membership"),
  userId: IdSchema,
  role: z.enum(["owner", "member"]),
});
export type Membership = z.infer<typeof MembershipSchema>;

export const UserSchema = BaseEntity.extend({
  kind: z.literal("user"),
  email: z.string().email(),
  displayName: z.string().min(1),
});
export type User = z.infer<typeof UserSchema>;

export const ProjectSchema = BaseEntity.extend({
  kind: z.literal("project"),
  name: z.string().min(1),
  key: z.string().min(1),
});
export type Project = z.infer<typeof ProjectSchema>;

export const IssueSchema = BaseEntity.extend({
  kind: z.literal("issue"),
  projectId: IdSchema,
  title: z.string().min(1),
  description: z.string(),
  status: IssueStatus,
  priority: IssuePriority,
  assigneeId: IdSchema.nullable(),
  labelIds: z.array(IdSchema),
  position: z.string().min(1),
});
export type Issue = z.infer<typeof IssueSchema>;

export const CommentSchema = BaseEntity.extend({
  kind: z.literal("comment"),
  issueId: IdSchema,
  authorId: IdSchema,
  body: z.string().min(1),
});
export type Comment = z.infer<typeof CommentSchema>;

export const LabelSchema = BaseEntity.extend({
  kind: z.literal("label"),
  projectId: IdSchema,
  name: z.string().min(1),
  colour: z.string().min(1),
});
export type Label = z.infer<typeof LabelSchema>;

export const EntitySchema = z.discriminatedUnion("kind", [
  WorkspaceSchema,
  MembershipSchema,
  UserSchema,
  ProjectSchema,
  IssueSchema,
  CommentSchema,
  LabelSchema,
]);
export type Entity = z.infer<typeof EntitySchema>;

/** Subset of fields a tx can stamp from the outside (server stamps version, both stamp updatedAt). */
export type EntityWriteHints = { version: number; now: number };
