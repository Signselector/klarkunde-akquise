import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CelebrationNotifier } from "./celebration-notifier";
import { markOwnCelebration } from "@/lib/celebration";

const hub = vi.hoisted(() => ({
  handler: null as null | ((m: { payload: unknown }) => void),
  names: [] as string[],
  config: [] as unknown[],
  removed: 0,
}));
vi.mock("@/lib/country", () => ({ useCountry: () => "DE" }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: (name: string, config: unknown) => {
      hub.names.push(name);
      hub.config.push(config);
      const ch = {
        on: (_t: string, _f: unknown, cb: (m: { payload: unknown }) => void) => {
          hub.handler = cb;
          return ch;
        },
        subscribe: () => ch,
      };
      return ch;
    },
    removeChannel: () => {
      hub.removed++;
    },
  },
}));

const send = (payload: unknown) => act(() => hub.handler?.({ payload }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("reduce"),
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  hub.handler = null;
  hub.names.length = 0;
  hub.config.length = 0;
  hub.removed = 0;
});

describe("live celebration", () => {
  it("listens only on the private channel of the own country", () => {
    render(<CelebrationNotifier />);
    expect(hub.names).toEqual(["celebrations-DE"]);
    expect(hub.config[0]).toMatchObject({ config: { private: true } });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the anonymous text and removes it after exactly 3 seconds", () => {
    render(<CelebrationNotifier />);
    send({ type: "low_q" });
    expect(screen.getByRole("status").textContent).toContain(
      "Neuer Logo Render im Team generiert!",
    );
    act(() => void vi.advanceTimersByTime(2999));
    expect(screen.queryByRole("status")).not.toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("uses fixed texts for every kind and never shows data from the payload", () => {
    render(<CelebrationNotifier />);
    send({ type: "won", company: "Geheim GmbH", name: "Anna" });
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toContain("Ein Deal wurde erfolgreich gewonnen!");
    expect(text).not.toMatch(/Geheim|Anna/);
    send({ type: "high_q" });
    expect(screen.getByRole("status").textContent).toContain(
      "Neuer Realismus Render im Team generiert!",
    );
  });

  it("ignores unknown events and its own result", () => {
    render(<CelebrationNotifier />);
    send({ type: "something_else" });
    send(null);
    expect(screen.queryByRole("status")).toBeNull();
    markOwnCelebration("low_q");
    send({ type: "low_q" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("can be closed at once with the X, and gives no confetti with reduced motion", () => {
    render(<CelebrationNotifier />);
    send({ type: "won" });
    expect(document.querySelectorAll(".cc-confetti-piece").length).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("leaves the channel when it unmounts", () => {
    const { unmount } = render(<CelebrationNotifier />);
    unmount();
    expect(hub.removed).toBe(1);
  });
});
