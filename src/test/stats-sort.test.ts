import { describe, expect, it } from "vitest";
import { sortTeam } from "@/components/stats-view";

const team = [
  { name: "Anna", calls: 10, low_q: 1, high_q: 0 },
  { name: "Bert", calls: 50, low_q: 2, high_q: 3 },
  { name: "Cora", calls: 30, low_q: 0, high_q: 1 },
];

describe("sortTeam", () => {
  it("sorts by total renders, highest first", () => {
    expect(sortTeam(team, "renders").map((m) => m.name)).toEqual(["Bert", "Anna", "Cora"]);
  });
  it("sorts by calls, highest first", () => {
    expect(sortTeam(team, "calls").map((m) => m.name)).toEqual(["Bert", "Cora", "Anna"]);
  });
});
