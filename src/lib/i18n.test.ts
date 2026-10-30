import { describe, expect, it } from "vitest";
import { translateText } from "@/lib/i18n-dict";

describe("translateText", () => {
  it("translates exact texts and keeps unknown ones", () => {
    expect(translateText("Offene Leads")).toBe("Open leads");
    expect(translateText("Ein ganz anderer Text")).toBe("Ein ganz anderer Text");
  });
  it("fills values into patterns", () => {
    expect(translateText("Noch 800 Anrufe bis zum Monatsziel.")).toBe("800 more calls to the monthly goal.");
    expect(translateText("Zuletzt online vor 5 Min.")).toBe("Last online 5 min ago");
  });
  it("ignores surrounding whitespace differences", () => {
    expect(translateText("  Rückruf   fällig ")).toBe("Callback due");
  });
});
