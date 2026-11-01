import { describe, expect, it } from "vitest";
import { UNREACHED_HEADER, unreachedCsv, type UnreachedLead } from "@/lib/unreached-csv";

const lead: UnreachedLead = {
  lead_id: "1",
  country: "DE",
  company: "Firma A",
  contact_name: "Max",
  phone: "+49 30 1",
  email: "a@x.de",
  city: "Berlin",
  extra: { Website: "https://a.de", Adresse: "Weg 1" },
  batch: "Batch 1",
  caller: "Anna",
  attempts: 3,
  last_attempt_at: "2026-09-01T10:00:00Z",
};

describe("unreached csv", () => {
  it("starts with the import column names and keeps the contact data", () => {
    const [head, row] = unreachedCsv([lead]).replace("﻿", "").trim().split("\r\n");
    expect(head!.split(";").slice(0, 8)).toEqual(UNREACHED_HEADER.slice(0, 8));
    expect(row).toContain("Firma A;Max;+49 30 1;a@x.de;Berlin;https://a.de;Weg 1");
    expect(row).toContain(";3;");
  });
});
