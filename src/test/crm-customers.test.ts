import { describe, expect, it } from "vitest";
import { fetchDeals, type DealInfo, type DealReader } from "@/lib/crm-customers";
import { placeDeals, type CustomerDeal } from "@/lib/customer-stages";

const info = (id: number, stage: number): DealInfo => ({ id, stage_id: stage, status: "open" });

describe("fetchDeals", () => {
  it("uses one batched request per 100 deals", async () => {
    const batches: number[][] = [];
    const reader: DealReader = {
      listByIds: async (ids) => (batches.push(ids), ids.map((id) => info(id, 8))),
      get: async () => {
        throw new Error("must not be needed");
      },
    };
    const ids = Array.from({ length: 150 }, (_, i) => i + 1);
    const result = await fetchDeals(reader, ids);
    expect(batches.map((b) => b.length)).toEqual([100, 50]);
    expect(result.size).toBe(150);
  });

  it("looks up deals the batch did not return one by one, and keeps deleted deals as null", async () => {
    const reader: DealReader = {
      listByIds: async () => [info(1, 8)],
      get: async (id) => (id === 3 ? null : info(id, 9)),
    };
    const result = await fetchDeals(reader, [1, 2, 3]);
    expect(result.get(1)).toEqual(info(1, 8));
    expect(result.get(2)).toEqual(info(2, 9));
    expect(result.get(3)).toBeNull();
  });

  it("falls back to single requests when the batch request is rejected, but not on real errors", async () => {
    const rejected: DealReader = {
      listByIds: async () => {
        throw new Error("invalid_payload");
      },
      get: async (id) => info(id, 7),
    };
    expect((await fetchDeals(rejected, [5])).get(5)).toEqual(info(5, 7));
    const down: DealReader = {
      listByIds: async () => {
        throw new Error("unauthorized");
      },
      get: async (id) => info(id, 7),
    };
    await expect(fetchDeals(down, [5])).rejects.toThrow("unauthorized");
  });

  it("ignores deals that were not asked for and duplicates", async () => {
    const reader: DealReader = {
      listByIds: async () => [info(1, 8), info(99, 8)],
      get: async () => null,
    };
    const result = await fetchDeals(reader, [1, 1]);
    expect([...result.keys()]).toEqual([1]);
  });
});

const deal = (
  n: number,
  stage: number | null,
  local: string | null = null,
  source: CustomerDeal["source"] = "pipedrive",
): CustomerDeal => ({
  lead_id: `l${n}`,
  deal_id: n,
  company: `Firma ${n}`,
  contact_name: null,
  email: null,
  phone: null,
  last_called_at: null,
  stage_id: stage,
  deal_status: "open",
  local_stage_key: local,
  source,
});

describe("placeDeals", () => {
  const mapping = {
    waiting_3d: 7,
    low_q: 8,
    won_other_percent: 50,
    won_production_planning: 51,
    won_zero_percent: 52,
  };
  const column = (r: ReturnType<typeof placeDeals>, key: string) =>
    r.columns.find((c) => c.column.key === key)!;

  it("places deals by the stage they are in at Pipedrive", () => {
    const r = placeDeals([deal(1, 8), deal(2, 7), deal(3, 51), deal(4, 52)], mapping);
    expect(column(r, "low_q").deals.map((d) => d.deal_id)).toEqual([1]);
    expect(column(r, "waiting_3d").deals.map((d) => d.deal_id)).toEqual([2]);
    expect(column(r, "won").deals.map((d) => d.deal_id)).toEqual([3, 4]);
  });

  it("puts deals in unknown stages into the separate list instead of guessing", () => {
    const r = placeDeals([deal(1, 999), deal(2, null)], mapping);
    expect(r.other.map((d) => d.deal_id)).toEqual([1, 2]);
  });

  it("uses the locally recorded stage only for deals Pipedrive could not confirm", () => {
    const r = placeDeals([deal(1, 7, "low_q", "local"), deal(2, 7, "low_q", "pipedrive")], mapping);
    expect(column(r, "low_q").deals.map((d) => d.deal_id)).toEqual([1]);
    expect(column(r, "waiting_3d").deals.map((d) => d.deal_id)).toEqual([2]);
  });

  it("shows every requested column in the requested order, mapped or not", () => {
    const r = placeDeals([], {});
    expect(r.columns.map((c) => c.column.label)).toEqual([
      "Logo ausstehend",
      "Zukunftsprojekt",
      "Logo Render",
      "Realismus Render",
      "In Bearbeitung",
      "3D fertig",
      "No Show",
      "Geringe Chance",
      "Vielleicht / Sehr interessiert",
      "Angebot erstellen",
      "Kaufvertrag erstellen",
      "Kaufvertrag waiting",
      "Gewonnen",
    ]);
    expect(r.columns.every((c) => c.stageIds.length === 0)).toBe(true);
  });
});

describe("AT customer columns", () => {
  it("uses the AT order and puts 52, 37, 55 into Gewonnen", async () => {
    const { placeDeals: place } = await import("@/lib/customer-stages");
    const m = { waiting_3d: 34, low_q: 21, high_q: 1, animation: 17, rd_done: 16, no_show: 26, low_chance: 15, maybe_interested: 54, very_interested: 32, offer: 33, contract: 8, contract_waiting: 35, won_zero_percent: 52, won_production_planning: 37, won_other_percent: 55 };
    const d = (id: number, stage: number) => ({ lead_id: String(id), deal_id: id, company: null, contact_name: null, email: null, phone: null, last_called_at: null, stage_id: stage, deal_status: "open", local_stage_key: null, source: "pipedrive" as const });
    const r = place([d(1, 52), d(2, 37), d(3, 55), d(4, 54)], m, "AT");
    expect(r.columns.map((c) => c.stageIds.join("+"))).toEqual(["34","21","1","17","16","26","15","54","32","33","8","35","52+37+55"]);
    expect(r.columns.at(-1)!.deals).toHaveLength(3);
    expect(r.columns[7]!.column.label).toBe("Mittel Interesse");
  });
});
