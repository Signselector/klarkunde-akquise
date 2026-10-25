import { describe, it, expect } from "vitest";
import { suggestNextStep, parseCsv } from "./leads";

describe("suggestNextStep", () => {
  it("schlägt nach 3x nicht erreicht andere Uhrzeit vor", () => {
    expect(suggestNextStep({ status: "open", attempts: 3, last_called_at: null })).toContain(
      "3x nicht erreicht: andere Uhrzeit probieren",
    );
  });
  it("meldet überfälligen Callback", () => {
    const s = suggestNextStep(
      { status: "callback", attempts: 1, last_called_at: null },
      { now: new Date("2026-10-23T12:00:00Z"), callbackDueAt: "2026-10-23T09:00:00Z" },
    );
    expect(s).toBe("Callback überfällig – jetzt zurückrufen.");
  });
});

describe("parseCsv", () => {
  it("erkennt Semikolon und Anführungszeichen", () => {
    expect(parseCsv('a;b\n"x;1";2\n')).toEqual([
      ["a", "b"],
      ["x;1", "2"],
    ]);
  });
});
