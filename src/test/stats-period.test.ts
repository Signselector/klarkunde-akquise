import { describe, expect, it } from "vitest";
import { addMonthsKey, isoWeekOf, periodOf, shiftAnchor, viennaStart, weekStartKey } from "@/lib/stats-period";

describe("stats periods (Vienna time)", () => {
  it("starts days at Vienna midnight in summer and winter time", () => {
    expect(viennaStart("2026-07-15").toISOString()).toBe("2026-07-14T22:00:00.000Z"); // summer time, UTC+2
    expect(viennaStart("2026-12-15").toISOString()).toBe("2026-12-14T23:00:00.000Z"); // winter time, UTC+1
  });
  it("handles the switch to winter time", () => {
    expect(viennaStart("2026-10-24").toISOString()).toBe("2026-10-23T22:00:00.000Z");
    expect(viennaStart("2026-10-26").toISOString()).toBe("2026-10-25T23:00:00.000Z");
    // the day of the change has 25 hours
    expect(new Date(viennaStart("2026-10-26").getTime() - viennaStart("2026-10-25").getTime()).getTime()).toBe(25 * 3600e3);
  });
  it("builds month, week and day periods", () => {
    const m = periodOf("month", "2026-10-28");
    expect([m.start, m.end, m.bucket]).toEqual(["2026-10-01", "2026-11-01", "day"]);
    const w = periodOf("week", "2026-10-28");
    expect([w.start, w.end]).toEqual(["2026-10-26", "2026-11-02"]);
    expect(w.label).toMatch(/^KW 44 · /);
    const d = periodOf("day", "2026-10-28");
    expect([d.start, d.end, d.bucket]).toEqual(["2026-10-28", "2026-10-29", "hour"]);
    expect(d.label).toMatch(/Mittwoch/);
  });
  it("shifts by whole periods", () => {
    expect(shiftAnchor("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftAnchor("week", "2026-10-28", -1)).toBe("2026-10-21");
    expect(shiftAnchor("day", "2026-12-31", 1)).toBe("2027-01-01");
    expect(addMonthsKey("2026-12-15", 1)).toBe("2027-01-01");
    expect(weekStartKey("2026-11-01")).toBe("2026-10-26");
    expect(isoWeekOf("2026-01-01")).toBe(1);
  });
});
