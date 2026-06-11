import { describe, expect, it } from "vitest";
import { between } from "./fractional.js";

describe("fractional.between", () => {
  it("returns a key strictly between bounds", () => {
    const k = between("A", "C");
    expect(k > "A").toBe(true);
    expect(k < "C").toBe(true);
  });

  it("works with null bounds (start and end of list)", () => {
    const first = between(null, "M");
    expect(first < "M").toBe(true);
    const last = between("M", null);
    expect(last > "M").toBe(true);
  });

  it("works between adjacent digits by descending one level", () => {
    const k = between("A", "B");
    expect(k > "A").toBe(true);
    expect(k < "B").toBe(true);
  });

  it("rejects out-of-order bounds", () => {
    expect(() => between("C", "A")).toThrow();
    expect(() => between("A", "A")).toThrow();
  });

  it("can repeatedly insert between the same two neighbours without collision", () => {
    let lo = "A";
    const hi = "C";
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const mid = between(lo, hi);
      expect(mid > lo).toBe(true);
      expect(mid < hi).toBe(true);
      expect(seen.has(mid)).toBe(false);
      seen.add(mid);
      lo = mid;
    }
  });
});
