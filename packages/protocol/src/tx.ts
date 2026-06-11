import type { Entity, EntityKind, EntityWriteHints } from "./entities.js";

/**
 * The transaction handle a mutator sees. The shape is deliberately tiny —
 * `get`, `put`, `del` — because the elegant core of the engine is that the same
 * mutator code runs on the client (against an in-memory view) and on the server
 * (against a MongoDB session). Two implementations, one contract.
 *
 * The `hints` reflect what the caller is responsible for stamping:
 *   - `version` is the global counter the server mints inside its transaction;
 *      on the client it's 0 (the optimistic record carries no real version).
 *   - `now` is "right now" in ms since epoch, used for createdAt/updatedAt.
 *
 * A mutator MUST NOT pull the time or random bytes from anywhere else. That
 * keeps it deterministic and replayable on rebase.
 */
export interface Tx {
  readonly hints: EntityWriteHints;
  get<K extends EntityKind>(kind: K, id: string): Entity & { kind: K } | undefined;
  put(entity: Entity): void;
  del(kind: EntityKind, id: string): void;
}

export type Mutator<Args> = (tx: Tx, args: Args) => void;
