import { describe, expect, it } from "vitest";
import { formatPer100, monthStart, per100Delta, weekLabel, weekStart } from "@/lib/dashboard";

describe("dashboard helpers", () => {
  it("prints leads per 100 with two decimals and no percent sign", () => {
    expect(formatPer100(18.85)).toBe("18,85");
    expect(formatPer100(100)).toBe("100,00");
    expect(formatPer100(0)).toBe("0,00");
    expect(formatPer100(28.28)).not.toContain("%");
  });
  it("shows the change to the previous month only when both exist", () => {
    expect(per100Delta(20, 18.85)).toBe("+1,15");
    expect(per100Delta(10, 12.5)).toBe("−2,50");
    expect(per100Delta(5, 5)).toBe("±0,00");
    expect(per100Delta(null, 5)).toBeNull();
    expect(per100Delta(5, null)).toBeNull();
  });
  it("formats month and week boundaries", () => {
    expect(monthStart({ year: 2026, month: 9 })).toBe("2026-09-01");
    expect(weekStart(new Date("2026-09-17T10:00:00Z"))).toBe("2026-09-14");
    expect(weekStart(new Date("2026-09-20T10:00:00Z"))).toBe("2026-09-14");
    expect(weekStart(new Date("2026-09-21T10:00:00Z"))).toBe("2026-09-21");
    expect(weekStart(new Date("2026-09-17T10:00:00Z"), -1)).toBe("2026-09-07");
    expect(weekLabel("2026-09-14")).toBe("14.9.–20.9.");
  });
});
