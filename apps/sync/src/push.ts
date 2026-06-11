import { runMutator, type PatchOp, type PushRequest, type PushResponse } from "@slipstream/protocol";
import type { SlipstreamDb } from "./db.js";
import { MongoTx } from "./mongo-tx.js";
import { refsFor } from "./refs.js";

/**
 * The heart of the engine. One MongoDB transaction wraps:
 *
 *   1. reading the client's lastMutationID (idempotency anchor)
 *   2. for each new mutation: $inc the global counter, run the mutator, stamp
 *      everything it wrote with the version we just minted
 *   3. updating lastMutationID
 *
 * Two concurrent pushes both try to $inc the same counters document. MongoDB
 * detects the write conflict on one of them, that withTransaction retries, and
 * the result is a strict total order across all clients. Outside this function
 * nobody touches `counters` or stamps a `version` — that invariant is what
 * makes the system correct.
 *
 * Mutations are processed in client-local id order:
 *   - id <= lastMutationID  → skip (idempotent replay).
 *   - id === lastMutationID + 1 → run.
 *   - any other id → break out of the batch, leaving the rest for a retry.
 *     The client will resend with the missing id once it catches up.
 */
export async function applyPush(db: SlipstreamDb, req: PushRequest, now = Date.now()): Promise<PushResponse> {
  const session = db.client.startSession();
  let lastMutationID = 0;
  let cookie = 0;
  try {
    await session.withTransaction(async () => {
      const client = await db.clients.findOne({ _id: req.clientID }, { session });
      lastMutationID = client?.lastMutationID ?? 0;

      // sort by client id so the order the user pressed buttons is preserved
      const sorted = [...req.mutations].sort((a, b) => a.id - b.id);
      for (const m of sorted) {
        if (m.clientID !== req.clientID) {
          throw new Error(`mutation clientID mismatch: ${m.clientID} vs ${req.clientID}`);
        }
        if (m.id <= lastMutationID) continue;
        if (m.id !== lastMutationID + 1) break;

        const counter = await db.counters.findOneAndUpdate(
          { _id: "global" },
          { $inc: { seq: 1 } },
          { upsert: true, returnDocument: "after", session },
        );
        const version = counter?.seq ?? 1;

        const tx = new MongoTx(db, session, { version, now });
        await tx.prefetch(refsFor(m));
        runMutator(tx, m.name, m.args);
        await tx.flush();

        lastMutationID = m.id;
      }

      await db.clients.updateOne(
        { _id: req.clientID },
        { $set: { lastMutationID } },
        { upsert: true, session },
      );

      const head = await db.counters.findOne({ _id: "global" }, { session });
      cookie = head?.seq ?? 0;
    });
  } finally {
    await session.endSession();
  }

  return { lastMutationID, cookie };
}

/** Convenience for tests and inline use. */
export type { PatchOp };
