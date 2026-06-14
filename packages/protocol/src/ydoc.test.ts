import { describe, expect, it } from "vitest";
import {
  applyUpdateB64,
  decodeDoc,
  decodeDocOrFromText,
  diffUpdateB64,
  encodeDoc,
  makeDoc,
  readBody,
  snapshotStateVector,
  Y_TEXT_FIELD,
} from "./ydoc.js";

describe("Y.Doc helpers", () => {
  it("encode → decode round-trips an empty doc", () => {
    const doc = makeDoc();
    const b64 = encodeDoc(doc);
    const round = decodeDoc(b64);
    expect(readBody(round)).toBe("");
  });

  it("encode → decode round-trips a non-trivial doc", () => {
    const doc = makeDoc();
    doc.getText(Y_TEXT_FIELD).insert(0, "hello world");
    const b64 = encodeDoc(doc);
    const round = decodeDoc(b64);
    expect(readBody(round)).toBe("hello world");
  });

  it("decodeDocOrFromText seeds a fresh doc from legacy plain text", () => {
    const doc = decodeDocOrFromText("plain text description");
    expect(readBody(doc)).toBe("plain text description");
  });

  it("decodeDocOrFromText decodes a real Y.Doc state", () => {
    const original = makeDoc();
    original.getText(Y_TEXT_FIELD).insert(0, "encoded body");
    const b64 = encodeDoc(original);
    const round = decodeDocOrFromText(b64);
    expect(readBody(round)).toBe("encoded body");
  });

  it("decodeDocOrFromText returns an empty doc for empty input", () => {
    const doc = decodeDocOrFromText("");
    expect(readBody(doc)).toBe("");
  });

  it("diffUpdateB64 + applyUpdateB64 transfer state across two docs", () => {
    const sender = makeDoc();
    const receiver = makeDoc();

    const beforeSV = snapshotStateVector(receiver);
    sender.getText(Y_TEXT_FIELD).insert(0, "from sender");
    const update = diffUpdateB64(sender, beforeSV);

    applyUpdateB64(receiver, update);
    expect(readBody(receiver)).toBe("from sender");
  });
});

describe("CRDT convergence on concurrent edits", () => {
  it("two clients editing the same description converge to the same merged state", () => {
    // Both clients start from the same baseline.
    const baseline = makeDoc();
    baseline.getText(Y_TEXT_FIELD).insert(0, "shared start ");
    const baseB64 = encodeDoc(baseline);

    const alice = decodeDoc(baseB64);
    const bob = decodeDoc(baseB64);

    // Both make local edits without seeing each other's first.
    const aliceSVBefore = snapshotStateVector(alice);
    alice.getText(Y_TEXT_FIELD).insert(alice.getText(Y_TEXT_FIELD).length, "alice's tail");
    const aliceUpdate = diffUpdateB64(alice, aliceSVBefore);

    const bobSVBefore = snapshotStateVector(bob);
    bob.getText(Y_TEXT_FIELD).insert(0, "bob's head — ");
    const bobUpdate = diffUpdateB64(bob, bobSVBefore);

    // Sync: both clients receive the other's update. CRDTs are commutative,
    // so the order doesn't matter.
    applyUpdateB64(alice, bobUpdate);
    applyUpdateB64(bob, aliceUpdate);

    expect(readBody(alice)).toBe(readBody(bob));
    expect(readBody(alice)).toBe("bob's head — shared start alice's tail");
  });

  it("server-applied-in-different-order vs client-applied still converges", () => {
    // Three clients all start from the same baseline.
    const baseline = makeDoc();
    baseline.getText(Y_TEXT_FIELD).insert(0, "x");
    const baseB64 = encodeDoc(baseline);

    const docs = [decodeDoc(baseB64), decodeDoc(baseB64), decodeDoc(baseB64)];
    const updates: string[] = [];

    // Each client makes its own edit.
    for (let i = 0; i < docs.length; i++) {
      const sv = snapshotStateVector(docs[i]!);
      docs[i]!.getText(Y_TEXT_FIELD).insert(docs[i]!.getText(Y_TEXT_FIELD).length, ` c${i}`);
      updates.push(diffUpdateB64(docs[i]!, sv));
    }

    // Now apply all updates to all docs in random orders.
    const orders = [
      [0, 1, 2],
      [2, 1, 0],
      [1, 0, 2],
    ];
    for (let i = 0; i < docs.length; i++) {
      const order = orders[i]!;
      for (const u of order) {
        // Skip own update; already applied locally.
        if (u !== i) applyUpdateB64(docs[i]!, updates[u]!);
      }
    }

    // All three converge to the same final text.
    const a = readBody(docs[0]!);
    const b = readBody(docs[1]!);
    const c = readBody(docs[2]!);
    expect(b).toBe(a);
    expect(c).toBe(a);
    // The actual text contains every client's contribution.
    expect(a).toContain("c0");
    expect(a).toContain("c1");
    expect(a).toContain("c2");
  });

  it("the same update applied twice is idempotent (Yjs op-id dedupe)", () => {
    const sender = makeDoc();
    const receiver = makeDoc();
    // capture state vector before any edits so the diff includes every op
    const initialSV = snapshotStateVector(sender);
    sender.getText(Y_TEXT_FIELD).insert(0, "abc");
    const update = diffUpdateB64(sender, initialSV);

    applyUpdateB64(receiver, update);
    const after1 = readBody(receiver);
    applyUpdateB64(receiver, update); // same update again
    const after2 = readBody(receiver);
    expect(after2).toBe(after1);
    expect(after1).toBe("abc");
  });
});
