import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { niceScale, toWeeks, weekRangeLabel, WeekBars } from "@/components/stats-view";

afterEach(cleanup);

const november = Array.from({ length: 30 }, (_, i) => ({
  key: `2026-11-${String(i + 1).padStart(2, "0")}`,
  value: i + 1,
}));

describe("week chart helpers", () => {
  it("chooses two to four gridlines", () => {
    expect(niceScale(60)).toEqual({ step: 20, top: 60 });
    expect(niceScale(0)).toEqual({ step: 1, top: 1 });
    expect(niceScale(7)).toEqual({ step: 5, top: 10 });
    expect(niceScale(130)).toEqual({ step: 50, top: 150 });
  });

  it("splits a month into Monday to Sunday weeks, days outside the period stay empty", () => {
    const weeks = toWeeks(november);
    expect(weeks[0]!.start).toBe("2026-10-26");
    expect(weeks[0]!.days.map((d) => d.value)).toEqual([null, null, null, null, null, null, 1]);
    expect(weeks.at(-1)!.days.at(-1)!.value).toBeNull();
  });

  it("labels a week like the mock-up", () => {
    expect(weekRangeLabel("2026-11-02")).toBe("2. – 8. November");
    expect(weekRangeLabel("2026-10-26")).toBe("26. Okt – 1. Nov");
  });
});

describe("WeekBars", () => {
  it("starts at the week of today and pages through the weeks", () => {
    render(<WeekBars points={november} today="2026-11-04" />);
    expect(screen.getByText("2. – 8. November")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Nächste Woche" }));
    expect(screen.getByText("9. – 15. November")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Vorherige Woche" }));
    fireEvent.click(screen.getByRole("button", { name: "Vorherige Woche" }));
    expect(screen.getByText("26. Okt – 1. Nov")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Vorherige Woche" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("in week mode the arrows move the whole period", () => {
    const onShift = vi.fn();
    render(<WeekBars points={november.slice(1, 8)} today="2026-11-04" onShift={onShift} />);
    fireEvent.click(screen.getByRole("button", { name: "Nächste Woche" }));
    expect(onShift).toHaveBeenCalledWith(1);
  });
});

describe("WeekBars for a month", () => {
  const november2 = november.map((p) => ({ ...p, value: p.value * 2 }));

  it("shows every day of the month and nothing of October or December", () => {
    render(
      <WeekBars points={november2} today="2026-11-04" fullPeriod periodLabel="november 2026" />,
    );
    expect(screen.getAllByRole("button", { name: /Gespräche$/ }).length).toBe(30);
    expect(screen.getByRole("button", { name: "1. November: 2 Gespräche" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Vorherige Woche/ })).toBeNull();
    expect(screen.getByText("november 2026")).toBeTruthy();
  });

  it("all bars are dark; a tap shows the exact number and greys out the others", () => {
    render(
      <WeekBars points={november2} today="2026-11-04" fullPeriod periodLabel="november 2026" />,
    );
    const bar = (n: number) =>
      screen
        .getByRole("button", { name: new RegExp(`^${n}\\. November`) })
        .querySelector("span > span") as HTMLElement;
    expect(bar(3).className).toContain("bg-primary");
    expect(bar(4).className).toContain("bg-primary");
    fireEvent.click(screen.getByRole("button", { name: "3. November: 6 Gespräche" }));
    expect(
      screen.getByRole("button", { name: "3. November: 6 Gespräche" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByRole("button", { name: "3. November: 6 Gespräche" }).textContent).toContain(
      "6",
    );
    expect(bar(3).className).toContain("bg-primary");
    expect(bar(4).className).toContain("bg-muted-foreground/25");
    fireEvent.click(screen.getByRole("button", { name: "3. November: 6 Gespräche" }));
    expect(bar(4).className).toContain("bg-primary");
  });
});
