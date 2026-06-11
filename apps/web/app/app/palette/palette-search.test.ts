import { describe, expect, it } from "vitest";
import { scoreItems } from "./palette-search";
import type { PaletteItem } from "./palette-types";

function cmd(id: string, label: string): PaletteItem {
  return { kind: "command", id, label, action: () => undefined };
}
function issueItem(id: string, label: string): PaletteItem {
  return {
    kind: "issue",
    id,
    label,
    issue: {
      kind: "issue",
      id,
      workspaceId: "ws",
      projectId: "proj",
      title: label,
      description: "",
      status: "todo",
      priority: 0,
      assigneeId: null,
      labelIds: [],
      position: "M0",
      createdAt: 0,
      updatedAt: 0,
      version: 1,
      deleted: false,
    },
    project: undefined,
    action: () => undefined,
  };
}

describe("scoreItems", () => {
  it("keeps original order when the query is empty", () => {
    const items = [cmd("a", "Aardvark"), issueItem("b", "Bear"), cmd("c", "Cat")];
    const out = scoreItems(items, "");
    expect(out.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("ranks a prefix match above a mid-string match", () => {
    const items = [issueItem("a", "Find authentication bug"), issueItem("b", "Auth flow polish")];
    const out = scoreItems(items, "auth");
    expect(out[0]!.id).toBe("b"); // starts with "auth"
    expect(out[1]!.id).toBe("a"); // contains "auth" mid-string
  });

  it("filters out items that don't match", () => {
    const items = [cmd("a", "Open settings"), issueItem("b", "Bear chase")];
    const out = scoreItems(items, "bear");
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("b");
  });

  it("supports multi-token AND search (any order)", () => {
    const items = [
      issueItem("a", "Polish the login form"),
      issueItem("b", "Login form polish"),
      issueItem("c", "Add the signup form"),
    ];
    const out = scoreItems(items, "login polish");
    expect(out.map((i) => i.id)).toEqual(expect.arrayContaining(["a", "b"]));
    expect(out.map((i) => i.id)).not.toContain("c");
  });

  it("gives commands a tie-break bonus so they stay discoverable", () => {
    const items = [issueItem("issue", "Sign out flow"), cmd("cmd", "Sign out")];
    const out = scoreItems(items, "sign out");
    expect(out[0]!.id).toBe("cmd"); // command wins the tie
  });

  it("is case-insensitive", () => {
    const items = [issueItem("a", "HELLO world")];
    const out = scoreItems(items, "hello");
    expect(out).toHaveLength(1);
  });
});
