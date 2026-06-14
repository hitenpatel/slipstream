import type { EntityKind, Mutation } from "@slipstream/protocol";

/**
 * Given a mutation, return the (kind, id) pairs the mutator will read. The
 * server prefetches these so each mutator stays synchronous from the inside.
 *
 * It's fine for this list to over-include — extra prefetched entities cost a
 * little memory but never affect correctness. It must never under-include,
 * because a missing read would let a mutator silently see "not found".
 */
export function refsFor(m: Mutation): Array<{ kind: EntityKind; id: string }> {
  const a = (m.args ?? {}) as Record<string, unknown>;
  const id = typeof a.id === "string" ? a.id : undefined;

  switch (m.name) {
    case "createWorkspace":
      return id ? [{ kind: "workspace", id }] : [];
    case "createProject":
      return id ? [{ kind: "project", id }] : [];
    case "createIssue":
      return id ? [{ kind: "issue", id }] : [];
    case "updateIssueStatus":
    case "moveIssue":
    case "updateIssue":
    case "editIssueDescription":
    case "deleteIssue":
      return id ? [{ kind: "issue", id }] : [];
    case "addComment":
      return id ? [{ kind: "comment", id }] : [];
    case "createLabel":
      return id ? [{ kind: "label", id }] : [];
    default:
      return [];
  }
}
