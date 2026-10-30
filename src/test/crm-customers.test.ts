import { describe, expect, it } from "vitest";
import { fetchDeals, type DealInfo, type DealReader } from "@/lib/crm-customers";

const info = (id: number, stage: number, status = "open"): DealInfo => ({ id, stage_id: stage, status });
const unused = async () => [];

describe("fetchDeals", () => {
  it("looks up every deal on its own", async () => {
    const reader: DealReader = { listByIds: unused, get: async (id) => info(id, 8) };
    const result = await fetchDeals(reader, [1, 2, 3, 1]);
    expect([...result.keys()].sort()).toEqual([1, 2, 3]);
  });

  it("treats deals deleted in Pipedrive as gone", async () => {
    const reader: DealReader = {
      listByIds: unused,
      get: async (id) => (id === 2 ? info(2, 21, "deleted") : id === 3 ? null : info(id, 8)),
    };
    const result = await fetchDeals(reader, [1, 2, 3]);
    expect(result.get(1)).toEqual(info(1, 8));
    expect(result.get(2)).toBeNull();
    expect(result.get(3)).toBeNull();
  });

  it("keeps the other deals when one lookup fails", async () => {
    const reader: DealReader = {
      listByIds: unused,
      get: async (id) => {
        if (id === 2) throw new Error("network_error");
        return info(id, 8);
      },
    };
    const result = await fetchDeals(reader, [1, 2]);
    expect(result.get(1)).toEqual(info(1, 8));
    expect(result.has(2)).toBe(false);
  });

  it("fails only when no deal could be read at all", async () => {
    const reader: DealReader = {
      listByIds: unused,
      get: async () => {
        throw new Error("unauthorized");
      },
    };
    await expect(fetchDeals(reader, [5, 6])).rejects.toThrow("unauthorized");
  });
});
