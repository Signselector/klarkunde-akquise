import { describe, expect, it } from "vitest";
import {
  currentMonth,
  monthOptions,
  monthWindow,
  parseMonth,
  shiftMonth,
  summarize,
  viennaDate,
} from "@/lib/monthly-stats";

const ev = (new_status: string, created_at: string) => ({ new_status, created_at });

describe("monthly stats", () => {
  it("counts calls, reached and deal results of the chosen month only", () => {
    const events = [
      ev("low_q", "2026-10-05T08:00:00Z"),
      ev("not_reached", "2026-10-05T09:00:00Z"),
      ev("no_interest", "2026-10-06T09:00:00Z"),
      ev("on_hold", "2026-10-06T10:00:00Z"),
      ev("open", "2026-10-06T11:00:00Z"), // a reopened lead is not a call
      ev("high_q", "2026-09-30T10:00:00Z"), // previous month
      ev("callback", "2026-11-02T10:00:00Z"), // next month
    ];
    const s = summarize(events, { year: 2026, month: 10 });
    expect(s.calls).toBe(4);
    expect(s.reached).toBe(3);
    expect(s.reachRate).toBe(75);
    expect(s.deals).toBe(2);
    expect(s.activeDays).toBe(2);
    expect(s.perDay[4]?.value).toBe(2); // 5 October
    expect(s.byOutcome.find((o) => o.status === "low_q")?.value).toBe(1);
    expect(s.perDay).toHaveLength(31);
  });

  it("assigns late evenings to the right Vienna day and month", () => {
    // 23:30 UTC on 31 October is already 1 November in Vienna.
    expect(viennaDate("2026-10-31T23:30:00Z")).toBe("2026-11-01");
    expect(summarize([ev("low_q", "2026-10-31T23:30:00Z")], { year: 2026, month: 10 }).calls).toBe(
      0,
    );
    expect(summarize([ev("low_q", "2026-10-31T23:30:00Z")], { year: 2026, month: 11 }).calls).toBe(
      1,
    );
  });

  it("prints no rate for a month without calls instead of a made-up zero", () => {
    expect(summarize([], { year: 2026, month: 9 }).reachRate).toBeNull();
  });

  it("walks months across year boundaries and lists the last 24", () => {
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    const options = monthOptions(new Date("2026-10-24T10:00:00Z"));
    expect(options).toHaveLength(24);
    expect(options[0]).toEqual({ year: 2026, month: 10 });
    expect(options[23]).toEqual({ year: 2024, month: 11 });
    expect(currentMonth(new Date("2026-12-31T23:30:00Z"))).toEqual({ year: 2027, month: 1 });
    expect(parseMonth("2026-03")).toEqual({ year: 2026, month: 3 });
  });

  it("queries a window that contains the whole month", () => {
    const w = monthWindow({ year: 2026, month: 10 });
    expect(w.from <= "2026-09-30T23:00:00.000Z").toBe(true);
    expect(w.to >= "2026-11-01T00:00:00.000Z").toBe(true);
  });
});
