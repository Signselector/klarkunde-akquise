import { describe, expect, it } from "vitest";
import { presenceState } from "@/lib/presence";
import { auditDetail } from "@/lib/audit-labels";

const now = Date.parse("2026-01-01T12:00:00Z");
describe("presenceState", () => {
  it("is online within the heartbeat window", () => {
    expect(presenceState("2026-01-01T11:59:00Z", now)).toEqual({ online: true, label: "Online" });
  });
  it("shows how long ago a user was seen", () => {
    expect(presenceState("2026-01-01T11:30:00Z", now).label).toBe("Zuletzt online vor 30 Min.");
    expect(presenceState("2026-01-01T09:00:00Z", now).label).toBe("Zuletzt online vor 3 Std.");
    expect(presenceState("2025-12-30T12:00:00Z", now).label).toBe("Zuletzt online vor 2 Tagen");
  });
  it("handles users who never logged in", () => {
    expect(presenceState(null, now).online).toBe(false);
  });
});
describe("auditDetail", () => {
  it("describes role changes", () => {
    expect(auditDetail("user_role_changed", { old_role: "recruit", new_role: "manager" })).toBe(
      "Caller → Manager",
    );
  });
});
