import { describe, expect, it } from "vitest";
import { median, ratio } from "../src/core/stats";

describe("median", () => {
  it("handles odd length", () => {
    expect(median([5, 1, 9])).toBe(5);
  });

  it("handles even length", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("returns null for empty", () => {
    expect(median([])).toBeNull();
  });
});

describe("ratio", () => {
  it("computes value", () => {
    expect(ratio(2, 4)).toBe(0.5);
  });

  it("guards divide by zero", () => {
    expect(ratio(1, 0)).toBeNull();
  });
});
