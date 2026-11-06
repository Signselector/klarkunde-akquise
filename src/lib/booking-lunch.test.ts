import { describe, expect, it } from "vitest";
import { daySlots } from "@/lib/booking-slots";

describe("lunch break", () => {
  const day = new Date(2026, 10, 12);
  const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

  it("offers no 30 minute appointment slot from 12:00 to 13:00", () => {
    const times = daySlots(day, "appointment").map(hhmm);
    expect(times).not.toContain("12:00");
    expect(times).not.toContain("12:30");
    expect(times).toContain("11:30");
    expect(times).toContain("13:00");
    expect(times[0]).toBe("08:00");
    expect(times.at(-1)).toBe("18:30");
  });

  it("callbacks are not affected", () => {
    const times = daySlots(day, "callback").map(hhmm);
    expect(times).toContain("12:00");
    expect(times).toContain("12:45");
  });
});
