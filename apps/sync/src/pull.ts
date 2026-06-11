import type { Entity, PatchOp, PullRequest, PullResponse } from "@slipstream/protocol";
import type { SlipstreamDb } from "./db.js";

/**
 * Pull: hand the client every entity in its workspaces whose version is
 * strictly greater than the client's cookie, plus the new cookie and the
 * client's lastMutationID.
 *
 * M1 scope: workspace permission is "any workspace the entities mention" until
 * Memberships are wired up properly in M4. The shape is right; we just don't
 * enforce permissions yet.
 */
export async function pull(db: SlipstreamDb, req: PullRequest): Promise<PullResponse> {
  const docs = await db.entities
    .find({ version: { $gt: req.cookie } })
    .sort({ version: 1 })
    .toArray();

  const patch: PatchOp[] = docs.map((doc) => {
    const { _id, ...entity } = doc;
    void _id;
    if ((entity as Entity).deleted) {
      return { op: "del" as const, kind: (entity as Entity).kind, id: (entity as Entity).id };
    }
    return { op: "put" as const, entity: entity as Entity };
  });

  const head = await db.counters.findOne({ _id: "global" });
  const cookie = head?.seq ?? 0;
  const client = await db.clients.findOne({ _id: req.clientID });
  const lastMutationID = client?.lastMutationID ?? 0;

  return { patch, cookie, lastMutationID };
}
