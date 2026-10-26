import { cell, pick } from "@/lib/no-interest-csv";

/** One reference-mail lead without a reply after 3 months. `caller_id` is the original caller. */
export type UnansweredLead = {
  lead_id: string;
  company: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  extra: Record<string, unknown> | null;
  batch: string | null;
  caller_id: string | null;
  caller: string | null;
  mail_to: string | null;
  subject: string | null;
  sent_at: string | null;
};

export const UNANSWERED_HEADER = [
  "Caller-ID",
  "Caller",
  "Firma",
  "Ansprechpartner",
  "Telefon",
  "E-Mail",
  "Stadt",
  "Website",
  "Adresse",
  "Batch",
  "Mail gesendet an",
  "Betreff",
  "Mail gesendet am",
];

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("de-DE", { timeZone: "Europe/Vienna" }) : "";

/** CSV for download: starts with the id of the original caller so the lead can be given back to the same caller. */
export function unansweredCsv(rows: UnansweredLead[]) {
  const lines = [
    UNANSWERED_HEADER,
    ...rows.map((r) => [
      r.caller_id,
      r.caller,
      r.company,
      r.contact_name,
      r.phone,
      r.email,
      r.city,
      pick(r.extra, ["website", "webseite", "web", "url"]),
      pick(r.extra, ["adresse", "address", "anschrift"]),
      r.batch,
      r.mail_to,
      r.subject,
      day(r.sent_at),
    ]),
  ];
  return "﻿" + lines.map((l) => l.map(cell).join(";")).join("\r\n") + "\r\n";
}
