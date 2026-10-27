import { describe, expect, it } from "vitest";
import { addDays, inWeek, isoWeek, startOfWeek, weekTitle } from "@/components/caller/week-calendar";

describe("week helpers", () => {
  it("weeks start on Monday and end on Sunday", () => {
    const wed = new Date(2026, 9, 28);
    expect(startOfWeek(wed)).toEqual(new Date(2026, 9, 26));
    expect(startOfWeek(new Date(2026, 10, 1))).toEqual(new Date(2026, 9, 26)); // Sunday belongs to the week before
    expect(inWeek(new Date(2026, 10, 1, 23, 59), new Date(2026, 9, 26))).toBe(true);
    expect(inWeek(new Date(2026, 10, 2), new Date(2026, 9, 26))).toBe(false);
    expect(addDays(new Date(2026, 9, 31), 1)).toEqual(new Date(2026, 10, 1));
  });
  it("numbers ISO calendar weeks", () => {
    expect(isoWeek(new Date(2026, 9, 26))).toBe(44);
    expect(isoWeek(new Date(2026, 0, 1))).toBe(1);
    expect(isoWeek(new Date(2025, 11, 29))).toBe(1);
  });
  it("titles the week with number and range", () => {
    expect(weekTitle(new Date(2026, 9, 26))).toMatch(/^KW 44 · 26\. Okt.* – 01\. Nov\.? 2026$/);
  });
});
