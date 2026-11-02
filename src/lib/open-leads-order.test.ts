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

describe("reference mail leads", () => {
  it("sit below not reached leads at the very bottom", async () => {
    const { orderOpenLeads } = await import("./leads");
    const rows = [
      { id: "r", status: "reference_mail", attempts: 1 },
      { id: "n", status: "open", attempts: 2 },
      { id: "o", status: "open", attempts: 0 },
    ];
    expect(orderOpenLeads(rows).map((l) => l.id)).toEqual(["o", "n", "r"]);
  });
});
