import type { Entity, PatchOp, PullRequest, PullResponse } from "@slipstream/protocol";
import type { SlipstreamDb } from "./db.js";

/**
 * Pull: hand the client every entity in its workspace whose version is
 * strictly greater than the client's cookie, plus the new cookie and the
 * client's lastMutationID.
 *
 * Permissions: the caller passes the authenticated session's workspaceId
 * (resolved from the cookie in the route handler). Without scoping, any
 * signed-in user could read any workspace — a real concern once M7b's
 * invite flow makes shared workspaces a thing.
 */
export async function pull(
  db: SlipstreamDb,
  req: PullRequest,
  scope: { workspaceId: string },
): Promise<PullResponse> {
  const docs = await db.entities
    .find({ workspaceId: scope.workspaceId, version: { $gt: req.cookie } })
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
