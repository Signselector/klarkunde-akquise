import { describe, expect, it } from "vitest";
import { noInterestCsv, type NoInterestLead } from "@/lib/no-interest-csv";

const row = (over: Partial<NoInterestLead> = {}): NoInterestLead => ({
  lead_id: "1",
  company: "Muster; GmbH",
  contact_name: 'Max "M" Muster',
  phone: "+49 30 123",
  email: null,
  city: "Berlin",
  extra: { Website: "muster.example", Adresse: "Weg 1" },
  batch: "B1",
  caller: "Anna",
  declined_at: "2026-10-26T09:00:00Z",
  note: "zu\nteuer",
  ...over,
});

describe("noInterestCsv", () => {
  it("writes a BOM, a header and escaped cells", () => {
    const csv = noInterestCsv([row()]);
    expect(csv.startsWith("﻿Firma;Ansprechpartner;")).toBe(true);
    const line = csv.split("\r\n")[1]!;
    expect(line).toBe(
      '"Muster; GmbH";"Max ""M"" Muster";+49 30 123;;Berlin;muster.example;Weg 1;B1;Anna;26.10.2026;zu teuer',
    );
  });
  it("neutralises formulas but keeps phone numbers", () => {
    const csv = noInterestCsv([
      row({ company: "=HYPERLINK(1)", phone: "+49 30 1", contact_name: "@x" }),
    ]);
    expect(csv).toContain("'=HYPERLINK(1)");
    expect(csv).toContain("'@x");
    expect(csv).toContain(";+49 30 1;");
  });
  it("handles an empty list", () => {
    expect(noInterestCsv([]).split("\r\n").length).toBe(2);
  });
});
