import { describe, expect, it } from "vitest";
import { appointmentDotClass } from "@/lib/calendar-status";
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

describe("appointmentDotClass", () => {
  const now = new Date(2026, 9, 28, 12);
  it("is green for tool appointments, yellow for Pipedrive ones, grey once started", () => {
    const later = new Date(2026, 10, 3, 9);
    expect(appointmentDotClass(later, false, now)).toContain("bg-emerald-500");
    expect(appointmentDotClass(later, true, now)).toContain("bg-amber-400");
    expect(appointmentDotClass(new Date(2026, 9, 1), true, now)).toBe("bg-muted-foreground/40");
    expect(appointmentDotClass(new Date(2026, 9, 1), false, now)).toBe("bg-muted-foreground/40");
  });
});
