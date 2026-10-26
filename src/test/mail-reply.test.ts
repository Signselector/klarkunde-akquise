import { describe, expect, it } from "vitest";
import { parseInboundReply } from "@/lib/mail-reply";
import { unansweredCsv, type UnansweredLead } from "@/lib/reference-unanswered-csv";

describe("parseInboundReply", () => {
  it("reads sender and referenced message ids", () => {
    expect(
      parseInboundReply({
        from: "Max Muster <Max@Muster.de>",
        headers: { "In-Reply-To": "<abc@resend>", References: "<x1> <x2>" },
      }),
    ).toEqual({ from: "max@muster.de", refs: ["abc@resend", "x1", "x2"] });
  });
  it("accepts a wrapped payload and object senders", () => {
    expect(
      parseInboundReply({ type: "email.received", data: { from: { email: "a@b.de" } } }),
    ).toEqual({
      from: "a@b.de",
      refs: [],
    });
  });
  it("ignores payloads without sender or reference", () => {
    expect(parseInboundReply(null)).toBeNull();
    expect(parseInboundReply({ subject: "x" })).toBeNull();
  });
});

describe("unansweredCsv", () => {
  const row: UnansweredLead = {
    lead_id: "1",
    company: "Muster GmbH",
    contact_name: null,
    phone: null,
    email: "info@muster.de",
    city: "Wien",
    extra: { Website: "muster.de" },
    batch: "B1",
    caller_id: "11111111-1111-1111-1111-111111111111",
    caller: "Anna",
    mail_to: "info@muster.de",
    subject: "Referenzen",
    sent_at: "2026-07-01T10:00:00Z",
  };
  it("starts with the original caller id", () => {
    const lines = unansweredCsv([row]).replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]!.startsWith("Caller-ID;Caller;Firma")).toBe(true);
    expect(lines[1]!.startsWith("11111111-1111-1111-1111-111111111111;Anna;Muster GmbH")).toBe(
      true,
    );
    expect(lines[1]).toContain("muster.de");
  });
});
