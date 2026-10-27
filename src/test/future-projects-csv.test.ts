import { describe, expect, it } from "vitest";
import { futureProjectsCsv, monthLabel, type FutureProjectLead } from "@/lib/future-projects-csv";

const row: FutureProjectLead = {
  lead_id: "1",
  company: "Muster; GmbH",
  contact_name: null,
  phone: "+49 1",
  email: null,
  city: "Berlin",
  extra: { Website: "muster.example", Adresse: "Weg 1" },
  batch: "B1",
  caller: "Anna",
  target_month: "2027-03",
  created_at: "2026-10-27T10:00:00Z",
  note: "=1+1",
};

describe("future projects csv", () => {
  it("formats the target month", () => {
    expect(monthLabel("2027-03")).toBe("03/2027");
    expect(monthLabel(null)).toBe("");
  });
  it("starts with the target month and neutralises formulas", () => {
    const lines = futureProjectsCsv([row]).replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]!.startsWith("Zielmonat;Firma")).toBe(true);
    expect(lines[1]!.startsWith('03/2027;"Muster; GmbH"')).toBe(true);
    expect(lines[1]).toContain("muster.example");
    expect(lines[1]!.endsWith("'=1+1")).toBe(true);
  });
});
