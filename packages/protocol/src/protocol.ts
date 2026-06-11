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

/** Socket messages — kept tiny. Pulls happen over HTTPS, not over the socket. */
export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("poke") }),
  z.object({ type: z.literal("hello"), clientID: IdSchema, cookie: z.number().int().nonnegative() }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), clientID: IdSchema }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
