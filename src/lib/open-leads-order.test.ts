import { describe, expect, it } from "vitest";
import { orderOpenLeads } from "@/lib/leads";

const lead = (id: string, status: string, attempts = 0) => ({ id, status, attempts });

describe("orderOpenLeads", () => {
  it("puts callbacks first, earliest due on top, then untouched, then not reached", () => {
    const rows = [
      lead("a", "open"),
      lead("b", "open", 2),
      lead("c", "callback"),
      lead("d", "callback"),
      lead("e", "appointment_missed"),
    ];
    const due = new Map([
      ["c", 2000],
      ["d", 1000],
    ]);
    expect(orderOpenLeads(rows, due).map((l) => l.id)).toEqual(["d", "c", "a", "e", "b"]);
  });
  it("lists a lead only once", () => {
    const rows = [lead("a", "callback"), lead("a", "callback"), lead("b", "open")];
    expect(orderOpenLeads(rows).map((l) => l.id)).toEqual(["a", "b"]);
  });
});
