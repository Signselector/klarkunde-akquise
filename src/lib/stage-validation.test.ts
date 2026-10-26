import { describe, expect, it } from "vitest";
import { buildValidationReport, type PipedriveStage } from "./stage-validation";

const stages: PipedriveStage[] = [
  { id: 8, name: "3D Low Q", pipeline_name: "Sales" },
  { id: 9, name: "3D High Q", pipeline_name: "Sales" },
  { id: 7, name: "3D Waiting", pipeline_name: "Sales" },
  { id: 30, name: "Zukünftiges Interesse", pipeline_name: "Sales" },
  { id: 36, name: "Referenzmail versendet", pipeline_name: "Sales" },
  { id: 6, name: "Kontaktdaten hinterlegt", pipeline_name: "Sales" },
];
const mapping = {
  low_q: 8,
  high_q: 9,
  waiting_3d: 7,
  on_hold: 30,
  reference_mail: 36,
  contact_saved: 6,
};
const field = { key: "abc123", name: "Ursprünglicher Caller", field_type: "varchar" };
const run = (over: Partial<Parameters<typeof buildValidationReport>[0]> = {}) =>
  buildValidationReport({
    mapping,
    stages,
    dealFields: [field],
    personFields: [],
    originFieldKey: "abc123",
    ...over,
  });

describe("stage validation", () => {
  it("accepts a complete, matching configuration", () => {
    const r = run();
    expect(r.ok).toBe(true);
    expect(r.items.every((i) => i.status === "ok")).toBe(true);
  });
  it("reports missing and unknown IDs as errors, never inventing one", () => {
    const r = run({ mapping: { ...mapping, high_q: undefined as never, low_q: 999 } });
    expect(r.ok).toBe(false);
    expect(r.items.find((i) => i.key === "high_q")?.status).toBe("error");
    expect(r.items.find((i) => i.key === "low_q")?.message).toContain("999");
  });
  it("flags two actions sharing one stage", () => {
    const r = run({ mapping: { ...mapping, waiting_3d: 8 } });
    expect(r.ok).toBe(false);
    expect(r.items.find((i) => i.key === "waiting_3d")?.message).toContain("low_q");
  });
  it("warns when a stage name does not fit but does not block", () => {
    const r = run({ stages: stages.map((s) => (s.id === 9 ? { ...s, name: "Irgendwas" } : s)) });
    expect(r.items.find((i) => i.key === "high_q")?.status).toBe("warning");
    expect(r.ok).toBe(true);
  });
  it("does not treat a lifecycle option as a deal stage", () => {
    const r = run({
      stages: stages.map((s) => (s.id === 30 ? { ...s, name: "On Hold" } : s)),
      personFields: [
        { key: "lc", name: "Lifecycle Stage", options: [{ label: "Zukünftiges Interesse" }] },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.items.find((i) => i.key === "future_interest")?.message).toContain("Lifecycle");
  });
  it("needs the original-caller field to exist", () => {
    expect(run({ originFieldKey: null }).ok).toBe(false);
    expect(run({ originFieldKey: "nope" }).ok).toBe(false);
  });
});
