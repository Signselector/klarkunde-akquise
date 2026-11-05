import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallbackTimeInput, WheelColumn } from "./slot-picker";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/calendar-sync.functions", () => ({ refreshBookingSlots: async () => ({}) }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));

const scrollTo = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 5, 8, 0, 0));
  scrollTo.mockReset();
  Element.prototype.scrollTo = scrollTo as never;
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const scrollWheel = (name: string, index: number) => {
  const wheel = screen.getByRole("spinbutton", { name });
  Object.defineProperty(wheel, "scrollTop", { value: index * 36, configurable: true });
  fireEvent.scroll(wheel);
  act(() => void vi.advanceTimersByTime(150));
};

describe("WheelColumn", () => {
  it("has one row per value, hidden scrollbars, snapping and a faded mask", () => {
    const { container } = render(
      <WheelColumn count={60} value={0} label="Minute" active onCommit={() => undefined} />,
    );
    expect(container.querySelectorAll("[role=presentation]").length).toBe(60);
    const wheel = screen.getByRole("spinbutton", { name: "Minute" });
    expect(wheel.className).toContain("snap-y");
    expect(wheel.className).toContain("snap-mandatory");
    expect(wheel.className).toContain("[scrollbar-width:none]");
    expect(wheel.className).toContain("[&::-webkit-scrollbar]:hidden");
    expect(wheel.style.maskImage).toContain("linear-gradient");
    expect(wheel.tabIndex).toBe(0);
  });

  it("reports the value only after the scrolling settled, and the last one wins", () => {
    const onCommit = vi.fn();
    render(<WheelColumn count={60} value={0} label="Minute" active onCommit={onCommit} />);
    const wheel = screen.getByRole("spinbutton", { name: "Minute" });
    for (const i of [3, 11, 25, 47]) {
      Object.defineProperty(wheel, "scrollTop", { value: i * 36, configurable: true });
      fireEvent.scroll(wheel);
      act(() => void vi.advanceTimersByTime(40));
    }
    expect(onCommit).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(150));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(47);
  });

  it("turns to a clicked number and with the arrow keys", () => {
    render(<WheelColumn count={24} value={10} label="Stunde" active onCommit={() => undefined} />);
    scrollTo.mockClear();
    fireEvent.click(screen.getByText("13"));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 13 * 36, behavior: "smooth" });
    const wheel = screen.getByRole("spinbutton", { name: "Stunde" });
    fireEvent.keyDown(wheel, { key: "ArrowDown" });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 11 * 36, behavior: "smooth" });
    // Quick repeated keys add up: down, down, up = +1.
    fireEvent.keyDown(wheel, { key: "ArrowDown" });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 12 * 36, behavior: "smooth" });
    fireEvent.keyDown(wheel, { key: "ArrowUp" });
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 11 * 36, behavior: "smooth" });
  });
});

describe("CallbackTimeInput", () => {
  const day = new Date(2026, 10, 6);

  it("lets the callback be set to any minute", () => {
    const onChange = vi.fn();
    render(<CallbackTimeInput day={day} chosen={null} disabled={false} onChange={onChange} />);
    scrollWheel("Stunde", 9);
    scrollWheel("Minute", 12);
    expect(new Date(onChange.mock.lastCall![0]).getHours()).toBe(9);
    expect(new Date(onChange.mock.lastCall![0]).getMinutes()).toBe(12);
    scrollWheel("Stunde", 15);
    scrollWheel("Minute", 47);
    const d = new Date(onChange.mock.lastCall![0]);
    expect([d.getHours(), d.getMinutes()]).toEqual([15, 47]);
  });

  it("selects 10:00 by default and shows no quick picks, hint or summary", () => {
    const onChange = vi.fn();
    render(<CallbackTimeInput day={day} chosen={null} disabled={false} onChange={onChange} />);
    const d = new Date(onChange.mock.calls[0]![0]);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      2026, 10, 6, 10, 0,
    ]);
    expect(screen.queryByRole("button", { name: "09:00" })).toBeNull();
    expect(screen.queryByText(/überschneiden/)).toBeNull();
  });

  it("warns about a time in the past today and selects nothing", () => {
    const onChange = vi.fn();
    render(
      <CallbackTimeInput
        day={new Date(2026, 10, 5)}
        chosen={null}
        disabled={false}
        onChange={onChange}
      />,
    );
    scrollWheel("Stunde", 7);
    scrollWheel("Minute", 30);
    expect(screen.getByRole("alert").textContent).toContain("liegt in der Vergangenheit");
    expect(onChange.mock.lastCall![0]).toBeNull();
  });
});
