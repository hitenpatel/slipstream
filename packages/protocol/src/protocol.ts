import { z } from "zod";
import { EntitySchema, IdSchema } from "./entities.js";

/**
 * One mutation = one named call. `id` is monotonic *per client*; the global order
 * is decided by the server's counter inside the push transaction.
 */
export const MutationSchema = z.object({
  id: z.number().int().positive(),
  clientID: IdSchema,
  name: z.string().min(1),
  args: z.unknown(),
});
export type Mutation = z.infer<typeof MutationSchema>;

/** Push: client sends its pending mutations; server confirms how far it got. */
export const PushRequestSchema = z.object({
  clientID: IdSchema,
  mutations: z.array(MutationSchema),
});
export type PushRequest = z.infer<typeof PushRequestSchema>;

export const PushResponseSchema = z.object({
  lastMutationID: z.number().int().nonnegative(),
  cookie: z.number().int().nonnegative(),
});
export type PushResponse = z.infer<typeof PushResponseSchema>;

/** Pull: client sends its last-seen cookie; server sends the patch since. */
export const PullRequestSchema = z.object({
  clientID: IdSchema,
  cookie: z.number().int().nonnegative(),
});
export type PullRequest = z.infer<typeof PullRequestSchema>;

export const PatchOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("put"), entity: EntitySchema }),
  z.object({ op: z.literal("del"), kind: z.string(), id: IdSchema }),
]);
export type PatchOp = z.infer<typeof PatchOpSchema>;

export const PullResponseSchema = z.object({
  patch: z.array(PatchOpSchema),
  cookie: z.number().int().nonnegative(),
  lastMutationID: z.number().int().nonnegative(),
});
export type PullResponse = z.infer<typeof PullResponseSchema>;

/**
 * Where in the app a connected user is currently focused. The server fans
 * focus updates out to every other client in the same workspace so each tab
 * can render "Alex and Sam are viewing this issue" without polling.
 *
 * Kept deliberately small — kind + id only. Cursors and per-page selection
 * are out of scope for M6a and can layer on top later.
 */
export const PresenceFocusSchema = z.union([
  z.object({ kind: z.literal("project"), id: IdSchema }),
  z.object({ kind: z.literal("issue"), id: IdSchema }),
  z.null(),
]);
export type PresenceFocus = z.infer<typeof PresenceFocusSchema>;

export const PresenceUserSchema = z.object({
  userId: IdSchema,
  email: z.string(),
  focus: PresenceFocusSchema,
  /** Monotonic ms since epoch, used by the client to dedupe stale fan-outs. */
  updatedAt: z.number().int().nonnegative(),
});
export type PresenceUser = z.infer<typeof PresenceUserSchema>;

/** Socket messages — kept tiny. Pulls happen over HTTPS, not over the socket. */
export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("poke") }),
  z.object({
    type: z.literal("hello"),
    clientID: IdSchema,
    cookie: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("presence"),
    users: z.array(PresenceUserSchema),
  }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), clientID: IdSchema }),
  z.object({ type: z.literal("focus"), focus: PresenceFocusSchema }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
