import { describe, it, expect } from "vitest";
import { inWelcomeWindow } from "./welcome-mail.server";

describe("welcome mail window (Vienna time)", () => {
  it("does not send at 05:59 Vienna", () => {
    expect(inWelcomeWindow(new Date("2026-11-02T04:59:00Z"))).toBe(false);
  });
  it("sends from 06:00 Vienna", () => {
    expect(inWelcomeWindow(new Date("2026-11-02T05:00:00Z"))).toBe(true);
  });
  it("does not send late in the evening (21:45 Vienna)", () => {
    expect(inWelcomeWindow(new Date("2026-11-01T20:45:00Z"))).toBe(false);
  });
});
