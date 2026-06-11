import { describe, expect, it } from "vitest";
import { between } from "./fractional.js";
import { uuidv7 } from "./ids.js";
import { MemoryTx, MemoryView } from "./memory-tx.js";
import { isMutatorName, runMutator } from "./mutators.js";

function tx(view: MemoryView, version = 0, now = 1_700_000_000_000) {
  return new MemoryTx(view, { version, now });
}

describe("mutators", () => {
  it("rejects an unknown mutator name", () => {
    const view = new MemoryView();
    expect(() => runMutator(tx(view), "noSuchMutator", {})).toThrow(/unknown mutator/);
  });

  it("rejects malformed args", () => {
    const view = new MemoryView();
    expect(() => runMutator(tx(view), "createIssue", { id: 123 })).toThrow();
  });

  it("creates and updates an issue deterministically", () => {
    const view = new MemoryView();
    const wsId = uuidv7();
    const projectId = uuidv7();
    const issueId = uuidv7();

    runMutator(tx(view, 1), "createWorkspace", { id: wsId, name: "Acme" });
    runMutator(tx(view, 2), "createProject", { id: projectId, workspaceId: wsId, name: "Slipstream", key: "SL" });
    runMutator(tx(view, 3), "createIssue", {
      id: issueId,
      workspaceId: wsId,
      projectId,
      title: "Hello",
      position: between(null, null),
    });

    const issue = view.get("issue", issueId);
    expect(issue?.title).toBe("Hello");
    expect(issue?.status).toBe("backlog");
    expect(issue?.version).toBe(3);

    runMutator(tx(view, 4), "updateIssueStatus", { id: issueId, status: "in_progress" });
    expect(view.get("issue", issueId)?.status).toBe("in_progress");
    expect(view.get("issue", issueId)?.version).toBe(4);

    runMutator(tx(view, 5), "deleteIssue", { id: issueId });
    expect(view.get("issue", issueId)?.deleted).toBe(true);
  });

  it("is idempotent on re-applying the same create", () => {
    const view = new MemoryView();
    const id = uuidv7();
    runMutator(tx(view, 1), "createWorkspace", { id, name: "Acme" });
    const before = structuredClone(view.get("workspace", id));
    runMutator(tx(view, 2), "createWorkspace", { id, name: "Different name — ignored" });
    expect(view.get("workspace", id)).toEqual(before);
  });

  it("isMutatorName is a tight type guard", () => {
    expect(isMutatorName("createIssue")).toBe(true);
    expect(isMutatorName("notARealName")).toBe(false);
  });
});
