import { describe, expect, it } from "vitest";
import { detectRenderType, pdToIso } from "./deal-import";

const mapping = { low_q: 21, high_q: 1 };

describe("detectRenderType", () => {
  it("finds Realismus Render in history after the deal moved on", () => {
    expect(
      detectRenderType({
        mapping,
        currentStageId: 16,
        stageChanges: [{ at: "2026-10-30T15:09:00Z", oldStageId: 1, newStageId: 16 }],
        title: "Firma X",
      }),
    ).toBe("high_q");
  });
  it("uses the current stage when there is no history", () => {
    expect(detectRenderType({ mapping, currentStageId: 21, stageChanges: [], title: null })).toBe("low_q");
  });
  it("falls back to the title", () => {
    expect(detectRenderType({ mapping, currentStageId: 99, stageChanges: [], title: "Logo Render: Bäckerei" })).toBe("low_q");
  });
  it("returns null when nothing matches", () => {
    expect(detectRenderType({ mapping, currentStageId: 99, stageChanges: [], title: "Deal" })).toBeNull();
  });
});

describe("pdToIso", () => {
  it("reads Pipedrive UTC time", () => {
    expect(pdToIso("2026-10-30 15:09:00")).toBe("2026-10-30T15:09:00.000Z");
  });
});
