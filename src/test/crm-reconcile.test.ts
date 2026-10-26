import { describe, expect, it } from "vitest";
import { reconcileDeals } from "@/lib/crm-reconcile";
import type { DealReader } from "@/lib/crm-customers";

const reader = (
  deals: Record<number, { stage_id: number | null; status: string | null } | null>,
): DealReader => ({
  listByIds: async (ids) =>
    ids.flatMap((id) =>
      deals[id] ? [{ id, stage_id: deals[id]!.stage_id, status: deals[id]!.status }] : [],
    ),
  get: async (id) =>
    deals[id] ? { id, stage_id: deals[id]!.stage_id, status: deals[id]!.status } : null,
});

describe("reconcileDeals", () => {
  it("applies every deal once with a deterministic event id", async () => {
    const seen: string[] = [];
    const r = await reconcileDeals(
      [1, 2, 2, 3],
      reader({ 1: { stage_id: 8, status: "open" }, 2: { stage_id: 9, status: "won" }, 3: null }),
      async (a) => (
        seen.push(`${a.dealId}:${a.stageId}:${a.status}:${a.eventId}`),
        { applied: a.dealId === 2 }
      ),
      new Date("2026-10-26T09:30:00Z"),
    );
    expect(r).toEqual({ checked: 3, changed: 1, missing: 1 });
    expect(seen).toEqual([
      "1:8:null:recon:1:8:-:2026-10-26T09",
      "2:9:won:recon:2:9:won:2026-10-26T09",
    ]);
  });
  it("handles more deals than one batch holds", async () => {
    const ids = Array.from({ length: 650 }, (_, i) => i + 1);
    const deals = Object.fromEntries(ids.map((id) => [id, { stage_id: 1, status: "open" }]));
    let calls = 0;
    const r = await reconcileDeals(ids, reader(deals), async () => (calls++, { applied: false }));
    expect(r.checked).toBe(650);
    expect(calls).toBe(650);
  });
});
