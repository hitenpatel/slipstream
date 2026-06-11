import { describe, expect, it } from "vitest";
import { isUuidv7, uuidv7 } from "./ids.js";

describe("uuidv7", () => {
  it("has the v7 format", () => {
    for (let i = 0; i < 50; i++) {
      const id = uuidv7();
      expect(isUuidv7(id)).toBe(true);
    }
  });

  it("is monotonic across calls in the same ms", () => {
    const t = Date.now();
    const ids: string[] = [];
    for (let i = 0; i < 1000; i++) ids.push(uuidv7(t));
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  it("time-orders later timestamps after earlier ones", () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_001_000);
    expect(a < b).toBe(true);
  });
});
