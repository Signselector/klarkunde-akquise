import { describe, expect, it } from "vitest";
import { buildMeetingUpdate, canEditPdActivity, pdKind } from "@/lib/pipedrive-activity";

describe("pipedrive activities", () => {
  it("tells meetings and calls apart", () => {
    expect(pdKind("meeting")).toBe("meeting");
    expect(pdKind("call")).toBe("call");
    expect(pdKind("task")).toBe("other");
    expect(pdKind(null)).toBe("other");
  });
  it("lets only staff edit, and only meetings", () => {
    expect(canEditPdActivity("meeting", true)).toBe(true);
    expect(canEditPdActivity("meeting", false)).toBe(false);
    expect(canEditPdActivity("call", true)).toBe(false);
  });
  it("builds the Pipedrive update in UTC", () => {
    expect(buildMeetingUpdate({ subject: " Showroom ", startsAt: "2026-11-02T09:30:00Z", durationMin: 90 })).toEqual({
      subject: "Showroom",
      due_date: "2026-11-02",
      due_time: "09:30",
      duration: "01:30",
    });
    expect(() => buildMeetingUpdate({ subject: "", startsAt: "2026-11-02T09:30:00Z", durationMin: 30 })).toThrow();
    expect(() => buildMeetingUpdate({ subject: "x", startsAt: "nope", durationMin: 30 })).toThrow();
  });
});
